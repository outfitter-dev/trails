---
id: 9
slug: first-class-provisions
title: First-Class Provisions
status: accepted
created: 2026-03-30
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0009: First-Class Provisions

## Context

### The gap

Trails implementations are pure functions. Input in, `Result` out. No side effects, no trailhead knowledge. But real implementations talk to databases, call external APIs, read from caches, and publish to queues. Today, every trail that touches an external system creates its own connection inline:

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

3. **No governance.** The warden validates that `crosses` declarations match `ctx.cross()` calls. It can't validate provision usage because provisions aren't declared. Dependencies are invisible to the contract.

### What's missing from the contract

A trail's contract today answers: what does it take (input schema), what does it produce (output schema), what does it cross (crosses), and how does it behave (intent). It doesn't answer: **what does it need?**

That's the gap. The trail contract has no way to express dependencies on external capabilities. Provisions fill it.

### The right side of the hexagon

The Trails architecture is hexagonal. The left side (inbound) has its primitive: trailheads via `trailhead()`. The right side (outbound) — logging, storage, telemetry, search — doesn't have one yet. The architecture doc says: *"The framework defines ports. Everything concrete is a connector."* But there's no mechanism to register, resolve, or govern those connectors.

The logging package already established the connector pattern: abstract API (`Logger`) → extension point (`LogSink`) → built-in implementations → subpath connectors (`/logtape`). Services generalize this pattern. They're the primitive that fills the right side of the hexagon — how you register concrete implementations of connector ports and make them available to trails.

### The principle

"Author what's new, derive what's known." A trail should declare what it needs. The framework should provide it. The trail shouldn't know how to construct its dependencies.

## Decision

### `provision()` is a first-class primitive

Provisions are frozen definition objects with `kind: 'provision'`, parallel to `trail()` and `signal()`. They carry identity, a factory, optional disposal, optional mock, and meta (`meta`).

```typescript
const db = provision('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
// svc is ProvisionContext — env, cwd, workspaceRoot only. Not the full TrailContext.
```

The type is inferred from the `create` factory's return value. `db` knows it produces a `Database` instance. No manual generic annotation needed.

The fields:

- **`create`** — factory that returns `Result<T, Error>`. Receives a narrowed `ProvisionContext` — not the full `TrailContext` — containing only stable, process-scoped fields: `env`, `cwd`, `workspaceRoot`. Singleton provisions are resolved once and cached; request-specific fields like `requestId` or `signal` would reflect the first resolution and be stale for every subsequent call. The narrowed type makes this constraint structural rather than documentary. Named `create` per Convention 5 (`create*` for runtime instances).
- **`dispose`** — optional cleanup called on shutdown. Database pools close, API clients disconnect.
- **`health`** — optional check returning `Result`. Feeds into topo and survey reporting plus operational readiness. A database service can report whether it's connected; an API client can report whether the upstream is reachable.
- **`mock`** — optional factory for testing. When present, `testExamples(app)` uses it automatically with no configuration.
- **`config`** — reserved. Optional Zod schema declaring the config this provision needs. When the config system ships, provision config schemas compose into the app-level config automatically. Not resolved in v1, but reserving the field prevents breaking changes when composable config arrives.

### Topo discovers provisions alongside trails

`topo()` already scans module exports for objects with `kind: 'trail'` and `kind: 'event'`. Provisions use the same mechanism — `kind: 'provision'` objects are collected into a third map.

```typescript
import * as entity from './trails/entity';
import * as provisions from './provisions';

const app = topo('myapp', entity, provisions);
// app.trails — Map<id, Trail>
// app.events — Map<id, Event>
// app.provisions — Map<id, Provision>
```

Explicit registration also works for custom configuration:

```typescript
const app = topo('myapp', entity, { db, cache });
```

Duplicate provision IDs fail topo construction, same as duplicate trail IDs. No implicit override. Pack authors namespace with dot-separated IDs (`db.primary`, `entity.store`).

Topo gains provision-specific accessors — `getProvision`, `hasProvision`, `listProvisions`, `provisionIds` — while existing trail accessors remain unchanged.

### Trails declare provision dependencies

The trail spec gains an optional `provisions` field — an array of provision objects:

```typescript
const search = trail('search', {
  provisions: [db],
  intent: 'read',
  input: z.object({ query: z.string() }),
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const result = await dbSearch(conn, input);
    return Result.ok({ results: result.value });
  },
});
```

The array form is consistent with `crosses: [...]` — both are flat sets of dependency declarations. But where `crosses` uses string IDs, `provisions` takes objects. The difference is deliberate: provision objects carry their type from the factory return, enabling `db.from(ctx)` inference at the call site. String IDs would require a manual generic on every access. The tradeoff is that trail files import provision definitions, but this is natural — the provision is already in scope for `db.from(ctx)`, and packs export provisions alongside trails.

### Typed access via `db.from(ctx)`

The primary access pattern uses the provision definition itself as a typed accessor:

