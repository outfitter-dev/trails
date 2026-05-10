---
"@ontrails/core": minor
"@ontrails/cli": minor
"@ontrails/config": minor
"@ontrails/http": minor
"@ontrails/mcp": minor
"@ontrails/permits": minor
"@ontrails/topographer": minor
"@ontrails/testing": minor
"@ontrails/tracing": minor
"@ontrails/warden": minor
---

Trail-native vocabulary cutover. Breaking API field renames across all packages:

- Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
- Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
- Entry points: `trailhead(app)` → `surface(app)`
- Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
- Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
- Package taxonomy: retired connector vocabulary in favor of adapters
