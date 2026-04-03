# Provisions

Trails implementations are pure functions -- input in, `Result` out. But real implementations need databases, API clients, caches, and queues. Without a dependency mechanism, every trail constructs its own connections inline. Tests can't swap them, the framework can't manage lifecycle, and governance can't see what a trail actually needs. Provisions fill that gap. They make dependencies declarative, injectable, and governable.

## Defining a Provision

Use `provision()` to create a typed provision definition:

```typescript
import { provision, Result } from '@ontrails/core';

const db = provision('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
```

The type of the provision instance is inferred from the `create` factory return. No manual generic needed.

| Field | Purpose |
| --- | --- |
| `create` | Factory returning `Result<T, Error>`. Receives a `ProvisionContext` with `env`, `cwd`, and `workspaceRoot` only -- not the full `TrailContext`. |
| `dispose` | Optional cleanup on shutdown. Database pools close, API clients disconnect. |
| `health` | Optional readiness probe. Feeds into topo and survey reporting plus operational checks. |
| `mock` | Optional test factory. When present, `testExamples(app)` uses it automatically. |
| `description` | Human-readable label for topo or survey output and agent introspection. |

The `create` factory receives `ProvisionContext` -- a narrow subset of `TrailContext` -- because provisions are singletons resolved once per process. Request-scoped fields like `requestId` would be stale after the first resolution.

## Provision Config Schemas

Provisions can declare a `config` field with a Zod schema. When present, the framework validates the provision's config slice during resolution and passes the typed result to the `create` factory via `svc.config`:

```typescript
import { provision, Result } from '@ontrails/core';
import { z } from 'zod';

const db = provision('db.main', {
  config: z.object({ poolSize: z.number(), url: z.string().url() }),
  create: (svc) => Result.ok(openPool(svc.config.url, svc.config.poolSize)),
  dispose: (pool) => pool.end(),
  mock: () => createInMemoryDb(),
});
```

The config values come from the resolved app config, keyed by provision ID. `@ontrails/config` provides `collectProvisionConfigs()` to gather all provision config schemas from a topo, and `defineConfig()` to wire loadout-based resolution into the bootstrap pipeline. Provisions without a `config` schema receive `unknown` and ignore `svc.config`.

## Declaring Provisions on a Trail

Add provisions to the trail spec with the `provisions` array:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

const search = trail('search', {
  provisions: [db],
  intent: 'read',
  input: z.object({ query: z.string() }),
  output: z.array(z.object({ id: z.string(), title: z.string() })),
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const results = await conn.search(input.query);
    return Result.ok(results);
  },
});
```

The `provisions` array is a flat set of provision objects, parallel to `crosses` for trail composition. Provision objects carry their type from the factory return, so `db.from(ctx)` infers the correct type at the call site.

## Accessing Provisions

The primary access pattern uses the provision definition as a typed accessor:

```typescript
const conn = db.from(ctx); // typed as the return of create()
```

The escape hatch for dynamic or string-based access:

```typescript
const conn = ctx.provision<Database>('db.main');
```

Both resolve the same way at runtime. Prefer `db.from(ctx)` -- it carries the type automatically.

## Provision Lifecycle

Provisions are app-scoped singletons in v1. Created once on first resolution, cached for the process lifetime, disposed on shutdown.

Resolution happens eagerly during `executeTrail`, after input validation and before layer composition:

1. Validate input
2. Resolve context
3. **Resolve provisions** (create singletons or retrieve cached)
4. Compose gates
5. Execute implementation

This means failures trailhead at the boundary -- a missing `DATABASE_URL` fails before the implementation runs, not on line 47. It also means gates can access provisions via `db.from(ctx)` because resolution is already complete.

Shutdown signaling differs by trailhead. CLI tools dispose after the command completes. Long-running servers (MCP, HTTP) dispose on `SIGTERM`/`SIGINT`. The trailhead's `trailhead()` owns the lifecycle.

## Testing with Provisions

Provisions with a `mock` factory auto-resolve during `testAll`, `testExamples`, and `testContracts`:

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../app';

// db.mock() is used automatically -- no configuration
testAll(app);
```

Override explicitly when you need specific behavior:

```typescript
testAll(app, () => ({
  provisions: { 'db.main': createSpecialTestDb() },
}));
```

Pass a factory (the `() => ({...})` form) when overrides contain mutable state, so each test gets a fresh instance. This prevents test pollution from shared in-memory stores.

The same override mechanism works with `run` and `trailhead`:

```typescript
run(app, 'search', input, {
  provisions: { 'db.main': testDb },
});

trailhead(app, {
  provisions: { 'db.main': stagingDb },
});
```

See [Testing](./testing.md) for the full testing API.

## Topo Registration

Provisions register alongside trails through `topo()`:

```typescript
import { topo } from '@ontrails/core';
import * as entityTrails from './trails/entity';
import * as provisions from './services';

const app = topo('myapp', entityTrails, provisions);
// app.provisions -- Map<id, Provision>
```

`topo()` scans module exports for objects with `kind: 'provision'`, the same way it discovers trails and events. Duplicate provision IDs fail topo construction.

Namespace provision IDs with dots for packs and multi-provision apps: `db.primary`, `entity.store`, `cache.redis`.

## Governance

The warden provides two provision-related rules:

**`provision-declarations`** -- validates that `db.from(ctx)` and `ctx.provision(...)` calls inside the implementation match the declared `provisions: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`provision-exists`** -- validates that every provision referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

Both use the established AST analysis pattern used by `cross-declarations`.

## Design Rationale

Provisions complete the trail contract. A trail now declares what it takes (input), what it produces (output), what it crosses (crosses), and what it needs (provisions). The full dependency graph -- trails, provisions, events -- is queryable through the current topo, survey, and the committed lock artifacts.

For the complete design decision, tradeoffs, and future directions (request-scoped provisions, composable config, intent-based type narrowing), see [ADR-0009: First-Class Provisions](./adr/0009-first-class-provisions.md).