```typescript
const conn = db.from(ctx);  // typed as Database — inferred from create()
```

The type flows from the factory return through the service object to the accessor. No generic parameter at the call site. No type propagation through the topo. The framework absorbs the typing complexity; the developer gets inference for free.

The escape hatch remains for dynamic or custom cases:

```typescript
const conn = ctx.provision<Database>('db.main');  // manual generic
```

Both resolve the same way at runtime. `db.from(ctx)` is convenience; `ctx.provision()` is the underlying primitive.

### Eager resolution in the execution pipeline

Provisions resolve during `executeTrail`, after context creation and before layer composition:

```text
executeTrail pipeline:
1. Validate input
2. Resolve context (createContext + overrides)
3. Resolve provisions (create singletons or retrieve cached) ← new
4. Create cross via createCross(topo, scope)                 ← centralized
5. Compose gates (gates can now access provisions via ctx)
6. Execute implementation
```

Eager resolution means:

- **Failures happen at the boundary.** A missing `DATABASE_URL` fails before the implementation runs, not on line 47 of the business logic.
- **Gates can access provisions.** A transaction gate calls `db.from(ctx)` in its wrapper — the provision is already resolved.
- **Resolution is synchronous from the implementation's perspective.** `db.from(ctx)` is a lookup in an already-resolved map, not an async factory call.

Provision `create` factories return `Result`. Thrown exceptions are wrapped as `InternalError` with the service ID in context. A failed provision resolution short-circuits execution with a clear error.

### Centralized cross creation

Today, each trailhead creates its own `ctx.cross` function ad-hoc. With provisions, cross needs to propagate the resolved provision scope through nested trail invocations. A core `createCross(topo, scope)` function — named per Convention 5 — centralizes this. All trailheads and `run()` use the same function.

The execution scope is a lightweight object that `executeTrail` creates per root invocation. For v1, it holds the singleton provision cache. The scope is extensible — tracker will add `TrackScope` for trace propagation, and request-scoped provisions (when they ship) will add per-request state. Designing the seam now avoids retrofitting it later.

### Singleton lifecycle in v1

All provisions are app-scoped singletons. Created once on first resolution, cached for the lifetime of the process, disposed on shutdown. This covers the dominant use case — database pools, API clients, cached configs.

Shutdown signaling differs by trailhead. CLI tools run once and exit — disposal happens after the command completes. Long-running servers (MCP, HTTP) listen for `SIGTERM`/`SIGINT` and dispose provisions before exiting. The trailhead's `trailhead()` function owns this lifecycle, which is consistent with how trailheads already own the server lifecycle today.

Request-scoped provisions (per-invocation loggers, transaction contexts) are deferred. The singleton model is simple, predictable, and sufficient for v1.

### Testing swaps provisions explicitly

The payoff for declaring dependencies: tests swap them without module-level mocking.

```typescript
// Zero-config: provisions with mock factories auto-resolve
testExamples(app);

// Explicit override when you need specific behavior
testExamples(app, { provisions: { 'db.main': customMock } });
```

When a provision definition includes a `mock` factory, `testExamples` uses it automatically. No configuration needed. The provision contract includes how to mock itself. This restores the `testExamples(app)` promise — one line tests the entire app, even for trails with external dependencies.

The same mechanism works with `testCrosses`, `run`, and trailhead-level overrides:

```typescript
testCrosses(onboardTrail, scenarios, {
  provisions: { 'db.main': mockDb },
});

run(app, 'search', input, {
  provisions: { 'db.main': testDb },
});

trailhead(app, {
  provisions: { 'db.main': stagingDb },
});
```

### Warden governance mirrors cross-declarations

Two new rules, both following the established AST analysis pattern:

**`provision-declarations`** — validates that `db.from(ctx)` and `ctx.provision(...)` calls in the implementation match the declared `provisions: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`provision-exists`** — validates that every provision referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

`validateTopo` gains one more structural check: every trail's declared provisions must resolve in the topo's provision map.

### Intent compounds with the provision graph

Intent doesn't narrow service types in v1 — that requires conditional type machinery better left for later. But two things compound immediately:

**Survey reports the provision-by-intent matrix.** "Every trail touching `db.main` is `intent: 'write'` except `search`, which is `intent: 'read'`." That's a security-relevant insight derived from the graph.

**The warden can flag suspicious patterns.** A trail declared `intent: 'read'` that calls methods named `insert`, `delete`, or `update` on a provision-backed capability is worth a governance signal. Not enforcement — the warden can't know the method semantics — but a coaching hint.

### Survey reports the complete dependency graph

With provisions, the topo graph becomes fully connected:

```text
Trails ──crosses────→ Trails
Trails ──provisions─→ Provisions
Events ──origin───→ Trails
```

Survey gains a provisions section: which provisions exist, which trails use them, lifetime, description, and the full dependency graph. An agent connecting to an unfamiliar topo can now see everything a trail needs to run — its input, its downstream trails, and its infrastructure dependencies — before making a single call.

### Packs distribute the full capability

A pack bundles trails + provisions + signals. When you install an entity pack, it brings:

```typescript
// Entity pack exports
export const entityStore = provision('entity.store', {
  create: (ctx) => Result.ok(openEntityStore(ctx.env?.ENTITY_DB_URL)),
  mock: () => createInMemoryEntityStore(),
});

