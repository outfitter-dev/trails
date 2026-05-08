---
"@ontrails/warden": minor
"@ontrails/trails": patch
---

Extend `runWarden` into the shared Warden orchestration entrypoint with effective config resolution, depth/fail thresholds, rule facets, and multi-topo report metadata.

Adapt the built-in `trails warden` wrapper to consume the readonly Warden report diagnostics contract without weakening its output schema.
