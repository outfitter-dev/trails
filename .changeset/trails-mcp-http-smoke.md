---
"@ontrails/trails": patch
---

Add the `mcp-http` release smoke. `trails release smoke --check mcp-http` (repo wrapper `bun run mcp:http-smoke`) serves the demo app's MCP surface through the fetch-shaped handler, drives it with the official SDK client on the legacy and 2026-07-28 protocol eras, exercises the network credential posture, and probes the Host and Origin boundary with raw requests. The `release.smoke` trail's `check` input accepts `mcp-http`, and `all` now includes it.
