---
'@ontrails/trails': minor
'@ontrails/config': patch
---

Resolve one shared project context for `trails compile` and `trails validate`.
Configured workspaces now select apps through `--app` or app-root CWD, compile
exactly one app lock without root fanout, validate either one app or the complete
workspace, enforce configured topo-name binding and collection boundaries, and
return machine-readable selection and completeness provenance. Project-root
discovery can now be bounded to one working tree so linked and nested checkouts
do not borrow identity from a parent collection.
