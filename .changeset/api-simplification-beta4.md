---
"@ontrails/core": major
"@ontrails/cli": major
"@ontrails/mcp": major
"@ontrails/testing": major
"@ontrails/warden": major
"@ontrails/schema": major
"@ontrails/trails": major
---

API simplification: unified trail model, intent enum, blaze, metadata.

**BREAKING CHANGES:**

- `hike()` removed — use `trail()` with optional `crosses: [...]` field
- `follows` renamed to `crosses` (matching `ctx.cross()`)
- `topo.hikes` removed — single `topo.trails` map
- `kind: 'hike'` removed — everything is `kind: 'trail'`
- `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
- `implementation` field renamed to `blaze`
- `markers` field renamed to `metadata`
- `testHike` renamed to `testCrosses`, `HikeScenario` to `CrossScenario`
- `blaze()` now returns the trailhead handle (`Command` for CLI, `Server` for MCP)
