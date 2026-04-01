# @ontrails/permits

## 1.0.0-beta.12

### Minor Changes

- Complete trifecta for config, permits, and crumbs (formerly tracks)

  - **config**: Add `configService`, `config.layer`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **crumbs**: Rename tracks to crumbs; add `crumbsService` and `crumbs.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for service and composition updates

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
