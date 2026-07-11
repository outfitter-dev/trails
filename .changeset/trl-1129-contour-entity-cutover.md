---
'@ontrails/core': minor
'@ontrails/regrade': patch
'@ontrails/store': minor
'@ontrails/testing': minor
'@ontrails/topographer': minor
'@ontrails/trails': minor
'@ontrails/warden': minor
---

Complete the v1 hard cutover from the `contour` domain-object declaration
vocabulary to `entity` across contracts, topo facts, store helpers, Warden,
Wayfinder, operator surfaces, examples, and generated locks. Existing
applications must rename contour APIs, run `trails dev reset --yes` to discard
pre-cutover local Topographer snapshots, and then recompile committed
`trails.lock` artifacts before upgrading. Those derived snapshots are
intentionally not read through a compatibility layer.
The entity-shaped wire contract advances `TopoGraph` and split lock manifests
from schema version 3 to 4; old split artifacts fail with regeneration guidance,
while the canonical root `trails.lock` remains schema version 5.
Wayfinder reports those stale rows as topo-store drift while keeping current
committed lock facts available for inspection.
