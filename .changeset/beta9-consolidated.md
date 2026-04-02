---
"@ontrails/core": minor
"@ontrails/cli": minor
"@ontrails/http": minor
"@ontrails/mcp": minor
"@ontrails/schema": minor
"@ontrails/testing": minor
"@ontrails/warden": minor
---

Consolidated improvements across all trailhead packages.

**core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `dispatch()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

**http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

**mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

**cli**: Verify exception catching via centralized `executeTrail`.

**testing**: Follow context awareness improvements.

**warden**: Refactor rules as composable trails with examples.

**schema**: Error code and empty body fixes.
