---
'@ontrails/warden': minor
---

Add one warden rule coaching against the removed legacy layer API. `no-legacy-layer-imports` (error) flags any source-string reference to `authLayer`, `autoIterateLayer`, or `dateShortcutsLayer` and points the developer at the migration paths (CLI surface derivation for pagination/date-shortcuts; intrinsic permit enforcement for auth). Allow-list covers the migration notes in `packages/cli/src/{pagination,date-shortcuts}.ts` and the rule's own files. The rule is classified `lifecycle: temporary` with a `retireWhen` string tying it to the legacy layer migration window. Trail count bumps 45 → 46.
