# @ontrails/testing

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [860ef32]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32
  - @ontrails/cli@1.0.0-beta.32
  - @ontrails/http@1.0.0-beta.32
  - @ontrails/mcp@1.0.0-beta.32
  - @ontrails/observe@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [ee9f3ae]
- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/mcp@1.0.0-beta.31
  - @ontrails/core@1.0.0-beta.31
  - @ontrails/cli@1.0.0-beta.31
  - @ontrails/http@1.0.0-beta.31
  - @ontrails/observe@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/cli@1.0.0-beta.30
- @ontrails/core@1.0.0-beta.30
- @ontrails/http@1.0.0-beta.30
- @ontrails/mcp@1.0.0-beta.30
- @ontrails/observe@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/cli@1.0.0-beta.29
- @ontrails/core@1.0.0-beta.29
- @ontrails/http@1.0.0-beta.29
- @ontrails/mcp@1.0.0-beta.29
- @ontrails/observe@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/cli@1.0.0-beta.28
- @ontrails/core@1.0.0-beta.28
- @ontrails/http@1.0.0-beta.28
- @ontrails/mcp@1.0.0-beta.28
- @ontrails/observe@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/cli@1.0.0-beta.27
- @ontrails/core@1.0.0-beta.27
- @ontrails/http@1.0.0-beta.27
- @ontrails/mcp@1.0.0-beta.27
- @ontrails/observe@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26
  - @ontrails/cli@1.0.0-beta.26
  - @ontrails/http@1.0.0-beta.26
  - @ontrails/mcp@1.0.0-beta.26
  - @ontrails/observe@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- Updated dependencies [a9fdbc7]
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [2c08afe]
- Updated dependencies [f1e6efa]
- Updated dependencies [f1e6efa]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
- Updated dependencies [f7d97fc]
- Updated dependencies [df13faf]
  - @ontrails/mcp@1.0.0-beta.25
  - @ontrails/core@1.0.0-beta.25
  - @ontrails/http@1.0.0-beta.25
  - @ontrails/cli@1.0.0-beta.25
  - @ontrails/observe@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/cli@1.0.0-beta.24
- @ontrails/core@1.0.0-beta.24
- @ontrails/http@1.0.0-beta.24
- @ontrails/mcp@1.0.0-beta.24
- @ontrails/observe@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- Updated dependencies [9c5ecdc]
  - @ontrails/http@1.0.0-beta.23
  - @ontrails/cli@1.0.0-beta.23
  - @ontrails/core@1.0.0-beta.23
  - @ontrails/mcp@1.0.0-beta.23
  - @ontrails/observe@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/cli@1.0.0-beta.22
- @ontrails/core@1.0.0-beta.22
- @ontrails/http@1.0.0-beta.22
- @ontrails/mcp@1.0.0-beta.22
- @ontrails/observe@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/cli@1.0.0-beta.21
  - @ontrails/http@1.0.0-beta.21
  - @ontrails/mcp@1.0.0-beta.21
  - @ontrails/observe@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
- Updated dependencies [9bec01c]
- Updated dependencies [accb9ec]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/mcp@1.0.0-beta.20
  - @ontrails/cli@1.0.0-beta.20
  - @ontrails/http@1.0.0-beta.20
  - @ontrails/observe@1.0.0-beta.20

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.

### Minor Changes

- 492f71c: Move CLI, MCP, HTTP, established-surface, and surface-parity helpers behind explicit subpaths so root contract testing imports no longer require optional surface peers. The Trails CLI scaffolder now emits `import { testAllEstablished } from '@ontrails/testing/established'` for generated verification.

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- f8d80b9: Refresh current-facing compose vocabulary in package documentation after the composition cutover.
- 337b467: Construct declared Trails error classes when `testComposes` injects composed trail error examples.
- 16cb740: Run examples and contract checks across live trail version entries, and project version-entry example coverage into topo and survey reports.
- 5d88104: Polish Trails blaze terminology across package docs and Warden guidance.
- f04a9ef: Tighten trail-versioning API polish by keeping executor cross-validation internals out of public options and improving absent marker diagnostics.
- Updated dependencies [e41c382]
- Updated dependencies [a2f1825]
- Updated dependencies [a2f1825]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [94a8380]
- Updated dependencies [94a8380]
- Updated dependencies [846a597]
- Updated dependencies [8638dae]
- Updated dependencies [8638dae]
- Updated dependencies [8638dae]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [92e709b]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
- Updated dependencies [fc00aeb]
- Updated dependencies [ab1c77c]
- Updated dependencies [8ca5b85]
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/cli@1.0.0-beta.19
  - @ontrails/http@1.0.0-beta.19
  - @ontrails/mcp@1.0.0-beta.19
  - @ontrails/observe@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- Updated dependencies [c0b2948]
