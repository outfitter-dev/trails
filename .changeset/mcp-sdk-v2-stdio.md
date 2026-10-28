---
"@ontrails/mcp": minor
---

Migrate MCP stdio serving to the official SDK v2 and its protocol-aware `serveStdio` entry. Replace the `@modelcontextprotocol/sdk` peer with `@modelcontextprotocol/server ^2.4.0`. `surface(graph)` remains the stdio one-liner and supports modern 2026-07-28 and legacy connections.

This is a documented 0.x break. Custom stdio hosts must change `await connectStdio(server)` to `const connection = await connectStdio(() => createServer(graph))` and close the returned connection handle. The factory must return a fresh server for SDK discovery and connection selection. Remove copied `transport: 'stdio'` properties; that documented option never existed.

Non-image blob results now emit valid embedded binary resources with nested `resource: { uri, mimeType, blob }` instead of invalid flat resource entries. Non-image streams are read and buffered into base64. Custom consumers must use the nested resource shape. Structured trail output descriptors are unchanged. MCP content types now follow the SDK's discriminated content shapes.

Session-permit API removal, the fetch-shaped handler, modern scalar/array output contract changes, and the temporary adopter migration skill have separate implementation gates.
