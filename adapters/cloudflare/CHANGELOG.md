# @ontrails/cloudflare

## 1.0.0-beta.45

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`9874e0b`](https://github.com/outfitter-dev/trails/commit/9874e0bb034c0f98edeb19833d9d3519c2a07a4c): Add `@ontrails/cloudflare/d1`, an env-bound Cloudflare D1 store resource for `@ontrails/store` definitions. The new subpath exports `cloudflareD1` and `connectD1`, supports the backend-agnostic store accessor contract (`get`, `list`, `upsert`, `remove`), versioned-table optimistic concurrency, fixture/mock seeding, store-derived write signals, Miniflare-backed conformance tests, and Worker env-bridge integration.

  `@ontrails/core` and `@ontrails/store` no longer require the Bun global for signal fire ids or late-bound store signal tokens, so store definitions and store-derived signal emission work inside Worker modules. `@ontrails/warden` now treats `cloudflareD1` as a required Cloudflare public export with `@example` coverage.

- [`1e64ee7`](https://github.com/outfitter-dev/trails/commit/1e64ee7bc270901486c5bb51ac38bf045c924adc): Add first-class queue activation sources with `queue()` in `@ontrails/core`.
  Queue sources validate their runtime queue name and parse contract, project the
  queue name into durable topo facts, participate in activation input
  compatibility, and block established outputs when malformed.

  Add `@ontrails/cloudflare/queues` with `cloudflareQueue`, `createMemoryQueue`,
  and `createQueueHandler`. Cloudflare Workers now expose both `fetch` and
  `queue` entrypoints from `createWorkersHandler`, resolve env-bound resources for
  queue-activated trails, acknowledge successful/skipped/cancelled messages, and
  acknowledge traced non-retryable Trails errors so permanently invalid messages
  do not churn through the queue. Failures explicitly marked retryable enter
  Cloudflare's retry and DLQ flow, with rate-limit delays preserved.

  `@ontrails/warden` now treats queue activation sources as materialized and
  requires `cloudflareQueue` public export example coverage.

- [`4086b5b`](https://github.com/outfitter-dev/trails/commit/4086b5b2f01b24660924fd8b667523f38caaed29): Add `@ontrails/cloudflare/r2`, an env-bound Cloudflare R2 bucket resource with
  `cloudflareR2`, `createMemoryR2`, and `r2ObjectToBlobRef`. The resource
  materializes Worker `r2_buckets` bindings through the shared env bridge, records
  Cloudflare lock overlay facts, carries an in-memory object mock for
  configuration-free tests, and documents the supported object operations plus
  streaming/metadata boundaries.

  `@ontrails/warden` now treats `cloudflareR2` as a required Cloudflare public
  export with `@example` coverage.

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.

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
