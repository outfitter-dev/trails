---
'@ontrails/core': patch
'@ontrails/cloudflare': patch
---

The core barrel is now execution-portable: no eager `bun:`/`node:` builtin imports remain on its module graph (TRL-1198). `trails-db`, workspace discovery, and path security load `bun:sqlite`, `node:fs`, `node:os`, and `node:path` lazily through `process.getBuiltinModule` at first use, and signal payload summaries plus per-project store keys use a pure SHA-256 (output-identical to `node:crypto`). A Worker bundle no longer needs a `bun:sqlite` stub plugin or the `nodejs_compat` flag to serve trails; the Cloudflare adapter's miniflare lane now bundles without externals and boots workerd without `nodejs_compat` as the structural regression gate, and its README stub instructions are replaced with the portable posture. Tooling helpers throw a clear `InternalError` naming the missing builtin when called on runtimes without it.
