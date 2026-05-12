---
'@ontrails/warden': patch
---

Harden Warden drift checks for lock v3 manifests. Malformed legacy lock files and manifests without the `topo.lock` artifact now report blocked drift with a regenerate instruction instead of throwing or silently passing.