- Updated dependencies [fc3219c]
- Updated dependencies [bc2d327]
- Updated dependencies [bf44972]
- Updated dependencies [e0ae995]
  - @ontrails/http@1.0.0-beta.18
  - @ontrails/observe@1.0.0-beta.18
  - @ontrails/cli@1.0.0-beta.18
  - @ontrails/core@1.0.0-beta.18
  - @ontrails/mcp@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- ce42573: Add an example-driven CLI/MCP/HTTP surface parity helper.
- e1eb4ee: Add an HTTP surface harness and include HTTP projection validation in `testAllEstablished`.
- Updated dependencies [3dc8254]
- Updated dependencies [61497c5]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/cli@1.0.0-beta.17
  - @ontrails/http@1.0.0-beta.17
  - @ontrails/mcp@1.0.0-beta.17
  - @ontrails/observe@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- bcdc484: Add an explicit `unmockable: { reason }` resource marker and have testing auto-mock resolution skip intentionally unmockable resources.
- bb1cadf: Rename the generated `testAll` suite from `governance` to `contract`.

### Patch Changes

- d40430d: Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/logtape` for LogTape forwarding.
- 193ae78: Migrate testing logger types from the legacy `@ontrails/logging` package to `@ontrails/observe`.
- Updated dependencies [73622ae]
- Updated dependencies [e991a5b]
- Updated dependencies [25f3c5c]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [e898cc4]
- Updated dependencies [a8997ed]
- Updated dependencies [fe03945]
- Updated dependencies [3395234]
- Updated dependencies [d40430d]
- Updated dependencies [bcdc484]
- Updated dependencies [ed171d5]
- Updated dependencies [49c2e7d]
- Updated dependencies [331e3a9]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [fbd42fc]
- Updated dependencies [63d1aef]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [ed888e2]
- Updated dependencies [2e05e27]
- Updated dependencies [9cdb0f2]
- Updated dependencies [c8caa5e]
- Updated dependencies [f4b90c9]
- Updated dependencies [eec5e9d]
- Updated dependencies [4e75129]
- Updated dependencies [47505fe]
- Updated dependencies [ebd4434]
- Updated dependencies [863d473]
- Updated dependencies [344f2f7]
- Updated dependencies [26f9ffd]
- Updated dependencies [66056ac]
- Updated dependencies [0bad534]
- Updated dependencies [10eae9a]
- Updated dependencies [22c6c06]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/cli@1.0.0-beta.16
  - @ontrails/mcp@1.0.0-beta.16
  - @ontrails/observe@1.0.0-beta.16

## 1.0.0-beta.15

### Minor Changes

- f511a3a: Rename `app` field to `graph` in `CliHarnessOptions` and `McpHarnessOptions`

### Patch Changes

- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15
  - @ontrails/cli@1.0.0-beta.15
  - @ontrails/observe@1.0.0-beta.15
  - @ontrails/mcp@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/cli@1.0.0-beta.14
  - @ontrails/core@1.0.0-beta.14
  - @ontrails/logging@1.0.0-beta.14
  - @ontrails/mcp@1.0.0-beta.14

## 1.0.0-beta.13

### Minor Changes

- Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `provisions:`, `metadata:` → `meta:`, `emits:` → `signals:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.signal()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `blaze(app)` → `trailhead(app)`
  - Package rename: `@ontrails/crumbs` → `@ontrails/tracker`
  - Wrapper types: `Layer` → `Gate`, `layers`/`middleware` → `gates`
  - Transport: `surface` → `trailhead`, `adapter` → `connector`

### Patch Changes

- 6944147: Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `configGate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authService` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Updated dependencies [6944147]
- Updated dependencies
  - @ontrails/core@1.0.0-beta.13
  - @ontrails/cli@1.0.0-beta.13
  - @ontrails/mcp@1.0.0-beta.13
  - @ontrails/logging@1.0.0-beta.13

## 1.0.0-beta.12

### Patch Changes

- Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `config.gate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authProvision` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
  - @ontrails/cli@1.0.0-beta.12
  - @ontrails/mcp@1.0.0-beta.12
  - @ontrails/logging@1.0.0-beta.12

## 1.0.0-beta.11

### Minor Changes

