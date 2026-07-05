---
'@ontrails/adapter-kit': minor
---

Add the `Overlay` contract (namespace + elevated zod fact schema + deterministic derive function) so adapters can contribute namespaced fact overlays to `trails.lock` without any edits to the lock schema or graph type, plus an `isOverlay` guard for compile-side collection.
