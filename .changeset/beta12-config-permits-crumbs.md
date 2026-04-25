---
"@ontrails/config": minor
"@ontrails/permits": minor
"@ontrails/tracing": minor
"@ontrails/core": patch
"@ontrails/cli": patch
"@ontrails/testing": patch
"@ontrails/mcp": patch
"@ontrails/http": patch
---

Complete trifecta for config, permits, and tracker (formerly tracks)

- **config**: Add `configProvision`, `configGate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
- **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
- **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured signal tracking
- **cli**: Fix build flag handling and improve bootstrap scaffolding
- **testing**: Expand test context helpers and example-based testing utilities
- **core/mcp/http**: Internal alignment for provision and composition updates
