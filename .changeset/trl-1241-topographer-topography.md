---
'@ontrails/core': patch
'@ontrails/library': patch
'@ontrails/regrade': patch
'@ontrails/source': patch
'@ontrails/topography': minor
'@ontrails/trails': patch
'@ontrails/warden': patch
---

Rename the durable graph substrate package from `@ontrails/topographer` to
`@ontrails/topography` after folding Wayfind graph queries into that owner.

Update imports to `@ontrails/topography` or
`@ontrails/topography/backend-support`. The pre-1.0 cutover does not ship a
compatibility package. TopoGraph, lock, topo-store, semantic diff, and Wayfind
APIs keep their existing contracts, and the `trails wayfind` CLI and MCP names
remain unchanged.

The governed package-route transition moves legacy `@ontrails/wayfinder`
imports directly to `@ontrails/topography`; it does not emit the retired
intermediate `@ontrails/topographer` route.
