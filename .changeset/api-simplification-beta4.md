---
"@ontrails/core": major
"@ontrails/cli": major
"@ontrails/mcp": major
"@ontrails/testing": major
"@ontrails/warden": major
"@ontrails/schema": major
"@ontrails/trails": major
---

API simplification: unified trail model, intent enum, run, metadata.

**BREAKING CHANGES:**

- `hike()` removed — use `trail()` with optional `follow: [...]` field
- `follows` renamed to `follow` (singular, matching `ctx.follow()`)
- `topo.hikes` removed — single `topo.trails` map
- `kind: 'hike'` removed — everything is `kind: 'trail'`
- `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
- `implementation` field renamed to `run`
- `markers` field renamed to `metadata`
- `testHike` renamed to `testFollows`, `HikeScenario` to `FollowScenario`
- `blaze()` now returns the surface handle (`Command` for CLI, `Server` for MCP)
