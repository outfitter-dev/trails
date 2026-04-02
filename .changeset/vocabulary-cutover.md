---
"@ontrails/core": minor
"@ontrails/cli": minor
"@ontrails/config": minor
"@ontrails/http": minor
"@ontrails/mcp": minor
"@ontrails/permits": minor
"@ontrails/schema": minor
"@ontrails/testing": minor
"@ontrails/tracker": minor
"@ontrails/warden": minor
"@ontrails/logging": minor
---

Trail-native vocabulary cutover. Breaking API field renames across all packages:

- Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `provisions:`, `metadata:` → `meta:`, `emits:` → `signals:`
- Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.signal()`, `ctx.signal` (abort) → `ctx.abortSignal`
- Entry points: `blaze(app)` → `trailhead(app)`
- Package rename: `@ontrails/crumbs` → `@ontrails/tracker`
- Wrapper types: `Layer` → `Gate`, `layers`/`middleware` → `gates`
- Transport: `surface` → `trailhead`, `adapter` → `connector`
