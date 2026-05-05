---
'@ontrails/cli': minor
'@ontrails/trails': minor
---

Wire the `--trace` flag for the `trails run` family. Adds `tracePreset()` to `@ontrails/cli` (registered via the `presets` option) and threads `'trace'` through `META_FLAG_CANDIDATES` so the flag is treated as CLI metadata (never routed into trail input). On activation, `apps/trails/src/cli.ts` installs a per-invocation memory sink before `surface()` runs and finalizes it in a `finally` block: the post-execution tree (rendered via `renderTraceTree` from TRL-411) goes to stderr; the result still goes to stdout. With `--trace --json`, regular `trails run <id>` emits a single JSON envelope on stdout that includes `tracing: TraceRecord[]`; `trails run example <id> <exampleName>` keeps its comparison envelope, and `trails run examples <id>` remains a metadata read. `--quiet` keeps the tree on stderr and the unwrapped value on stdout, while `--jsonl` streams items as before. Sink registration is per-invocation so concurrent runs don't bleed records.
