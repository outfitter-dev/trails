---
"@ontrails/trails": minor
---

Update `trails warden` to use the shared `@ontrails/warden` command surface and final Sprint 1 flags.

The integrated CLI now projects `--ci`, `--pre-push`, `--depth`, `--fail-on`, `--strict`, `--format`, `--lock`, `--drafts`, `--apps`, `--no-lock-mutation`, and the local Warden aliases into the same runner used by the package `warden` bin. The old `lintOnly`, `driftOnly`, and `tier` inputs are replaced by `--depth` and `--lock` semantics.
