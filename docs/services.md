# Services

Trails implementations are pure functions -- input in, `Result` out. But real implementations need databases, API clients, caches, and queues. Without a dependency mechanism, every trail constructs its own connections inline. Tests can't swap them, the framework can't manage lifecycle, and governance can't see what a trail actually needs. Services fill that gap. They make dependencies declarative, injectable, and governable.

## Defining a Service

Use `service()` to create a typed service definition:

```typescript
import { service, Result } from '@ontrails/core';

const db = service('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
```

The type of the service instance is inferred from the `create` factory return. No manual generic needed.

| Field | Purpose |
| --- | --- |
| `create` | Factory returning `Result<T, Error>`. Receives a `ServiceContext` with `env`, `cwd`, and `workspaceRoot` only -- not the full `TrailContext`. |
| `dispose` | Optional cleanup on shutdown. Database pools close, API clients disconnect. |
| `health` | Optional readiness probe. Feeds into `survey --brief` and operational checks. |
| `mock` | Optional test factory. When present, `testExamples(app)` uses it automatically. |
| `description` | Human-readable label for survey output and agent introspection. |

The `create` factory receives `ServiceContext` -- a narrow subset of `TrailContext` -- because services are singletons resolved once per process. Request-scoped fields like `requestId` would be stale after the first resolution.

## Service Config Schemas

Services can declare a `config` field with a Zod schema. When present, the framework validates the service's config slice during resolution and passes the typed result to the `create` factory via `svc.config`:

```typescript
import { service, Result } from '@ontrails/core';
import { z } from 'zod';

const db = service('db.main', {
  config: z.object({ poolSize: z.number(), url: z.string().url() }),
  create: (svc) => Result.ok(openPool(svc.config.url, svc.config.poolSize)),
  dispose: (pool) => pool.end(),
  mock: () => createInMemoryDb(),
});
```

The config values come from the resolved app config, keyed by service ID. `@ontrails/config` provides `collectServiceConfigs()` to gather all service config schemas from a topo, and `defineConfig()` to wire loadout-based resolution into the bootstrap pipeline. Services without a `config` schema receive `unknown` and ignore `svc.config`.

## Declaring Services on a Trail

Add services to the trail spec with the `services` array:

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

const search = trail('search', {
  services: [db],
  intent: 'read',
  input: z.object({ query: z.string() }),
  output: z.array(z.object({ id: z.string(), title: z.string() })),
  run: async (input, ctx) => {
    const conn = db.from(ctx);
    const results = await conn.search(input.query);
    return Result.ok(results);
  },
});
```

The `services` array is a flat set of service objects, parallel to `follow` for trail composition. Service objects carry their type from the factory return, so `db.from(ctx)` infers the correct type at the call site.

## Accessing Services

The primary access pattern uses the service definition as a typed accessor:

```typescript
const conn = db.from(ctx); // typed as the return of create()
```

The escape hatch for dynamic or string-based access:

```typescript
const conn = ctx.service<Database>('db.main');
```

Both resolve the same way at runtime. Prefer `db.from(ctx)` -- it carries the type automatically.

## Service Lifecycle

Services are app-scoped singletons in v1. Created once on first resolution, cached for the process lifetime, disposed on shutdown.

Resolution happens eagerly during `executeTrail`, after input validation and before layer composition:

1. Validate input
2. Resolve context
3. **Resolve services** (create singletons or retrieve cached)
4. Compose layers
5. Execute implementation

This means failures surface at the boundary -- a missing `DATABASE_URL` fails before the implementation runs, not on line 47. It also means layers can access services via `db.from(ctx)` because resolution is already complete.

Shutdown signaling differs by surface. CLI tools dispose after the command completes. Long-running servers (MCP, HTTP) dispose on `SIGTERM`/`SIGINT`. The surface's `trailhead()` owns the lifecycle.

## Testing with Services

Services with a `mock` factory auto-resolve during `testAll`, `testExamples`, and `testContracts`:

```typescript
import { testAll } from '@ontrails/testing';
import { app } from '../app';

// db.mock() is used automatically -- no configuration
testAll(app);
```

Override explicitly when you need specific behavior:

```typescript
testAll(app, () => ({
  services: { 'db.main': createSpecialTestDb() },
}));
```

Pass a factory (the `() => ({...})` form) when overrides contain mutable state, so each test gets a fresh instance. This prevents test pollution from shared in-memory stores.

The same override mechanism works with `dispatch` and `trailhead`:

```typescript
dispatch(app, 'search', input, {
  services: { 'db.main': testDb },
});

trailhead(app, {
  services: { 'db.main': stagingDb },
});
```

See [Testing](./testing.md) for the full testing API.

## Topo Registration

Services register alongside trails through `topo()`:

```typescript
import { topo } from '@ontrails/core';
import * as entityTrails from './trails/entity';
import * as services from './services';

const app = topo('myapp', entityTrails, services);
// app.services -- Map<id, Service>
```

`topo()` scans module exports for objects with `kind: 'service'`, the same way it discovers trails and events. Duplicate service IDs fail topo construction.

Namespace service IDs with dots for packs and multi-service apps: `db.primary`, `entity.store`, `cache.redis`.

## Governance

The warden provides two service-related rules:

**`service-declarations`** -- validates that `db.from(ctx)` and `ctx.service(...)` calls inside the implementation match the declared `services: [...]` array. Undeclared usage is an error. Unused declarations are a warning.

**`service-exists`** -- validates that every service referenced in trail declarations exists in the topo. Same pattern as `valid-detour-refs`.

Both follow the established AST analysis pattern used by `follow-declarations`.

## Design Rationale

Services complete the trail contract. A trail now declares what it takes (input), what it produces (output), what it composes (follow), and what it needs (services). The full dependency graph -- trails, services, events -- is queryable through survey.

For the complete design decision, tradeoffs, and future directions (request-scoped services, composable config, intent-based type narrowing), see [ADR-0009: Services as a First-Class Primitive](./adr/0009-services.md).
