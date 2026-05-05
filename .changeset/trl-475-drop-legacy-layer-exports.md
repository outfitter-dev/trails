---
'@ontrails/permits': minor
'@ontrails/cli': minor
---

**BREAKING:** TRL-475 drops user-facing exports of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`. Breaking change for any app still wiring these layers manually.

Migration:

- **`autoIterateLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now derives the `--all` flag and multi-page collection automatically from any trail whose output matches the pagination pattern (`items`, `hasMore`, `nextCursor`). See TRL-469.
- **`dateShortcutsLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now expands `since`/`until` shortcut strings (`today`, `yesterday`, `7d`, `30d`, `this-week`, `this-month`) automatically from input schema shape. See TRL-470.
- **`authLayer`** — remove from `blaze`/`run`/`surface` options. Permit scope enforcement is intrinsic to `executeTrail` (`enforcePermitRequirement` runs before resource creation and layer composition). The compatibility shim was already a no-op.

The `Layer` type, `composeLayers`, and canonical per-call `executeTrail({ layers })` option remain available; only the legacy layer exports were removed.
