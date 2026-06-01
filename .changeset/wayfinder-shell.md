---
'@ontrails/observe': patch
'@ontrails/topographer': patch
'@ontrails/wayfinder': major
---

Scaffold the empty `@ontrails/wayfinder` package shell and remove draft ADR
anchors from public source comments. Reserves the namespace and gives future
wayfinding trails a clean home; no trails ship yet.

The `major` bump keeps the package in lockstep with the rest of the `@ontrails/*` workspace: with `initialVersions: "0.1.0"` in `.changeset/pre.json`, a `major` bump computes `1.0.0` on `changeset pre exit`, matching the other framework packages that carry `major` bumps in earlier changesets (`api-simplification-beta4`, `topo-store-relocation`).
