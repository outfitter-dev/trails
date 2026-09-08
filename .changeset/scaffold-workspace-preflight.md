---
"@ontrails/trails": patch
---

Reject workspace scaffolds nested beneath an existing configured Trails
workspace before creating target files while allowing child workspaces beneath
ancestor standalone Config. Workspace reruns also reject preserved app entries
whose runtime-selected topo ID is statically proven to conflict with the
configured app ID; dynamic, indirect, and post-construction mutation forms
continue to defer binding validation to runtime commands.
