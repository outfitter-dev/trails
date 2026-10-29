---
'@ontrails/testing': patch
---

The MCP test harness no longer forwards a protocol session id into permit resolution. Permits resolve per request from the bearer credential and `_meta`, matching the stateless MCP core; `createMcpHarness` options.extra accepts the same `McpExtra` fields minus `sessionId`.
