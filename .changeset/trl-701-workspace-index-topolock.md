---
'@ontrails/topography': major
---

Move the workspace trail index out of the lock manifest and into the serialized TopoGraph artifact. Workspace index reads now consult `topo.lock` workspace metadata, and `buildWorkspaceTrailIndex()` exposes `topo-lock` cache hits through the artifact-family path.
