---
"@ontrails/topographer": patch
"@ontrails/trails": patch
"@ontrails/warden": patch
"@ontrails/wayfinder": patch
---

Collapse normal topo compilation onto one root `trails.lock` envelope that embeds the TopoGraph, hash, and summary while keeping legacy `.trails/trails.lock` plus `.trails/topo.lock` readers for migration compatibility.
