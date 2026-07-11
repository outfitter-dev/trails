---
'@ontrails/cli': minor
'@ontrails/cloudflare': minor
'@ontrails/config': minor
'@ontrails/core': minor
'@ontrails/hono': minor
'@ontrails/http': minor
'@ontrails/library': minor
'@ontrails/mcp': minor
'@ontrails/permits': minor
'@ontrails/regrade': minor
'@ontrails/store': minor
'@ontrails/testing': minor
'@ontrails/tracing': minor
'@ontrails/trails': minor
'@ontrails/warden': minor
---

Complete the v1 hard cutover from the authored `blaze` field to
`implementation` across trail contracts, surface projections, tests, examples,
and public source-analysis helpers. Existing applications must rename authored
trail behavior fields and direct trail-object access before upgrading.
