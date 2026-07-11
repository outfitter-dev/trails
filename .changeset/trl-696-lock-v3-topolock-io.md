---
'@ontrails/topography': major
'@ontrails/trails': patch
'@ontrails/warden': patch
---

Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
