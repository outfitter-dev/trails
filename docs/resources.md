# Resources

Trails implementations are pure functions -- input in, `Result` out. But real implementations need databases, API clients, caches, and queues. Without a dependency mechanism, every trail constructs its own connections inline. Tests can't swap them, the framework can't manage lifecycle, and governance can't see what a trail actually needs. Resources fill that gap. They make dependencies declarative, injectable, and governable.

## Defining a Resource

Use `resource()` to create a typed resource definition:

```typescript
import { resource, Result } from '@ontrails/core';

const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
```

The type of the resource instance is inferred from the `create` factory return. No manual generic needed.

| Field | Purpose |
| --- | --- |
| `create` | Factory returning `Result<T, Error>`. Receives a `ResourceContext` with `env`, `cwd`, and `workspaceRoot` only -- not the full `TrailContext`. |
| `dispose` | Optional cleanup on shutdown. Database pools close, API clients disconnect. |
| `health` | Optional readiness probe. Feeds into topo and survey reporting plus operational checks. |
| `mock` | Optional test factory. When present, `testExamples(graph)` uses it automatically. |
| `description` | Human-readable label for topo or survey output and agent introspection. |

The `create` factory receives `ResourceContext` -- a narrow subset of `TrailContext` -- because resources are singletons resolved once per process. Request-scoped fields like `requestId` would be stale after the first resolution.

## Resource Config Schemas

Resources can declare a `config` field with a Zod schema. When present, the framework validates the resource's config slice during resolution and passes the typed result to the `create` factory via `svc.config`:

```typescript
import { resource, Result } from '@ontrails/core';
import { z } from 'zod';

const db = resource('db.main', {
  config: z.object({ poolSize: z.number(), url: z.string().url() }),
  create: (svc) => Result.ok(openPool(svc.config.url, svc.config.poolSize)),
  dispose: (pool) => pool.end(),
  mock: () => createInMemoryDb(),
});
```

The config values come from the resolved app config, keyed by resource ID. `@ontrails/config` provides `collectResourceConfigs()` to gather all resource config schemas from a topo, and `defineConfig()` to wire profile-based resolution into the bootstrap pipeline. Resources without a `config` schema receive `unknown` and ignore `svc.config`.

## Declaring Resources on a Trail

Add resources to the trail spec with the `resources` array:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

const search = trail('search', {
  resources: [db],
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

The `resources` array is a flat set of resource objects, parallel to `crosses` for trail composition. Resource objects carry their type from the factory return, so `db.from(ctx)` infers the correct type at the call site.

## Accessing Resources

The primary access pattern uses the resource definition as a typed accessor:

```typescript
const conn = db.from(ctx); // typed as the return of create()
```

The escape hatch for dynamic or string-based access:

```typescript
const conn = ctx.resource<Database>('db.main');
```

Both resolve the same way at runtime. Prefer `db.from(ctx)` -- it carries the type automatically.

## Resource Lifecycle

Resources are app-scoped singletons in v1. Created once on first resolution, cached for the process lifetime, disposed on shutdown.

Resolution happens eagerly during `executeTrail`, after input validation and before layer composition:

1. Validate input
2. Resolve context
3. **Resolve resources** (create singletons or retrieve cached)
4. Compose layers
5. Execute implementation

This means failures surface at the boundary -- a missing `DATABASE_URL` fails before the implementation runs, not on line 47. It also means layers can access resources via `db.from(ctx)` because resolution is already complete.

Shutdown signaling differs by trailhead. CLI tools dispose after the command completes. Long-running servers (MCP, HTTP) dispose on `SIGTERM`/`SIGINT`. The trailhead's `surface()` owns the lifecycle.

## Testing with Resources

Resources with a `mock` factory auto-resolve during `testAll`, `testExamples`, and `testContracts`:

```typescript
import { testAll } from '@ontrails/testing';
import { graph } from '../app';

// db.mock() is used automatically -- no configuration
testAll(graph);
```

Override explicitly when you need specific behavior:

```typescript
testAll(graph, () => ({
  resources: { 'db.main': createSpecialTestDb() },
}));
```

Pass a factory (the `() => ({...})` form) when overrides contain mutable state, so each test gets a fresh instance. This prevents test pollution from shared in-memory stores.

The same override mechanism works with `run` and `surface()`:

```typescript
run(graph, 'search', input, {
  resources: { 'db.main': testDb },
});

surface(graph, {
  resources: { 'db.main': stagingDb },
});
```

See [Testing](./testing.md) for the full testing API.

## Topo Registration

Resources register alongside trails through `topo()`:

```typescript
import { topo } from '@ontrails/core';
import * as entityTrails from './trails/entity';
import * as resources from './services';

const graph = topo('myapp', entityTrails, resources);
// app.resources -- Map<id, Resource>
```

`topo()` scans module exports for objects with `kind: 'resource'`, the same way it discovers trails and events. Duplicate resource IDs fail topo construction.

Namespace resource IDs with dots for packs and multi-resource apps: `db.primary`, `entity.store`, `cache.redis`.

## Governance

The warden provides two resource-related rules:

**`resource-declarations`** -- validates that `db.from(ctx)` and `ctx.resource(...)` calls inside the implementation match the declared `resources: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`resource-exists`** -- validates that every resource referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

Both use the established AST analysis pattern used by `cross-declarations`.

## Design Rationale

Resources complete the trail contract. A trail now declares what it takes (input), what it produces (output), what it crosses (crosses), and what it needs (resources). The full dependency graph -- trails, resources, events -- is queryable through the current topo, survey, and the committed lock artifacts.

For the complete design decision, tradeoffs, and future directions (request-scoped resources, composable config, intent-based type narrowing), see [ADR-0009: First-Class Resources](./adr/0009-first-class-resources.md).
