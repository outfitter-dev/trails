---
'@ontrails/cloudflare': minor
'@ontrails/core': patch
'@ontrails/warden': patch
---

Add the `@ontrails/cloudflare` adapter collection with its first two service subpaths. `@ontrails/cloudflare/workers` exports `createWorkersHandler`, a materializer producing the `{ fetch(request, env, ctx) }` Worker export on the shared HTTP fetch kernel, with an env bridge that re-resolves env-bound resources whenever a new Worker `env` arrives so no resource instance serves a request with a stale env. `@ontrails/cloudflare/kv` exports `cloudflareKv`, a resource definition wrapping a KV namespace binding (`get`/`put`/`delete`/`list` with TTL options) plus an in-memory `createMemoryKv` mock so `testAll` runs configuration-free.

`@ontrails/core` now guards the default trail context fields: `requestId` falls back to `crypto.randomUUID()` when the `Bun` global is absent, and `cwd`/`env` fall back to `'/'`/`{}` when `process` is absent, so trail execution works on runtimes like Cloudflare Workers.

`@ontrails/warden` registers the `@ontrails/cloudflare` public barrel in the repo-local `public-export-example-coverage` policy, requiring `@example` TSDoc coverage on `createWorkersHandler` and `cloudflareKv`.
