---
"@ontrails/library": patch
---

Project typed layer inputs through the library surface and generated packages. The runtime now validates the combined public input, routes layer-owned fields into per-layer input slots, and generated packages share one held client across root and result subpaths while avoiding Bun-only ambient type assumptions in their emitted tsconfig.
