# @ontrails/cloudflare

## 1.0.0-beta.39

### Minor Changes

- [`cc169e2`](https://github.com/outfitter-dev/trails/commit/cc169e2a9b580036b0c6e4ce77d396db6a34f830): Add `cloudflareOverlay`, the first lock overlay overlay: it derives the app's env-bound resources into `overlays.cloudflare` (wrangler binding name per resource) when the app exports it via `trailsOverlays` and runs `trails compile`.

### Patch Changes

- [`6b75a46`](https://github.com/outfitter-dev/trails/commit/6b75a46ab6210237d306cceade833bf9ce6e7431): The core barrel is now execution-portable: no eager `bun:`/`node:` builtin imports remain on its module graph (TRL-1198). `trails-db`, workspace discovery, and path security load `bun:sqlite`, `node:fs`, `node:os`, and `node:path` lazily through `process.getBuiltinModule` at first use, and signal payload summaries plus per-project store keys use a pure SHA-256 (output-identical to `node:crypto`). A Worker bundle no longer needs a `bun:sqlite` stub plugin or the `nodejs_compat` flag to serve trails; the Cloudflare adapter's miniflare lane now bundles without externals and boots workerd without `nodejs_compat` as the structural regression gate, and its README stub instructions are replaced with the portable posture. Tooling helpers throw a clear `InternalError` naming the missing builtin when called on runtimes without it.

## 1.0.0-beta.38

### Minor Changes

- [`a105127`](https://github.com/outfitter-dev/trails/commit/a105127e5662ed9a6c245125f791fb0182da3f5e): Add the `@ontrails/cloudflare` adapter collection with its first two service subpaths. `@ontrails/cloudflare/workers` exports `createWorkersHandler`, a materializer producing the `{ fetch(request, env, ctx) }` Worker export on the shared HTTP fetch kernel, with an env bridge that re-resolves env-bound resources whenever a new Worker `env` arrives so no resource instance serves a request with a stale env. `@ontrails/cloudflare/kv` exports `cloudflareKv`, a resource definition wrapping a KV namespace binding (`get`/`put`/`delete`/`list` with TTL options) plus an in-memory `createMemoryKv` mock so `testAll` runs configuration-free.

  `@ontrails/core` now guards the default trail context fields: `requestId` falls back to `crypto.randomUUID()` when the `Bun` global is absent, and `cwd`/`env` fall back to `'/'`/`{}` when `process` is absent, so trail execution works on runtimes like Cloudflare Workers.

  `@ontrails/warden` registers the `@ontrails/cloudflare` public barrel in the repo-local `public-export-example-coverage` policy, requiring `@example` TSDoc coverage on `createWorkersHandler` and `cloudflareKv`.
