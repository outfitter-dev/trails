---
'@ontrails/config': patch
'@ontrails/topography': patch
---

Share the workspace discovery ignored-directory profile, including `.cache`,
between static Config discovery and the workspace lock census. Prune ignored
descendants of configured apps while preserving traversal to explicitly configured
roots beneath ignored ancestors. Cached config markers and locks no longer imply
additional workspace or app ownership during outer discovery.
