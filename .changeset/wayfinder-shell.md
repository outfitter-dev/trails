---
'@ontrails/wayfinder': major
---

Scaffold the empty `@ontrails/wayfinder` package shell. Reserves the namespace and gives the v0 wayfinding trails a clean home; no trails ship yet. v0 catalog is specified in the wayfinding draft ADR (`docs/adr/drafts/20260503-wayfinding.md`).

The `major` bump keeps the package in lockstep with the rest of the `@ontrails/*` workspace: with `initialVersions: "0.1.0"` in `.changeset/pre.json`, a `major` bump computes `1.0.0` on `changeset pre exit`, matching the other framework packages that carry `major` bumps in earlier changesets (`api-simplification-beta4`, `topo-store-relocation`).
