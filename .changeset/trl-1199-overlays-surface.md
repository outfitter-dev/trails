---
'@ontrails/topographer': minor
---

Add the namespaced-overlays extension point to the topo graph: `deriveTopoGraph` accepts overlay registrations (namespace + zod schema + derive function), embeds validated facts as `overlays.<namespace>`, covers them with the canonical graph hash, and preserves unknown namespaces byte-for-byte so older toolchains never drop or reject newer overlays.
