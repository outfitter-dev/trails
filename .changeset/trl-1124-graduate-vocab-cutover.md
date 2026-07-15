---
'@ontrails/oxlint-plugin': patch
'@ontrails/regrade': minor
'@ontrails/topography': patch
'@ontrails/trails': minor
'@ontrails/warden': patch
---

Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
structured migration plans, safe rewrites, classification, census, CLI/MCP
reports, and immutable history. Remove the obsolete source exemptions so
Oxlint and Warden enforce the durable transition contract directly, and add a
history-driven Regrade audit surface for current-tree regression checks.
