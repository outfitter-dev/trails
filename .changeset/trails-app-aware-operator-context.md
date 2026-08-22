---
"@ontrails/trails": minor
"@ontrails/topography": minor
"@ontrails/warden": minor
---

Make `run`, Wayfinder navigation and semantic diff, Warden, and shell
completions use Config-owned project identity. Add stable `--app <id>`
selection and structured project provenance, preserve partial saved workspace
navigation, and require complete app-partitioned views for workspace diff.

Remove the superseded `buildWorkspaceTrailIndex()` package-workspace discovery
API now that no operator consumer uses it as identity.

Let Config-owning Warden consumers provide expected stable app bindings so topo
identity is validated before any safe source fixes run.
