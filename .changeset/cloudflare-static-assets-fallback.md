---
'@ontrails/http': minor
'@ontrails/cloudflare': minor
---

Add an optional HTTP dispatch-miss callback and Workers host.assets binding configuration. Unmatched HTTP method/path requests can delegate to the native assets binding while matched trail responses, errors and the exact MCP endpoint remain terminal. Apps without assets configuration retain the standard HTTP 404. Saved deploy facts and generated front-router configuration remain separate work.
