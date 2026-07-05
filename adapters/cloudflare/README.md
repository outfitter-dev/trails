# @ontrails/cloudflare

The Cloudflare adapter collection for Trails. One package, one subpath per Cloudflare service, each connecting a service to the Trails primitive it naturally serves:

| Subpath | Serves | Status |
| --- | --- | --- |
| `@ontrails/cloudflare/workers` | HTTP surface materializer (fetch handler) | ✅ |
| `@ontrails/cloudflare/kv` | Key-value resource | ✅ |
| `/d1` | Store driver | Planned |
| `/queues` | Activation source + outbound delivery | Planned |
| `/r2` | Blob/object resource | Planned |

Adapter composition doctrine applies throughout: subpaths take primitive-authored declarations (a resource definition, a surface config) and never shadow authoring verbs. Bindings arrive ambiently on the Worker `env`, so runtime dependencies are near-zero.

## `/workers` — the fetch-handler materializer

`createWorkersHandler(graph, options)` produces the `{ fetch(request, env, ctx) }` Worker export by delegating to the shared HTTP fetch kernel from `@ontrails/http` — the same kernel behind the Bun and Hono surfaces, so routes, validation, error projection, and webhook handling behave identically.

```ts
// src/worker.ts
import { createWorkersHandler } from '@ontrails/cloudflare/workers';
import { graph } from './app.js';

export default createWorkersHandler(graph, { basePath: '/api' });
```

Options mirror the other HTTP surfaces: `basePath`, `createContext`, `layers`, `maxJsonBodyBytes`, `resolvePermit`, plus include/exclude/intent filtering. `resources` accepts either a static override map or a function of the Worker env:

```ts
export default createWorkersHandler(graph, {
  resources: (env) => ({ audit: createAuditClient(env['AUDIT_URL']) }),
});
```

### The env bridge

Worker bindings (KV, D1, R2, queues) live on `env`, which arrives per request — they cannot be captured at module init. The bridge closes that gap once, for every subpath in this collection:

1. A subpath authors an ordinary `resource()` definition and registers an `EnvBindingSpec` for it (`registerEnvBinding(definition, { binding, fromEnv })`).
2. `createWorkersHandler` walks the declared resources of the trails the surface actually exposes (honoring `include`/`exclude`/`intent`, and including fork-version resources), and for each env-bound definition resolves `env[binding]` through `fromEnv` into a resource override. Explicitly overridden resource IDs skip env resolution entirely, so an override never requires its binding.
3. The kernel handler is materialized per env identity. The Workers runtime keeps `env` stable within an isolate, so steady-state requests reuse one materialization — but any request carrying a different env object re-resolves every env-bound resource before it executes.

Because resource overrides are checked before core's singleton resource cache, no resource instance can serve a request with a stale env. This guarantee has a dedicated regression test (`src/workers/__tests__/env-bridge.test.ts`).

Missing or mistyped bindings fail the request with a redacted 500 and log full diagnostics to the Worker log, naming the binding and the resource that needed it.

### Runtime notes

These come straight from the runtime-constraint audit that shipped with this subpath (each is also filed as a Trails issue):

- Enable the `nodejs_compat` compatibility flag and use a recent `compatibility_date`: modules on the `@ontrails/core` barrel import `node:fs`, `node:path`, and `node:crypto`, and workerd's `node:fs` support is compatibility-date gated (the integration lane pins `2026-06-01`).
- Stub `bun:sqlite` in your Worker bundle: the core barrel re-exports `trails-db.js`, whose top-level `import { Database } from 'bun:sqlite'` survives bundling even though the Worker never calls it, and workerd refuses module graphs importing `bun:sqlite`. With wrangler, alias it to a stub module (see the `bunSqliteStub` plugin in `src/__tests__/miniflare.test.ts` for the shape).
- Explicit `resources` overrides win over env-bound resolution, which is how tests substitute fakes.

## `/kv` — the key-value resource

`cloudflareKv(id, { binding })` authors a resource wrapping a KV namespace binding. Trails declare it with `resources: [...]` and read it with `flags.from(ctx)` — the standard accessor pattern.

```ts
import { cloudflareKv } from '@ontrails/cloudflare/kv';
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const showFlag = trail('flag.show', {
  blaze: async (input, ctx) => {
    const value = await flags.from(ctx).get(input.key);
    return Result.ok({ value });
  },
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});
```

The client surface is `get`/`put`/`delete`/`list`, with TTL options on `put` (`expirationTtl` in seconds, or an absolute `expiration` Unix timestamp) and prefix/limit/cursor pagination on `list`. A real `KVNamespace` binding satisfies the shape structurally, so the env bridge passes it through unchanged.

Declare the binding in wrangler config:

```toml
kv_namespaces = [
  { binding = "FLAGS", id = "<namespace-id>" }
]
```

### Testing with the mock

Every `cloudflareKv` resource carries an in-memory mock factory, so `testAll(app)` runs configuration-free — no Cloudflare account, no wrangler:

```ts
import { testAll } from '@ontrails/testing';
import { graph } from '../src/app.js';

testAll(graph);
```

`createMemoryKv()` is also exported directly for hand-rolled tests, with an injectable clock for TTL assertions. Two documented divergences from the real binding: the mock does not enforce KV's 60-second minimum TTL, and when both `expiration` and `expirationTtl` are passed the mock prefers `expirationTtl` where the real binding rejects the combination.

## Local integration testing

Integration runs are local-first via [miniflare](https://miniflare.dev) (workerd in-process): the test lane bundles a demo Worker with `Bun.build`, boots it with a real KV namespace, and exercises HTTP, webhook, and KV routes. See `src/__tests__/miniflare.test.ts`. Real-account deploys are manual and never CI-required.
