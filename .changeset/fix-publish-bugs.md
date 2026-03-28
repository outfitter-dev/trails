---
"@ontrails/core": patch
"@ontrails/cli": patch
"@ontrails/mcp": patch
"@ontrails/logging": patch
"@ontrails/testing": patch
"@ontrails/warden": patch
"@ontrails/schema": patch
"@ontrails/trails": patch
---

Fix two blocking bugs from real-world migration:

- Published packages now resolve correctly (workspace:^ instead of workspace:*)
- Error forwarding works across different success types (Err no longer carries phantom T)
