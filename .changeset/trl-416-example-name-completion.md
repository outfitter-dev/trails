---
'@ontrails/trails': minor
---

Add example-name completion to the dynamic suggestion endpoint. When the user tab-completes the example-name argument in `trails run example <trail-id> <prefix>`, the completion returns the named trail's `examples` array (filtered by prefix, sorted). New `renderTrailExampleCompletions(workspaceRoot, trailId, prefix)` helper resolves the trail's owning app via the workspace index, loads the topo with `tryLoadFreshAppLease`, and derives examples via `deriveStructuredTrailExamples`. Recoverable load/lookup failures return typed `RecoverableCompletionError` values from the helper and are suppressed to `[]` only at the internal `completions.__complete` shell boundary so tab completion stays quiet.
