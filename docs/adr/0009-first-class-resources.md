---
id: 9
slug: first-class-resources
title: First-Class Resources
status: accepted
created: 2026-03-30
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0009: First-Class Resources

## Context

### The gap

Trails implementations are pure functions. Input in, `Result` out. No side effects, no surface knowledge. But real implementations talk to databases, call external APIs, read from caches, and publish to queues. Today, every trail that touches an external system creates its own connection inline:

```typescript
const search = trail('search', {
  blaze: async (input) => {
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

3. **No governance.** The warden validates that `crosses` declarations match `ctx.cross()` calls. It can't validate resource usage because resources aren't declared. Dependencies are invisible to the contract.

### What's missing from the contract

A trail's contract today answers: what does it take (input schema), what does it produce (output schema), what does it cross (crosses), and how does it behave (intent). It doesn't answer: **what does it need?**

That's the gap. The trail contract has no way to express dependencies on external capabilities. Resources fill it.

### The right side of the hexagon

The Trails architecture is hexagonal. The left side (inbound) has its primitive: surfaces via `surface()`. The right side (outbound) — logging, storage, telemetry, search — doesn't have one yet. The architecture doc says: *"The framework defines ports. Everything concrete is a connector."* But there's no mechanism to register, resolve, or govern those connectors.

The logging package already established the connector pattern: abstract API (`Logger`) → extension point (`LogSink`) → built-in implementations → subpath connectors (`/logtape`). Resources generalize this pattern. They're the primitive that fills the right side of the hexagon — how you register concrete implementations of connector ports and make them available to trails.

### The principle

"Author what's new, derive what's known." A trail should declare what it needs. The framework should provide it. The trail shouldn't know how to construct its dependencies.

## Decision

### `resource()` is a first-class primitive

Resources are frozen definition objects with `kind: 'resource'`, parallel to `trail()` and `signal()`. They carry identity, a factory, optional disposal, optional mock, and meta (`meta`).

```typescript
const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
// svc is ResourceContext — env, cwd, workspaceRoot only. Not the full TrailContext.
```

The type is inferred from the `create` factory's return value. `db` knows it produces a `Database` instance. No manual generic annotation needed.

The fields:

- **`create`** — factory that returns `Result<T, Error>`. Receives a narrowed `ResourceContext` — not the full `TrailContext` — containing only stable, process-scoped fields: `env`, `cwd`, `workspaceRoot`. Singleton resources are resolved once and cached; request-specific fields like `requestId` or `signal` would reflect the first resolution and be stale for every subsequent call. The narrowed type makes this constraint structural rather than documentary. Named `create` per Convention 5 (`create*` for runtime instances).
- **`dispose`** — optional cleanup called on shutdown. Database pools close, API clients disconnect.
- **`health`** — optional check returning `Result`. Feeds into topo and survey reporting plus operational readiness. A database resource can report whether it's connected; an API client can report whether the upstream is reachable.
- **`mock`** — optional factory for testing. When present, `testExamples(app)` uses it automatically with no configuration.
- **`config`** — reserved. Optional Zod schema declaring the config this resource needs. When the config system ships, resource config schemas compose into the app-level config automatically. Not resolved in v1, but reserving the field prevents breaking changes when composable config arrives.

### Topo discovers resources alongside trails

`topo()` already scans module exports for objects with `kind: 'trail'` and `kind: 'event'`. Resources use the same mechanism — `kind: 'resource'` objects are collected into a third map.

```typescript
import * as entity from './trails/entity';
import * as resources from './resources';

