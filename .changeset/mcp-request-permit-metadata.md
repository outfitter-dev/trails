---
"@ontrails/mcp": minor
---

Resolve MCP tool permits from each request's bearer credential and application `_meta`, and remove `sessionId` from `ResolveMcpPermitInput` and `McpExtra`. Protocol sessions no longer supply permit inputs. Custom resolvers must remove session-derived state and trace identifiers; application state belongs in explicit handles in trail input/output schemas.

A configured resolver now runs even when no bearer token is present, allowing it to inspect untrusted metadata candidates or reject missing credentials according to the app's policy. Resolvers must handle absent bearer and metadata values and verify credentials before returning a permit. Explicit host-provided permits remain available for local stdio policy outside OAuth.

This establishes the MCP tool and stdio seam. The separately implemented fetch host must supply the same per-request context before fetch-path acceptance is complete.
