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

- The core execution path is runtime-portable (TRL-1198): `@ontrails/core` loads `bun:sqlite` and `node:` builtins lazily at first use, so a Worker bundle needs no stub plugin and no `nodejs_compat` flag to serve trails. The integration lane (`src/__tests__/miniflare.test.ts`) bundles the demo Worker with no externals and boots workerd without `nodejs_compat` as the structural regression gate.
- Tooling helpers on the core barrel (the trails-db store, workspace discovery) still require a Bun or Node runtime when actually called; on workerd they throw a clear `InternalError` naming the missing builtin instead of poisoning the module graph.
- Explicit `resources` overrides win over env-bound resolution, which is how tests substitute fakes.

## `/kv` — the key-value resource

`cloudflareKv(id, { binding })` authors a resource wrapping a KV namespace binding. Trails declare it with `resources: [...]` and read it with `flags.from(ctx)` — the standard accessor pattern.

```ts
import { cloudflareKv } from '@ontrails/cloudflare/kv';
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });

const showFlag = trail('flag.show', {
  implementation: async (input, ctx) => {
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

## Lock facts

`cloudflareOverlay` (root export) is the adapter's lock overlay overlay: an `Overlay` pairing the `cloudflare` namespace with an elevated zod fact schema and a deterministic derive over the app's topo. It records every env-bound resource as `{ binding, resourceId }` so the committed `trails.lock` documents which wrangler bindings the app depends on.

An app opts in by exporting the overlay list next to its topo, then compiling:

```ts
// src/app.ts
import { cloudflareOverlay } from '@ontrails/cloudflare';

export const app = topo('my-worker', { readFlag });
export const trailsOverlays = [cloudflareOverlay];
```

`trails compile` validates the derived facts against the schema and embeds them as `overlays.cloudflare`; `trails wayfind --facts cloudflare` reads them back. Toolchains that predate a overlay's namespace preserve it byte-for-byte — adding a new fact family never edits the lock schema or graph type.
