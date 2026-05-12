---
'@ontrails/trails': major
---

Cut CLI topo compile and survey diff surfaces over to the lock v3 artifact family. `topo.compile` now reports `topoPath` for `.trails/topo.lock`, survey diff accepts explicit `topo.lock` files and directories containing `topo.lock`, and new scaffolds no longer ignore committed root lock artifacts.