const graph = topo('myapp', entity, resources);
// app.trails — Map<id, Trail>
// app.events — Map<id, Event>
// app.resources — Map<id, Resource>
```

Explicit registration also works for custom configuration:

```typescript
const graph = topo('myapp', entity, { db, cache });
```

Duplicate resource IDs fail topo construction, same as duplicate trail IDs. No implicit override. Pack authors namespace with dot-separated IDs (`db.primary`, `entity.store`).

Topo gains resource-specific accessors — `getResource`, `hasResource`, `listResources`, `resourceIds` — while existing trail accessors remain unchanged.

### Trails declare resource dependencies

The trail spec gains an optional `resources` field — an array of resource objects:

```typescript
const search = trail('search', {
  resources: [db],
  intent: 'read',
  input: z.object({ query: z.string() }),
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const result = await dbSearch(conn, input);
    return Result.ok({ results: result.value });
  },
});
```

The array form is consistent with `crosses: [...]` — both are flat sets of dependency declarations. But where `crosses` uses string IDs, `resources` takes objects. The difference is deliberate: resource objects carry their type from the factory return, enabling `db.from(ctx)` inference at the call site. String IDs would require a manual generic on every access. The tradeoff is that trail files import resource definitions, but this is natural — the resource is already in scope for `db.from(ctx)`, and packs export resources alongside trails.

### Typed access via `db.from(ctx)`

The primary access pattern uses the resource definition itself as a typed accessor:

```typescript
const conn = db.from(ctx);  // typed as Database — inferred from create()
```

The type flows from the factory return through the resource object to the accessor. No generic parameter at the call site. No type propagation through the topo. The framework absorbs the typing complexity; the developer gets inference for free.

The escape hatch remains for dynamic or custom cases:

```typescript
const conn = ctx.resource<Database>('db.main');  // manual generic
```

Both resolve the same way at runtime. `db.from(ctx)` is convenience; `ctx.resource()` is the underlying primitive.

### Eager resolution in the execution pipeline

Resources resolve during `executeTrail`, after context creation and before layer composition:

```text
executeTrail pipeline:
1. Validate input
2. Resolve context (createContext + overrides)
3. Resolve resources (create singletons or retrieve cached) ← new
4. Create cross via createCross(topo, scope)                 ← centralized
5. Compose layers (layers can now access resources via ctx)
6. Execute implementation
```

Eager resolution means:

- **Failures happen at the boundary.** A missing `DATABASE_URL` fails before the implementation runs, not on line 47 of the business logic.
- **Layers can access resources.** A transaction layer calls `db.from(ctx)` in its wrapper — the resource is already resolved.
- **Resolution is synchronous from the implementation's perspective.** `db.from(ctx)` is a lookup in an already-resolved map, not an async factory call.

Resource `create` factories return `Result`. Thrown exceptions are wrapped as `InternalError` with the resource ID in context. A failed resource resolution short-circuits execution with a clear error.

### Centralized cross creation

Today, each surface creates its own `ctx.cross` function ad-hoc. With resources, cross needs to propagate the resolved resource scope through nested trail invocations. A core `createCross(topo, scope)` function — named per Convention 5 — centralizes this. All surfaces and `run()` use the same function.

The execution scope is a lightweight object that `executeTrail` creates per root invocation. For v1, it holds the singleton resource cache. The scope is extensible — tracing will add `TrackScope` for trace propagation, and request-scoped resources (when they ship) will add per-request state. Designing the seam now avoids retrofitting it later.

### Singleton lifecycle in v1

All resources are app-scoped singletons. Created once on first resolution, cached for the lifetime of the process, disposed on shutdown. This covers the dominant use case — database pools, API clients, cached configs.

Shutdown signaling differs by surface. CLI tools run once and exit — disposal happens after the command completes. Long-running servers (MCP, HTTP) listen for `SIGTERM`/`SIGINT` and dispose resources before exiting. The `surface()` function owns this lifecycle, which is consistent with how surfaces already own the server lifecycle today.

Request-scoped resources (per-invocation loggers, transaction contexts) are deferred. The singleton model is simple, predictable, and sufficient for v1.

### Testing swaps resources explicitly

The payoff for declaring dependencies: tests swap them without module-level mocking.

```typescript
// Zero-config: resources with mock factories auto-resolve
testExamples(app);

// Explicit override when you need specific behavior
testExamples(app, { resources: { 'db.main': customMock } });
```

When a resource definition includes a `mock` factory, `testExamples` uses it automatically. No configuration needed. The resource contract includes how to mock itself. This restores the `testExamples(app)` promise — one line tests the entire app, even for trails with external dependencies.

The same mechanism works with `testCrosses`, `run`, and surface-level overrides:

```typescript
testCrosses(onboardTrail, scenarios, {
  resources: { 'db.main': mockDb },
});

run(graph, 'search', input, {
  resources: { 'db.main': testDb },
});

surface(graph, {
  resources: { 'db.main': stagingDb },
});
```

### Warden governance mirrors cross-declarations

Two new rules, both following the established AST analysis pattern:

**`resource-declarations`** — validates that `db.from(ctx)` and `ctx.resource(...)` calls in the implementation match the declared `resources: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`resource-exists`** — validates that every resource referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

`validateTopo` gains one more structural check: every trail's declared resources must resolve in the topo's resource map.

### Intent compounds with the resource graph

Intent doesn't narrow resource types in v1 — that requires conditional type machinery better left for later. But two things compound immediately:

**Survey reports the resource-by-intent matrix.** "Every trail touching `db.main` is `intent: 'write'` except `search`, which is `intent: 'read'`." That's a security-relevant insight derived from the graph.

**The warden can flag suspicious patterns.** A trail declared `intent: 'read'` that calls methods named `insert`, `delete`, or `update` on a resource-backed capability is worth a governance signal. Not enforcement — the warden can't know the method semantics — but a coaching hint.

### Survey reports the complete dependency graph

With resources, the topo graph becomes fully connected:

```text
Trails ──crosses────→ Trails
Trails ──resources─→ Resources
Events ──origin───→ Trails
```

