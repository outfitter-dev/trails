---
'@ontrails/observe': patch
'@ontrails/topographer': patch
'@ontrails/wayfinder': major
---

Scaffold the initial `@ontrails/wayfinder` package shell and remove draft ADR
anchors from public source comments. Reserves the namespace and gives the
wayfinding trail catalog a clean home.

The `major` bump keeps the package in lockstep with the rest of the `@ontrails/*` workspace: with `initialVersions: "0.1.0"` in `.changeset/pre.json`, a `major` bump computes `1.0.0` on `changeset pre exit`, matching the other framework packages that carry `major` bumps in earlier changesets (`api-simplification-beta4`, `topo-store-relocation`).
