# @ontrails/testing

## 1.0.0-beta.10

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10
  - @ontrails/cli@1.0.0-beta.10
  - @ontrails/mcp@1.0.0-beta.10
  - @ontrails/logging@1.0.0-beta.10

## 1.0.0-beta.9

### Minor Changes

- Consolidated improvements across all surface packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `dispatch()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Follow context awareness improvements.

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

  - `hike()` removed — use `trail()` with optional `follow: [...]` field
  - `follows` renamed to `follow` (singular, matching `ctx.follow()`)
  - `topo.hikes` removed — single `topo.trails` map
  - `kind: 'hike'` removed — everything is `kind: 'trail'`
  - `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
  - `implementation` field renamed to `run`
  - `markers` field renamed to `metadata`
  - `testHike` renamed to `testFollows`, `HikeScenario` to `FollowScenario`
  - `blaze()` now returns the surface handle (`Command` for CLI, `Server` for MCP)

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.4
  - @ontrails/cli@1.0.0-beta.4
  - @ontrails/mcp@1.0.0-beta.4
  - @ontrails/logging@1.0.0-beta.4

## 1.0.0-beta.3

### Minor Changes

- Bug fixes across all surface packages found via parallel Codex review.

  **core**: Fix Result.toJson false circular detection on DAGs, deserializeError subclass round-trip, topo cross-kind ID collisions, validateTopo multi-node cycle detection, error example input validation bypass, and deriveFields array type collapse.

  **cli**: Switch blaze to parseAsync for proper async error handling, add boolean flag negation (--no-flag), and strict number parsing that rejects partial input.

  **mcp**: Align BlobRef with core (including ReadableStream support) and detect tool-name collisions after normalization.

  **testing**: Include hikes in testContracts validation, with follow-context awareness.

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
  - **@ontrails/cli** — CLI surface adapter, Commander integration, flag derivation, layers
  - **@ontrails/mcp** — MCP surface adapter, tool generation, annotations, progress bridge
  - **@ontrails/logging** — Structured logging, sinks, formatters, LogTape adapter
  - **@ontrails/testing** — testAll, testExamples, testTrail, testHike, testContracts, testDetours, surface harnesses
  - **@ontrails/warden** — AST-based code convention rules via oxc-parser, drift detection, CI formatters
  - **@ontrails/schema** — Surface map generation, hashing, semantic diffing

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.0
  - @ontrails/cli@1.0.0-beta.0
  - @ontrails/mcp@1.0.0-beta.0
  - @ontrails/logging@1.0.0-beta.0