- Add provisions as a first-class primitive.

  Provisions make infrastructure dependencies declarative, injectable, and governable. Define a provision with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

  **Core:** `provision()` factory, `ProvisionSpec<T>`, `ProvisionContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isProvision` guard, `findDuplicateProvisionId`, topo provision discovery and validation, `provisions` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `provisions` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Provision mock propagation through crossing graphs.

  **Warden:** `provision-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `provision-exists` rule validates declared provision IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Trailheads:** Provision overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and trailhead map outputs include provision graph. Topo exposes `.provisions`, `.getProvision()`, `.hasProvision()`, `.listProvisions()`, `.provisionIds()`, `.provisionCount`.

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11
  - @ontrails/cli@1.0.0-beta.11
  - @ontrails/mcp@1.0.0-beta.11
  - @ontrails/logging@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10
  - @ontrails/cli@1.0.0-beta.10
  - @ontrails/mcp@1.0.0-beta.10
  - @ontrails/logging@1.0.0-beta.10

## 1.0.0-beta.9

### Minor Changes

- Consolidated improvements across all trailhead packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `run()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Cross-context awareness improvements.

  **warden**: Refactor rules as composable trails with examples.

  **schema**: Error code and empty body fixes.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.9
  - @ontrails/cli@1.0.0-beta.9
  - @ontrails/mcp@1.0.0-beta.9
  - @ontrails/logging@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- @ontrails/cli@1.0.0-beta.8
- @ontrails/core@1.0.0-beta.8
- @ontrails/logging@1.0.0-beta.8
- @ontrails/mcp@1.0.0-beta.8

## 1.0.0-beta.7

### Patch Changes

- @ontrails/cli@1.0.0-beta.7
- @ontrails/core@1.0.0-beta.7
- @ontrails/logging@1.0.0-beta.7
- @ontrails/mcp@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.6
  - @ontrails/cli@1.0.0-beta.6
  - @ontrails/logging@1.0.0-beta.6
  - @ontrails/mcp@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.5
  - @ontrails/logging@1.0.0-beta.5
  - @ontrails/cli@1.0.0-beta.5
  - @ontrails/mcp@1.0.0-beta.5

## 1.0.0-beta.4

### Major Changes

- API simplification: unified trail model, intent enum, run, metadata.

  **BREAKING CHANGES:**

  - `hike()` removed — use `trail()` with optional `crosses: [...]` field
  - `follows` renamed to `crosses` (matching `ctx.cross()`)
  - `topo.hikes` removed — single `topo.trails` map
  - `kind: 'hike'` removed — everything is `kind: 'trail'`
  - `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
  - `implementation` field renamed to `run`
  - `markers` field renamed to `metadata`
  - `testHike` renamed to `testCrosses`, `HikeScenario` to `CrossScenario`
  - `trailhead()` now returns the trailhead handle (`Command` for CLI, `Server` for MCP)

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.4
  - @ontrails/cli@1.0.0-beta.4
  - @ontrails/mcp@1.0.0-beta.4
  - @ontrails/logging@1.0.0-beta.4

## 1.0.0-beta.3

### Minor Changes

- Bug fixes across all trailhead packages found via parallel Codex review.

  **core**: Fix Result.toJson false circular detection on DAGs, deserializeError subclass round-trip, topo cross-kind ID collisions, validateTopo multi-node cycle detection, error example input validation bypass, and deriveFields array type collapse.

  **cli**: Switch trailhead to parseAsync for proper async error handling, add boolean flag negation (--no-flag), and strict number parsing that rejects partial input.

  **mcp**: Align BlobRef with core (including ReadableStream support) and detect tool-name collisions after normalization.

  **testing**: Include hikes in testContracts validation, with cross-context awareness.

  **warden**: Collect hike detour targets, validate detour refs in hike specs, and stop implementation-returns-result from walking into nested function bodies.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.3
  - @ontrails/cli@1.0.0-beta.3
  - @ontrails/mcp@1.0.0-beta.3
  - @ontrails/logging@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- Updated dependencies
  - @ontrails/core@1.0.0-beta.2
  - @ontrails/cli@1.0.0-beta.2
  - @ontrails/mcp@1.0.0-beta.2
  - @ontrails/logging@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)
- Updated dependencies
  - @ontrails/core@1.0.0-beta.1
  - @ontrails/cli@1.0.0-beta.1
  - @ontrails/mcp@1.0.0-beta.1
  - @ontrails/logging@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

- Initial v1 beta release of the Trails framework.

  - **@ontrails/core** — Result type, error taxonomy, trail/hike/event/topo, validateTopo, validateInput/Output, deriveFields, patterns, redaction, branded types, resilience
  - **@ontrails/cli** — CLI trailhead connector, Commander integration, flag derivation, gates
  - **@ontrails/mcp** — MCP trailhead connector, tool generation, annotations, progress bridge
  - **@ontrails/logging** — Structured logging, sinks, formatters, LogTape connector
  - **@ontrails/testing** — testAll, testExamples, testTrail, testHike, testContracts, testDetours, trailhead harnesses
  - **@ontrails/warden** — AST-based code convention rules via oxc-parser, drift detection, CI formatters
  - **@ontrails/schema** — Trailhead map generation, hashing, semantic diffing

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.0
  - @ontrails/cli@1.0.0-beta.0
  - @ontrails/mcp@1.0.0-beta.0
  - @ontrails/logging@1.0.0-beta.0
