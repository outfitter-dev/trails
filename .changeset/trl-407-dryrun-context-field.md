---
'@ontrails/core': minor
'@ontrails/cli': minor
---

Add `dryRun` to `TrailContext` and wire `--dry-run`. `TrailContext` gains an optional `dryRun?: boolean` field, defaulted to `false` in `createTrailContext`. `ExecuteTrailOptions` carries `dryRun?: boolean` through `applyContextOverrides` so `executeTrail(t, input, { dryRun: true })` produces `ctx.dryRun === true`. The CLI's existing `dryRunPreset` (auto-derived for `intent: 'write' | 'destroy'` trails) now flows through `META_FLAG_CANDIDATES` and reaches the executor via `runTrailOnce`, so `trails run booking.cancel … --dry-run` lands `ctx.dryRun === true` on the trail's blaze. Trails that don't read the field are unchanged. Read-intent trails don't get `--dry-run` exposed.
