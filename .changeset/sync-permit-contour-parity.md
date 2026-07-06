---
'@ontrails/store': patch
---

`sync()` gains the factory-contract options `crud()` and `reconcile()` received in TRL-1195: a `permit` option declared on the produced trail, and per-endpoint `contour` options on `SyncEndpoint` so a `crud()` bundle's table contour can be shared instead of colliding as a duplicate registration at `topo()`.
