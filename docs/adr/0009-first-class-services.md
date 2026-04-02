---
id: 9
slug: first-class-services
title: Services as a First-Class Primitive
status: accepted
created: 2026-03-30
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0009: Services as a First-Class Primitive

## Context

### The gap

Trails implementations are pure functions. Input in, `Result` out. No side effects, no surface knowledge. But real implementations talk to databases, call external APIs, read from caches, and publish to queues. Today, every trail that touches an external system creates its own connection inline:

```typescript
const search = trail('search', {
  run: async (input) => {
    const db = openDatabase();
    try {
      const result = await dbSearch(db, input);
      return Result.ok({ results: result.value });
    } finally {
      db.close();
    }
  },
});
```

This pattern appears in every trail that touches infrastructure. It has three problems:

1. **Tests can't swap dependencies.** The `openDatabase()` call is baked into the implementation. Testing requires module-level mocking (`vi.mock()`), which bypasses the framework entirely and makes `testExamples(app)` — the headline testing feature — unreliable for any trail with external dependencies.

2. **The framework can't manage lifecycle.** Every trail opens and closes its own connection. No pooling, no shared clients, no coordinated shutdown. The framework has zero visibility into what the trail needs.

3. **No governance.** The warden validates that `follow` declarations match `ctx.follow()` calls. It can't validate service usage because services aren't declared. Dependencies are invisible to the contract.

### What's missing from the contract

A trail's contract today answers: what does it take (input schema), what does it produce (output schema), what does it compose (follow), and how does it behave (intent). It doesn't answer: **what does it need?**

That's the gap. The trail contract has no way to express dependencies on external capabilities. Services fill it.

### The right side of the hexagon

The Trails architecture is hexagonal. The left side (inbound) has its primitive: surfaces via `blaze()`. The right side (outbound) — logging, storage, telemetry, search — doesn't have one yet. The architecture doc says: *"The framework defines ports. Everything concrete is an adapter."* But there's no mechanism to register, resolve, or govern those adapters.

The logging package already established the adapter pattern: abstract API (`Logger`) → extension point (`LogSink`) → built-in implementations → subpath adapters (`/logtape`). Services generalize this pattern. They're the primitive that fills the right side of the hexagon — how you register concrete implementations of adapter ports and make them available to trails.

### The principle

"Author what's new, derive what's known." A trail should declare what it needs. The framework should provide it. The trail shouldn't know how to construct its dependencies.

## Decision

### `service()` is a first-class primitive

Services are frozen definition objects with `kind: 'service'`, parallel to `trail()` and `event()`. They carry identity, a factory, optional disposal, optional mock, and metadata.

```typescript
const db = service('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
// svc is ServiceContext — env, cwd, workspaceRoot only. Not the full TrailContext.
```

The type is inferred from the `create` factory's return value. `db` knows it produces a `Database` instance. No manual generic annotation needed.

The fields:

- **`create`** — factory that returns `Result<T, Error>`. Receives a narrowed `ServiceContext` — not the full `TrailContext` — containing only stable, process-scoped fields: `env`, `cwd`, `workspaceRoot`. Singleton services are resolved once and cached; request-specific fields like `requestId` or `signal` would reflect the first resolution and be stale for every subsequent call. The narrowed type makes this constraint structural rather than documentary. Named `create` per Convention 5 (`create*` for runtime instances).
- **`dispose`** — optional cleanup called on shutdown. Database pools close, API clients disconnect.
- **`health`** — optional check returning `Result`. Feeds into `survey --brief` and operational readiness. A database service can report whether it's connected; an API client can report whether the upstream is reachable.
- **`mock`** — optional factory for testing. When present, `testExamples(app)` uses it automatically with no configuration.
- **`config`** — reserved. Optional Zod schema declaring the config this service needs. When the config system ships, service config schemas compose into the app-level config automatically. Not resolved in v1, but reserving the field prevents breaking changes when composable config arrives.

### Topo discovers services alongside trails

`topo()` already scans module exports for objects with `kind: 'trail'` and `kind: 'event'`. Services use the same mechanism — `kind: 'service'` objects are collected into a third map.

```typescript
import * as entity from './trails/entity';
import * as services from './services';

const app = topo('myapp', entity, services);
// app.trails — Map<id, Trail>
// app.events — Map<id, Event>
// app.services — Map<id, Service>
```

Explicit registration also works for custom configuration:

```typescript
const app = topo('myapp', entity, { db, cache });
```

Duplicate service IDs fail topo construction, same as duplicate trail IDs. No implicit override. Pack authors namespace with dot-separated IDs (`db.primary`, `entity.store`).

Topo gains service-specific accessors — `getService`, `hasService`, `listServices`, `serviceIds` — while existing trail accessors remain unchanged.

### Trails declare service dependencies

The trail spec gains an optional `services` field — an array of service objects:

```typescript
const search = trail('search', {
  services: [db],
  intent: 'read',
  input: z.object({ query: z.string() }),
  run: async (input, ctx) => {
    const conn = db.from(ctx);
    const result = await dbSearch(conn, input);
    return Result.ok({ results: result.value });
  },
});
```

