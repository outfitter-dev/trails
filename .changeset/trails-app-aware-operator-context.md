---
"@ontrails/trails": minor
"@ontrails/topography": minor
"@ontrails/warden": minor
---

Make `run`, Wayfinder navigation and semantic diff, Warden, and shell
completions use Config-owned project identity. Add stable `--app <id>`
selection and structured project provenance, preserve partial saved workspace
navigation, and require complete app-partitioned views for workspace diff.
Preserve canonical sole-app discovery for standalone run and live Wayfinder
consumers, and keep healthy shell completions available when configured sibling
apps cannot load. Keep nested app completion suggestions inside the selected
app, and retain selected project provenance plus authored inputs when running or
listing trail examples. Preserve completed `--app` selection and typed
`--root-dir` boundaries throughout dynamic completion, encode shell tokens
through the internal variadic input without losing flags, spaces, or empty
values. While an app value is still being completed, preserve its typed root
but defer app-local module selection until the app is complete. Validate
Config-owned identity on the same fresh Survey lease that derives live
Wayfinder responses. Record the executed app identity as `executedAppId` on
`run.examples` and `run.example` results so every listing and comparison names
the app that produced it, including standalone single-app runs.

Remove the superseded `buildWorkspaceTrailIndex()` package-workspace discovery
API now that no operator consumer uses it as identity.

Let Config-owning Warden consumers provide expected stable app bindings so topo
identity is validated before any safe source fixes run. Require every configured
app target to have committed app-local lock evidence before Warden claims the
workspace is current.
Expose deterministic per-app Warden drift evidence alongside the aggregate
workspace verdict.
Run the Warden artifact preflight for every topo-aware run that consumes saved
lock evidence, including `--fix` runs, and run that preflight before a fixing
run applies any safe source fix so invalid saved evidence can never rewrite
source first. Reject `wayfind diff` baselines whose recorded lock hash or
summary contradicts the embedded graph, including `--against-dir` directories.