export const show = trail('entity.show', {
  provisions: [entityStore],
  blaze: async (input, ctx) => {
    const store = entityStore.from(ctx);
    return store.get(input.name);
  },
});
```

Install the pack, get the trails AND their provision requirements. `testExamples(app)` works immediately because the mock is on the provision definition. Dependencies are explicit, not discovered through documentation.

### Gates compose with provisions naturally

A Trails-native package can ship both a provision and a gate that uses it:

```typescript
// @ontrails/storage could provide:
export const storageProvision = provision('storage', { /* ... */ });
export const transactionGate = (svc: Provision<Storage>): Gate => ({
  name: 'transaction',
  wrap: (trail, impl) => async (input, ctx) => {
    if (trail.intent === 'read') return impl(input, ctx);
    const store = svc.from(ctx);
    return store.withTransaction(() => impl(input, ctx));
  },
});
```

The gate receives the provision definition as a parameter. It reads from context at runtime. No special plumbing — provisions are already resolved before gates compose.

## Consequences

### Positive

- **The trail contract is complete.** Input, output, intent, crossings, provisions — every dimension of what a trail is and needs is declared, verifiable, and introspectable.
- **`testExamples(app)` works for real apps.** The `mock` factory on provision definitions means examples run in isolation by default. The headline testing feature delivers on its promise.
- **Governance extends naturally.** `provision-declarations` mirrors `cross-declarations`. Same AST pattern, same diagnostic shape. The warden's coverage grows without new concepts.
- **The dependency graph is queryable.** Survey reports which provisions exist, which trails use them, and how intent relates to provision access. Agents and tooling see the complete picture.
- **Gates and provisions compose.** Transaction gates, capability-shaping gates, and other cross-cutting concerns that need infrastructure access just work — provisions are resolved before gates run.
- **Packs are self-contained.** A pack carries its trails, its provisions, and its test mocks. Install one thing, get the full capability.

### Tradeoffs

- **One more core concept.** `provision()` joins `trail()`, `signal()`, and `topo()` as a framework primitive. The API trailhead grows. The justification: without it, the framework can't manage lifecycle, govern dependencies, or make examples work for real implementations.
- **Singleton-only limits some patterns.** Request-scoped provisions (per-invocation transaction contexts, request-scoped loggers) aren't supported in v1. Workaround: use gates for request-scoped concerns, or pass request-specific state through `ctx.extensions`.
- **Mock factories are optional.** If a service doesn't define `mock`, `testExamples` still needs explicit overrides. The convenience is opt-in, not guaranteed.

### What this does NOT decide

- **Request-scoped provisions.** Deferred until a concrete use case demands it. The singleton model is sufficient for v1. The execution scope introduced here is extensible for request-scoped state when needed — the `createCross` mechanism already propagates scope through cross chains.
- **Intent-based type narrowing.** `intent: 'read'` returning a read-only projection of a service is powerful but complex. Deferred.
- **Provision-to-provision dependencies.** Whether one provision's factory can depend on another provision. The expected pattern when this is needed: provision factories receive a provision resolver alongside `ctx`, and resolution order is topologically sorted from the dependency graph. The graph is already queryable — this follows naturally. Config resolution will be the first instance of this.
- **Composable config resolution.** The reserved `config` field on `ProvisionSpec` enables provisions to declare their own config schemas. When `@ontrails/config` ships, provision config schemas compose into the app-level config automatically. The field is reserved now to prevent breaking changes.
- **Specific connector port interfaces.** The architecture plans `IndexConnector`, `StorageConnector`, `CacheConnector`, and `AuthConnector` as port interfaces. Provisions are the mechanism to register concrete implementations of these ports. Which ports ship first, and whether they live in core or in dedicated packages like `@ontrails/storage`, is separate from the provisions primitive itself.
- **Infrastructure provisions pattern.** Config, permits, and tracker will each ship as a provision + gate + trails package following the pattern established by `@ontrails/logging`. The provisions primitive enables this but doesn't prescribe it.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the trail is the product," "derive by default," and the information architecture
- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md) — provision factories return Result, consistent with the error taxonomy
- [ADR-0003: Unified Trail Primitive](0003-unified-trail-primitive.md) — provisions follow the same pattern: declaration on the spec, governance via warden
- [ADR-0004: Intent as a First-Class Property](0004-intent-as-first-class-property.md) — intent compounds with the provision graph for security insights
- [ADR-0006: Shared Execution Pipeline](0006-shared-execution-pipeline.md) — provisions resolve within executeTrail, before gates compose
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — provision-declarations rule follows the same AST pattern
