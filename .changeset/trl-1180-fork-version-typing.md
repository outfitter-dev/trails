---
"@ontrails/core": patch
---

Add `forkVersion()` so fork version entries get typed blazes (TRL-1180). `TrailVersions` fixes every entry's generics to `unknown`, which left fork blazes with `unknown` input and forced authors to re-parse the already-validated value just to narrow it. `forkVersion({ input, output, blaze, ... })` threads the entry's own schemas into the blaze signature (including merged `composeInput` fields) and enforces the entry's output shape at compile time; the erasure back to `TrailVersionEntry` is sound because the fork pipeline validates raw input against the entry's own schema before dispatch. `TrailVersionForkSpec` is exported alongside it.
