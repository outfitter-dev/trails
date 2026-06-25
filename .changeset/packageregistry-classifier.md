---
'@ontrails/trails': patch
---

Consolidate registry verdicts behind one shared `packageRegistry` classifier.

`apps/trails/src/release` now derives every package's registry state — `complete`, `needs-publish`, `first-time-package`, `needs-tag-repair`, `tag-points-ahead`, `registry-inaccessible` — from a single `classifyPackageRegistryState` function, fed by an exact-version probe (`npm view <name>@<version>`). The release policy engine and the registry preflight both consume it, so their verdicts can no longer drift, and the missing "is the target version actually published" fact is now first-class.

The preflight check is phase-aware: `publish:registry-check` (ready) treats an unpublished target or a behind dist-tag as expected pre-publish work rather than a failure, while `publish:registry-check:published` still requires every package to be fully published and tagged. This fixes the confusing failure seen when the repo is several releases ahead of the published `beta` tag. Exact-version probes run with bounded concurrency so release checks stay responsive. No publish or dist-tag mutation is performed.