The array form is consistent with `follow: [...]` — both are flat sets of dependency declarations. But where `follow` uses string IDs, `services` takes objects. The difference is deliberate: service objects carry their type from the factory return, enabling `db.from(ctx)` inference at the call site. String IDs would require a manual generic on every access. The tradeoff is that trail files import service definitions, but this is natural — the service is already in scope for `db.from(ctx)`, and packs export services alongside trails.

### Typed access via `db.from(ctx)`

The primary access pattern uses the service definition itself as a typed accessor:

```typescript
const conn = db.from(ctx);  // typed as Database — inferred from create()
```

The type flows from the factory return through the service object to the accessor. No generic parameter at the call site. No type propagation through the topo. The framework absorbs the typing complexity; the developer gets inference for free.

The escape hatch remains for dynamic or custom cases:

```typescript
const conn = ctx.service<Database>('db.main');  // manual generic
```

Both resolve the same way at runtime. `db.from(ctx)` is convenience; `ctx.service()` is the underlying primitive.

### Eager resolution in the execution pipeline

Services resolve during `executeTrail`, after context creation and before layer composition:

```text
executeTrail pipeline:
1. Validate input
2. Resolve context (createContext + overrides)
3. Resolve services (create singletons or retrieve cached)  ← new
4. Create follow via createFollow(topo, scope)               ← centralized
5. Compose layers (layers can now access services via ctx)
6. Execute implementation
```

Eager resolution means:

- **Failures happen at the boundary.** A missing `DATABASE_URL` fails before the implementation runs, not on line 47 of the business logic.
- **Layers can access services.** A transaction layer calls `db.from(ctx)` in its wrapper — the service is already resolved.
- **Resolution is synchronous from the implementation's perspective.** `db.from(ctx)` is a lookup in an already-resolved map, not an async factory call.

Service `create` factories return `Result`. Thrown exceptions are wrapped as `InternalError` with the service ID in context. A failed service resolution short-circuits execution with a clear error.

### Centralized follow creation

Today, each surface creates its own `ctx.follow` function ad-hoc. With services, follow needs to propagate the resolved service scope through nested trail invocations. A core `createFollow(topo, scope)` function — named per Convention 5 — centralizes this. All surfaces and `dispatch()` use the same function.

The execution scope is a lightweight object that `executeTrail` creates per root invocation. For v1, it holds the singleton service cache. The scope is extensible — crumbs will add `CrumbScope` for trace propagation, and request-scoped services (when they ship) will add per-request state. Designing the seam now avoids retrofitting it later.

### Singleton lifecycle in v1

All services are app-scoped singletons. Created once on first resolution, cached for the lifetime of the process, disposed on shutdown. This covers the dominant use case — database pools, API clients, cached configs.

Shutdown signaling differs by surface. CLI tools run once and exit — disposal happens after the command completes. Long-running servers (MCP, HTTP) listen for `SIGTERM`/`SIGINT` and dispose services before exiting. The surface's `blaze()` function owns this lifecycle, which is consistent with how surfaces already own the server lifecycle today.

Request-scoped services (per-invocation loggers, transaction contexts) are deferred. The singleton model is simple, predictable, and sufficient for v1.

### Testing swaps services explicitly

The payoff for declaring dependencies: tests swap them without module-level mocking.

```typescript
// Zero-config: services with mock factories auto-resolve
testExamples(app);

// Explicit override when you need specific behavior
testExamples(app, { services: { 'db.main': customMock } });
```

When a service definition includes a `mock` factory, `testExamples` uses it automatically. No configuration needed. The service contract includes how to mock itself. This restores the `testExamples(app)` promise — one line tests the entire app, even for trails with external dependencies.

The same mechanism works with `testFollows`, `dispatch`, and surface-level overrides:

```typescript
testFollows(onboardTrail, scenarios, {
  services: { 'db.main': mockDb },
});

dispatch(app, 'search', input, {
  services: { 'db.main': testDb },
});

blaze(app, {
  services: { 'db.main': stagingDb },
});
```

### Warden governance mirrors follow-declarations

Two new rules, both following the established AST analysis pattern:

