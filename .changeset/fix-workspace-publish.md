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

Fix workspace dependency resolution in published packages. Now using bun publish
which correctly replaces workspace:^ with actual version numbers.
