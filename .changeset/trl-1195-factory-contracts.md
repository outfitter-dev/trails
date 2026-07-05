---
"@ontrails/store": patch
---

Complete the store factory trail contracts (TRL-1195, absorbing TRL-1177 and TRL-1178). `crud()` gains `permit` (applied to every produced trail) and `permits` (per-operation overrides, so destroy trails satisfy permit governance) plus a `contour` option, and the returned tuple now exposes the table contour it registered as a `contour` property. `reconcile()` gains `permit` and accepts a shared `contour` instance, so crud + reconcile on one table register cleanly in a single `topo()` instead of colliding on a duplicate contour name. `TableContour` is exported from `@ontrails/store/trails`. Consuming apps no longer need to post-process factory trails to attach permits or strip contours.
