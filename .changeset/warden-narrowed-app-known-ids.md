---
'@ontrails/warden': patch
---

Keep file-authored signal, resource, entity, and trail definitions known to existence rules for workspace files outside a narrowed app selection. A `trails warden --app <id>` run scans the whole configured workspace but previously built its known-id sets only from the selected app's topo, so honest references in unselected apps — such as a demo trail's `on:` reference to its own declared signal — failed `on-references-exist`. Loaded topos stay authoritative for files under their app-local roots, and root-less topo targets keep governing the entire scan.
