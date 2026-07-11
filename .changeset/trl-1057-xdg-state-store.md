---
"@ontrails/core": patch
"@ontrails/trails": patch
"@ontrails/tracing": patch
"@ontrails/topography": patch
---

Move the default `trails.db` location to the per-user Trails state store, expose deterministic state-store path helpers, stop scaffolding disposable `.trails/cache` and `.trails/state` directories, and update topo-store documentation for the global-state substrate.