Survey gains a resources section: which resources exist, which trails use them, lifetime, description, and the full dependency graph. An agent connecting to an unfamiliar topo can now see everything a trail needs to run — its input, its downstream trails, and its infrastructure dependencies — before making a single call.

### Packs distribute the full capability

A pack bundles trails + resources + signals. When you install an entity pack, it brings:

```typescript
// Entity pack exports
export const entityStore = resource('entity.store', {
  create: (ctx) => Result.ok(openEntityStore(ctx.env?.ENTITY_DB_URL)),
  mock: () => createInMemoryEntityStore(),
});

export const show = trail('entity.show', {
  resources: [entityStore],
  blaze: async (input, ctx) => {
    const store = entityStore.from(ctx);
    return store.get(input.name);
  },
});
```

Install the pack, get the trails AND their resource requirements. `testExamples(app)` works immediately because the mock is on the resource definition. Dependencies are explicit, not discovered through documentation.

### Layers compose with resources naturally

A Trails-native package can ship both a resource and a layer that uses it:

```typescript
// @ontrails/storage could provide:
export const storageResource = resource('storage', { /* ... */ });
export const transactionLayer = (svc: Resource<Storage>): Layer => ({
  name: 'transaction',
  wrap: (trail, impl) => async (input, ctx) => {
    if (trail.intent === 'read') return impl(input, ctx);
    const store = svc.from(ctx);
    return store.withTransaction(() => impl(input, ctx));
  },
});
```

The layer receives the resource definition as a parameter. It reads from context at runtime. No special plumbing — resources are already resolved before layers compose.

## Consequences

### Positive

- **The trail contract is complete.** Input, output, intent, crossings, resources — every dimension of what a trail is and needs is declared, verifiable, and introspectable.
- **`testExamples(app)` works for real apps.** The `mock` factory on resource definitions means examples run in isolation by default. The headline testing feature delivers on its promise.
- **Governance extends naturally.** `resource-declarations` mirrors `cross-declarations`. Same AST pattern, same diagnostic shape. The warden's coverage grows without new concepts.
- **The dependency graph is queryable.** Survey reports which resources exist, which trails use them, and how intent relates to resource access. Agents and tooling see the complete picture.
- **Layers and resources compose.** Transaction layers, capability-shaping layers, and other cross-cutting concerns that need infrastructure access just work — resources are resolved before layers run.
- **Packs are self-contained.** A pack carries its trails, its resources, and its test mocks. Install one thing, get the full capability.

### Tradeoffs

- **One more core concept.** `resource()` joins `trail()`, `signal()`, and `topo()` as a framework primitive. The API surface grows. The justification: without it, the framework can't manage lifecycle, govern dependencies, or make examples work for real implementations.
- **Singleton-only limits some patterns.** Request-scoped resources (per-invocation transaction contexts, request-scoped loggers) aren't supported in v1. Workaround: use layers for request-scoped concerns, or pass request-specific state through `ctx.extensions`.
- **Mock factories are optional.** If a resource doesn't define `mock`, `testExamples` still needs explicit overrides. The convenience is opt-in, not guaranteed.

### What this does NOT decide

- **Request-scoped resources.** Deferred until a concrete use case demands it. The singleton model is sufficient for v1. The execution scope introduced here is extensible for request-scoped state when needed — the `createCross` mechanism already propagates scope through cross chains.
- **Intent-based type narrowing.** `intent: 'read'` returning a read-only projection of a resource is powerful but complex. Deferred.
- **Resource-to-resource dependencies.** Whether one resource's factory can depend on another resource. The expected pattern when this is needed: resource factories receive a resource resolver alongside `ctx`, and resolution order is topologically sorted from the dependency graph. The graph is already queryable — this follows naturally. Config resolution will be the first instance of this.
- **Composable config resolution.** The reserved `config` field on `ResourceSpec` enables resources to declare their own config schemas. When `@ontrails/config` ships, resource config schemas compose into the app-level config automatically. The field is reserved now to prevent breaking changes.
- **Specific connector port interfaces.** The architecture plans `IndexConnector`, `StorageConnector`, `CacheConnector`, and `AuthConnector` as port interfaces. Resources are the mechanism to register concrete implementations of these ports. Which ports ship first, and whether they live in core or in dedicated packages like `@ontrails/storage`, is separate from the resources primitive itself.
- **Infrastructure resources pattern.** Config, permits, and tracing will each ship as a resource + layer + trails package following the pattern established by `@ontrails/logging`. The resources primitive enables this but doesn't prescribe it.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the trail is the product," "derive by default," and the information architecture
- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — resource factories return Result, consistent with the error taxonomy
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — resources follow the same pattern: declaration on the spec, governance via warden
- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) — intent compounds with the resource graph for security insights
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — resources resolve within executeTrail, before layers compose
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — resource-declarations rule follows the same AST pattern

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — `trailhead(` → `surface(`.
