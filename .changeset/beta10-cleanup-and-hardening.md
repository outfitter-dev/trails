---
"@ontrails/core": minor
"@ontrails/cli": patch
"@ontrails/http": patch
"@ontrails/mcp": patch
"@ontrails/warden": patch
---

Cleanup and hardening pass across all packages.

**core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Surface` type, `adapters.ts`, `health.ts`, and `job.ts` proof-of-concept from published package.

**cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out via `validate: false`.

**http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out.

**mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `blaze()` with opt-out.

**warden**: Project-aware rule context preserved in trail wrappers.
