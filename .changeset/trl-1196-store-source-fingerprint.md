---
"@ontrails/topographer": patch
"@ontrails/trails": patch
"@ontrails/wayfinder": patch
---

Make the per-user topo store an honest cache (TRL-1196). Every snapshot now records a content fingerprint of the app source set (`topo_snapshots.source_fingerprint`, store schema v14), `trails compile` reports it in its output, and Wayfinder artifact loading compares it against a freshly derived fingerprint — a mismatch surfaces as a `topo-store-source-fingerprint-mismatch` stale reason instead of silently serving pre-edit facts. Compile derives everything from live source on every run, so a poisoned or stale store can never reach `trails.lock`, with or without `--force`.
