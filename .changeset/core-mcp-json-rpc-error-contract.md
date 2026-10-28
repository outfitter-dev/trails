---
"@ontrails/core": minor
"@ontrails/mcp": minor
---

Correct the default JSON-RPC `not_found` code from `-32601` (method not found) to `-32001`. Clients matching the previous numeric code must update or use the error category; HTTP status and CLI exit mappings are unchanged.

Export the shared JSON-RPC error data shape and public rendering helper from core, with a method-specific override for MCP `resources/read`. Unknown MCP resources retain protocol code `-32602` and now include `data.category`, `data.name`, and `data.retryable`. Trail failures remain `isError` tool results with shared metadata and public redaction.
