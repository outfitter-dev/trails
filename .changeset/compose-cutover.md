---
'@ontrails/core': major
'@ontrails/testing': major
'@ontrails/topography': major
'@ontrails/warden': major
'@ontrails/cli': major
'@ontrails/trails': major
'@ontrails/commander': patch
'@ontrails/http': patch
'@ontrails/mcp': patch
'@ontrails/observe': patch
'@ontrails/tracing': patch
---

Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
