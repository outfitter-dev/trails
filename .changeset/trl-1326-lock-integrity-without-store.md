---
"@ontrails/topography": patch
---

Report Wayfinder lock hash, summary, and missing topo artifact contradictions even
without a readable Topography store. Consistent locks without a store still report
missing artifacts; unreadable graph and manifest schemas keep regeneration status.
