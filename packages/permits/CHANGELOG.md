# @ontrails/permits

## 1.0.0-beta.18

### Patch Changes

- @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- 200bece: BREAKING: rename auth connector vocabulary to adapter.

  This stays on the current `1.0.0-beta` prerelease line: the package is part of
  the fixed `@ontrails/*` beta group, so beta-breaking API renames advance the
  next beta rather than opening a stable-major release line.

  - `AuthConnector` -> `AuthAdapter`
  - `authConnectorSchema` -> `authAdapterSchema`
  - `JwtConnectorOptions` -> `JwtAdapterOptions`
  - `createJwtConnector` -> `createJwtAdapter`
  - auth resource config discriminant `{ connector: 'jwt' | 'none' }` -> `{ adapter: 'jwt' | 'none' }`

  The `@ontrails/permits/jwt` subpath is unchanged. The internal `connectors/`
  source directory becomes `adapters/`. See
  `docs/migration/connector-to-adapter.md` for the full rename map.

  The Trails CLI package updates its generated auth-resource configuration to use
  the new `adapter` discriminant.

### Minor Changes

- 73622ae: Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT adapter from typed config while preserving existing mock and override paths.
- 4b8d13b: **BREAKING:** Remove the deprecated `AuthCredentials` alias from the permits public API.

  Use `PermitExtractionInput` instead. See `docs/migration/trailhead-to-surface.md` for the full migration map.

- 66056ac: **BREAKING:** TRL-475 drops user-facing exports of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`. Breaking change for any app still wiring these layers manually.

  Migration:

  - **`autoIterateLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now derives the `--all` flag and multi-page collection automatically from any trail whose output matches the pagination pattern (`items`, `hasMore`, `nextCursor`). See TRL-469.
  - **`dateShortcutsLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now expands `since`/`until` shortcut strings (`today`, `yesterday`, `7d`, `30d`, `this-week`, `this-month`) automatically from input schema shape. See TRL-470.
  - **`authLayer`** — remove from `blaze`/`run`/`surface` options. Permit scope enforcement is intrinsic to `executeTrail` (`enforcePermitRequirement` runs before resource creation and layer composition). The compatibility shim was already a no-op.

  The `Layer` type, `composeLayers`, and canonical per-call `executeTrail({ layers })` option remain available; only the legacy layer exports were removed.

### Patch Changes

- 199304e: Harden JWT permit validation by requiring `exp` by default, validating the
  header algorithm allowlist before signature verification, and enforcing finite
  clock skew for `exp` and `nbf` checks.
- e4beec9: Document `@ontrails/permits/jwt` as the canonical JWT adapter import while keeping root JWT re-exports as intentional convenience exports.
- Updated dependencies [73622ae]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [331e3a9]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [eec5e9d]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [10eae9a]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/core@1.0.0-beta.14

## 1.0.0-beta.13

### Minor Changes

- 6944147: Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `configGate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `provisions:`, `metadata:` → `meta:`, `emits:` → `signals:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.signal()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `blaze(app)` → `trailhead(app)`
  - Package rename: `@ontrails/crumbs` → `@ontrails/tracker`
  - Wrapper types: `Layer` → `Gate`, `layers`/`middleware` → `gates`
  - Transport: `surface` → `trailhead`, `adapter` → `connector`

### Patch Changes

- Updated dependencies [6944147]
- Updated dependencies
  - @ontrails/core@1.0.0-beta.13

## 1.0.0-beta.12

### Minor Changes

- Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `config.gate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authProvision` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