**`service-declarations`** — validates that `db.from(ctx)` and `ctx.service(...)` calls in the implementation match the declared `services: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`service-exists`** — validates that every service referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

`validateTopo` gains one more structural check: every trail's declared services must resolve in the topo's service map.

### Intent compounds with the service graph

Intent doesn't narrow service types in v1 — that requires conditional type machinery better left for later. But two things compound immediately:

**Survey reports the service-by-intent matrix.** "Every trail touching `db.main` is `intent: 'write'` except `search`, which is `intent: 'read'`." That's a security-relevant insight derived from the graph.

**The warden can flag suspicious patterns.** A trail declared `intent: 'read'` that calls methods named `insert`, `delete`, or `update` on a service is worth a governance signal. Not enforcement — the warden can't know the method semantics — but a coaching hint.

### Survey reports the complete dependency graph

With services, the topo graph becomes fully connected:

```text
Trails ──follow───→ Trails
Trails ──services──→ Services
Events ──origin───→ Trails
```

Survey gains a services section: which services exist, which trails use them, lifetime, description, and the full dependency graph. An agent connecting to an unfamiliar topo can now see everything a trail needs to run — its input, its downstream trails, and its infrastructure dependencies — before making a single call.

### Packs distribute the full capability

A pack bundles trails + services + events. When you install an entity pack, it brings:

```typescript
// Entity pack exports
export const entityStore = service('entity.store', {
  create: (ctx) => Result.ok(openEntityStore(ctx.env?.ENTITY_DB_URL)),
  mock: () => createInMemoryEntityStore(),
});

export const show = trail('entity.show', {
  services: [entityStore],
  run: async (input, ctx) => {
    const store = entityStore.from(ctx);
    return store.get(input.name);
  },
});
```

Install the pack, get the trails AND their service requirements. `testExamples(app)` works immediately because the mock is on the service definition. Dependencies are explicit, not discovered through documentation.

### Layers compose with services naturally

A Trails-native package can ship both a service and a layer that uses it:

```typescript
// @ontrails/storage could provide:
export const storageService = service('storage', { /* ... */ });
export const transactionLayer = (svc: Service<Storage>): Layer => ({
  name: 'transaction',
  wrap: (trail, impl) => async (input, ctx) => {
    if (trail.intent === 'read') return impl(input, ctx);
    const store = svc.from(ctx);
    return store.withTransaction(() => impl(input, ctx));
  },
});
```

The layer receives the service definition as a parameter. It reads from context at runtime. No special plumbing — services are already resolved before layers compose.

## Consequences

### Positive

- **The trail contract is complete.** Input, output, intent, follow, services — every dimension of what a trail is and needs is declared, verifiable, and introspectable.
- **`testExamples(app)` works for real apps.** The `mock` factory on service definitions means examples run in isolation by default. The headline testing feature delivers on its promise.
- **Governance extends naturally.** `service-declarations` mirrors `follow-declarations`. Same AST pattern, same diagnostic shape. The warden's coverage grows without new concepts.
- **The dependency graph is queryable.** Survey reports which services exist, which trails use them, and how intent relates to service access. Agents and tooling see the complete picture.
- **Layers and services compose.** Transaction layers, capability-shaping layers, and other cross-cutting concerns that need infrastructure access just work — services are resolved before layers run.
- **Packs are self-contained.** A pack carries its trails, its services, and its test mocks. Install one thing, get the full capability.

### Tradeoffs

- **One more core concept.** `service()` joins `trail()`, `event()`, and `topo()` as a framework primitive. The API surface grows. The justification: without it, the framework can't manage lifecycle, govern dependencies, or make examples work for real implementations.
- **Singleton-only limits some patterns.** Request-scoped services (per-invocation transaction contexts, request-scoped loggers) aren't supported in v1. Workaround: use layers for request-scoped concerns, or pass request-specific state through `ctx.extensions`.
- **Mock factories are optional.** If a service doesn't define `mock`, `testExamples` still needs explicit overrides. The convenience is opt-in, not guaranteed.

### What this does NOT decide

- **Request-scoped services.** Deferred until a concrete use case demands it. The singleton model is sufficient for v1. The execution scope introduced here is extensible for request-scoped state when needed — the `createFollow` mechanism already propagates scope through follow chains.
- **Intent-based type narrowing.** `intent: 'read'` returning a read-only projection of a service is powerful but complex. Deferred.
- **Service-to-service dependencies.** Whether one service's factory can depend on another service. The expected pattern when this is needed: service factories receive a service resolver alongside `ctx`, and resolution order is topologically sorted from the dependency graph. The graph is already queryable — this follows naturally. Config resolution will be the first instance of this.
- **Composable config resolution.** The reserved `config` field on `ServiceSpec` enables services to declare their own config schemas. When `@ontrails/config` ships, service config schemas compose into the app-level config automatically. The field is reserved now to prevent breaking changes.
- **Specific adapter port interfaces.** The architecture plans `IndexAdapter`, `StorageAdapter`, `CacheAdapter`, and `AuthAdapter` as port interfaces. Services are the mechanism to register concrete implementations of these ports. Which ports ship first, and whether they live in core or in dedicated packages like `@ontrails/storage`, is separate from the services primitive itself.
- **Infrastructure services pattern.** Config, permits, and crumbs will each ship as a service + layer + trails package following the pattern established by `@ontrails/logging`. The services primitive enables this but doesn't prescribe it.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the trail is the product," "derive by default," and the information architecture
- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — service factories return Result, consistent with the error taxonomy
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — services follow the same pattern: declaration on the spec, governance via warden
- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) — intent compounds with the service graph for security insights
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — services resolve within executeTrail, before layers compose
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — service-declarations rule follows the same AST pattern
