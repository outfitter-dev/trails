# @ontrails/cli

## 1.0.0-beta.25

### Patch Changes

- f1e6efa: Derive enum array inputs as repeatable flags so choice lists do not consume trailing command tokens.
- 9bcf34e: Add trail-owned CLI command projection metadata and serialize resolved command
  route facts for downstream tools.
- f7d97fc: Expose resolved CLI command routes through schema helpers, the Trails operator
  schema command, and Wayfinder trail contract output.
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
  - @ontrails/core@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/core@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- @ontrails/core@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/core@1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21

## 1.0.0-beta.20

### Patch Changes

- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- a2f1825: Add `@example` coverage in CLI public API docs for flag and preset helpers so API docs tooling can verify public examples for missing exports.
- a2f1825: Add public API examples for CLI result, prompt, and validation helpers.
- 92e709b: Declare explicit permit scopes on mutating built-in CLI trails and scaffolded entity starter trails.

  Preserve the resolved CLI permit on result callbacks so run-collision recovery can re-execute protected trails without losing authorization context.

- 84f56a5: Project live trail-version metadata on CLI, HTTP, and MCP surfaces and thread explicit surface version selection into shared trail execution.
- 5d88104: Polish Trails blaze terminology across package docs and Warden guidance.
- Updated dependencies [e41c382]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [431b04c]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
  - @ontrails/core@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- @ontrails/core@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 61497c5: Add v1-minimum public API examples for shipped surface entrypoints.
- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- e991a5b: Add generic enum value aliases for CLI flags and migrate Warden command aliases onto the shared alias model.
- 25f3c5c: Add the dedicated `@ontrails/commander` adapter package and move the Commander runtime out of the `@ontrails/cli/commander` subpath. Extend the repo-local package-source guardrails to cover adapter package source as the Commander runtime moves under `adapters/`.
- ed171d5: Split `trails survey` detail inspection into role-anchored `survey.trail`, `survey.resource`, and `survey.signal` trails while keeping bare `survey <id>` as an all-kinds lookup. Remove the temporary `survey --openapi` and `topo.show` CLI shapes. CLI command projection now supports executable parent commands with positional arguments alongside child commands.
- fbd42fc: Unify structured CLI input around `--input <path|->` and `--input-json`.
  `--input` reads JSON from a file path or from stdin when the value is `-`;
  `--input-file`, `--stdin`, and the `structuredInputFieldByTrail` routing
  option are removed. Structured payloads now merge directly into each trail's
  typed input object, so `trails run` callers provide the inner trail payload
  under the run trail's `input` field.
- 63d1aef: Add `--quiet` / `-q` flag to strip the `inner-trail-result` envelope from `trails run` stdout. On success, stdout becomes the inner value JSON only (no `{ kind, trailId, value }` wrapper). Composes with `--json` / `--jsonl` (those control format; `--quiet` controls envelope vs unwrapped). Wired as a global CLI flag via `outputModePreset()` so all commands surface it; the run-trail-specific unwrap logic lives in `apps/trails/src/cli.ts` next to the existing collision-recovery wrapper.
- 112b9f2: Add `dryRun` to `TrailContext` and wire `--dry-run`. `TrailContext` gains an optional `dryRun?: boolean` field, defaulted to `false` in `createTrailContext`. `ExecuteTrailOptions` carries `dryRun?: boolean` through `applyContextOverrides` so `executeTrail(t, input, { dryRun: true })` produces `ctx.dryRun === true`. The CLI's existing `dryRunPreset` (auto-derived for `intent: 'write' | 'destroy'` trails) now flows through `META_FLAG_CANDIDATES` and reaches the executor via `runTrailOnce`, so `trails run booking.cancel … --dry-run` lands `ctx.dryRun === true` on the trail's blaze. Trails that don't read the field are unchanged. Read-intent trails don't get `--dry-run` exposed.
- 893025e: Add `--permit '<json>'` to inject an inline permit on `trails run`. New `permitPreset()` exposes a `--permit` string flag that the CLI build parses and validates against the `BasePermit` shape (`{ id: string, scopes: string[] }`) using a small Zod schema. Valid permits flow through `ExecuteTrailOptions.permit` → `applyContextOverrides` → `ctx.permit` so existing `enforcePermitRequirement` behavior just sees a populated permit. Invalid JSON or schema mismatch surface as `Result.err(ValidationError)` (exit code 1) before the trail runs, avoiding spurious `PermitError` results from malformed input. The flag is global, never routed into trail input (added to `META_FLAG_CANDIDATES`), and overlays only when defined.

  Topographer now projects permit requirements into surface-map entries and classifies permit-tightening diffs as breaking when new scopes are required.

- ed888e2: Add `--token <token>` to `trails run` for permit resolution via the topo's auth adapter. New `tokenPreset()` exposes the flag; `'token'` is added to `META_FLAG_CANDIDATES`. The CLI resolves the `auth` resource through the shared permit-boundary helper, calls `adapter.authenticate({ surface: 'cli', bearerToken, requestId })`, and projects the resolved `Permit` into `ExecuteTrailOptions.permit` (added in TRL-408) so it reaches `ctx.permit`. Failures: missing adapter → `ValidationError` (exit 1); adapter returns `Err(AuthError)` or `Ok(null)` → `AuthError` (category `'auth'`, exit 9, with the adapter's code preserved on `error.context.code`). `--token` and `--permit` are mutually exclusive — supplying both yields `ValidationError`.
- 2e05e27: Add `--dev-permit` for local-development synthetic full-access. New `devPermitPreset()` exposes a boolean flag; when set, the CLI synthesizes a `BasePermit` (`id: 'dev-permit'`, scopes enumerated from every declared scope across the topo) and overlays it on `ctx.permit`. Mutually exclusive with `--permit` and `--token` — any combination fails with `ValidationError` listing the conflicting flags. New Warden rule `no-dev-permit-in-source` flags any committed source file containing `--dev-permit` as an error, with a tight allow-list (`packages/cli/src/flags.ts`, `packages/cli/src/build.ts`, the rule itself). The Warden runner still scans test TypeScript files for this literal while keeping unrelated source rules filtered out of tests. Apps that import `authResource`/`authLayer` are unaffected.
- c8caa5e: Wire the `--trace` flag for the `trails run` family. Adds `tracePreset()` to `@ontrails/cli` (registered via the `presets` option) and threads `'trace'` through `META_FLAG_CANDIDATES` so the flag is treated as CLI metadata (never routed into trail input). On activation, `apps/trails/src/cli.ts` installs a per-invocation memory sink before `surface()` runs and finalizes it in a `finally` block: the post-execution tree (rendered via `renderTraceTree` from TRL-411) goes to stderr; the result still goes to stdout. With `--trace --json`, regular `trails run <id>` emits a single JSON envelope on stdout that includes `tracing: TraceRecord[]`; `trails run example <id> <exampleName>` keeps its comparison envelope, and `trails run examples <id>` remains a metadata read. `--quiet` keeps the tree on stderr and the unwrapped value on stdout, while `--jsonl` streams items as before. Sink registration is per-invocation so concurrent runs don't bleed records.
- f4b90c9: Add `--watch` for the `trails run` family. File-system events are cheap wake-ups; the rerun gate compares the resolved trail's surface-map entry hash so edits only rerun when the public contract for the watched trail changes. New `watchPreset()` exposes the boolean flag; `'watch'` is added to `META_FLAG_CANDIDATES` so the flag never routes into trail input. The watch loop in `apps/trails/src/run-watch.ts` runs once, then sets up a debounced (`100ms`) `node:fs.watch` filtered to `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` extensions in the trail's source directory. SIGINT closes the watcher cleanly. A short startup warmup window (`150ms`) suppresses the macOS FSEvents replay event that would otherwise produce a phantom rerun on first invocation.
- 4e75129: Absorb `autoIterateLayer` behavior into CLI surface derivation. Trails whose output schema matches the paginated shape (`{ items, hasMore, nextCursor }`) now auto-emit a `--all` flag on the CLI command. When `--all` is set, the executor iterates pages with the trail's cursor field until `hasMore: false` and aggregates `items[]` across pages. With `--jsonl --all`, items stream one per line as they arrive (no in-memory aggregation). If a page reports `hasMore: true` without a non-empty `nextCursor`, `--all` now fails with `ValidationError` instead of silently truncating results. Detection lives in `packages/cli/src/pagination.ts`. The legacy `autoIterateLayer` export is **kept** through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
- 47505fe: Absorb `dateShortcutsLayer` behavior into CLI surface derivation. Trails with date input fields (`z.iso.datetime()`, `z.iso.date()`, `z.string().datetime()`, `z.date()`, plus optional/default wrappers) now auto-accept shortcuts on the CLI: `today`, `yesterday`, `Nd` (N days ago), `this-week` (start-of-week Monday UTC), `this-month` (first-of-this-month UTC). Shortcuts expand to UTC ISO before Zod validation. Plain ISO strings pass through unchanged. Digit-led typos like `7day`/`3w` surface a `ValidationError`. Detection lives in `packages/cli/src/date-shortcuts.ts`. The legacy `dateShortcutsLayer` export is kept through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
- 863d473: Add three attachment scopes for typed layers — trail, surface, topo — with composition order **topo → surface → trail → blaze**. `TrailSpec` and `Trail` gain `layers?: readonly Layer[]` (default `[]`). `topo()` accepts `{ layers: [...] }` as the third options argument; the topo carries those layers and they reach the executor via `ExecuteTrailOptions.topoLayers`. The CLI's `surface()`/`createProgram()`/`deriveCliCommands` already supports a `layers` option; that now flows through `runTrailOnce` as `surfaceLayers`. The executor builds the layer chain `[...topoLayers, ...surfaceLayers, ...trail.layers, ...options.layers]` so topo wraps surface wraps trail wraps blaze (verified by composition-order tests at every level). Survey's `TrailDetailReport` adds `composedLayers: { topo, surface, trail }` so agents can introspect the layer chain per trail. Backward-compatible: every new field is optional with a non-undefined default; existing call sites are unchanged.
- 344f2f7: Project typed-layer `input` schemas onto CLI flags. Each effective layer (topo + surface + trail composition order) with a non-undefined `input` schema gets its fields auto-derived into `--flag` options on every command it attaches to. Parsed values route to the layer at runtime via `ctx.extensions[LAYER_INPUTS_KEY][layer.name]` — `Layer.wrap` is unchanged. Collision rule: if a layer field name collides with a trail input field, another layer's projected name, or a CLI meta flag, the layer's flag is renamed to `--<layer-name>-<original-flag-name>` and a one-line warning emits to stderr (`[trails] ...`). Renames are deterministic across builds. New `LAYER_INPUTS_KEY` (exported from `@ontrails/core`) reserves the `ctx.extensions` slot.
- 26f9ffd: Project typed-layer `input` schemas onto MCP and HTTP surfaces. Closes Phase 7. Lifts `collectAttachedTypedLayers` and `projectLayerFieldName` (collision-rename rule) into `@ontrails/core/internal/layer-projection` so all three surfaces share one source of truth. The CLI surface refactors to consume the lifted helpers (no behavior change). MCP merges layer fields into each tool's `inputSchema` and partitions inbound args at invocation time. HTTP merges layer fields into the route's request schema (query for reads, body for writes) and exposes new optional `HttpRouteDefinition.inputSchema` + `layerInputProjections` for surface adapters / OpenAPI generators. Collision rule matches TRL-473's: deterministic rename to a layer-prefixed camelCase name with the original captured in the routing table. Side fix: MCP and HTTP handlers now forward `topoLayers: graph.layers` + `surfaceLayers: layers` so topo-scope layers actually compose at runtime (previously the handlers used the deprecated `layers` alias and never read `graph.layers`).
- 66056ac: **BREAKING:** TRL-475 drops user-facing exports of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`. Breaking change for any app still wiring these layers manually.

  Migration:

  - **`autoIterateLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now derives the `--all` flag and multi-page collection automatically from any trail whose output matches the pagination pattern (`items`, `hasMore`, `nextCursor`). See TRL-469.
  - **`dateShortcutsLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now expands `since`/`until` shortcut strings (`today`, `yesterday`, `7d`, `30d`, `this-week`, `this-month`) automatically from input schema shape. See TRL-470.
  - **`authLayer`** — remove from `blaze`/`run`/`surface` options. Permit scope enforcement is intrinsic to `executeTrail` (`enforcePermitRequirement` runs before resource creation and layer composition). The compatibility shim was already a no-op.

  The `Layer` type, `composeLayers`, and canonical per-call `executeTrail({ layers })` option remain available; only the legacy layer exports were removed.

### Patch Changes

- 73622ae: Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT adapter from typed config while preserving existing mock and override paths.
- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- 49c2e7d: Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- 0bad534: Reject ambiguous CLI value-alias conflicts when non-Commander callers provide a
  defaulted canonical flag value without caller-supplied key tracking.
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

### Minor Changes

- 4ad6b25: Lexicon rename cleanup (ADR-0023). Breaking for `@ontrails/core`, `@ontrails/cli`, and `@ontrails/tracing` at the boundary; internal-only churn for `@ontrails/warden`.

  - **core**: the topo store schema renames `topo_provisions` / `topo_trail_provisions` → `topo_resources` / `topo_trail_resources` and `provision_count` → `resource_count`. Schema version bumped v4→v5. Stores still carrying the legacy schema are detected on open, dropped, and recreated from the new DDL — previous topo saves are cleared. Stored-data helpers `listTopoStoreProvisions` / `getTopoStoreProvision` / `readProvisionUsage` / `mapProvisionRow` renamed to their `resource` counterparts. TS row types `TopoTrailProvisionRow` / `TopoProvisionRow` renamed to `TopoTrailResourceRow` / `TopoResourceRow`.
  - **cli**: CLI output mode env vars are now derived from the topo name per ADR-0023. Legacy globals `TRAILS_JSON` / `TRAILS_JSONL` are no longer honored — a topo named `stash` reads `STASH_JSON` / `STASH_JSONL`. `ActionResultContext` gains a `topoName: string` field; `resolveOutputMode(flags, topoName)` takes a topo name argument.
  - **tracing**: legacy `.trails/dev/tracker.db` migration path removed. Any user still running a pre-rename beta build with a `tracker.db` should delete it or migrate before upgrading.
  - **warden**: internal-only rename of `provisionDeclarations` / `provisionExists` rules and their trails to `resourceDeclarations` / `resourceExists`. No behavior change.

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

## 1.0.0-beta.11

### Patch Changes

- Add provisions as a first-class primitive.

  Provisions make infrastructure dependencies declarative, injectable, and governable. Define a provision with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

  **Core:** `provision()` factory, `ProvisionSpec<T>`, `ProvisionContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isProvision` guard, `findDuplicateProvisionId`, topo provision discovery and validation, `provisions` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `provisions` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Provision mock propagation through crossing graphs.

  **Warden:** `provision-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `provision-exists` rule validates declared provision IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Trailheads:** Provision overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and trailhead map outputs include provision graph. Topo exposes `.provisions`, `.getProvision()`, `.hasProvision()`, `.listProvisions()`, `.provisionIds()`, `.provisionCount`.

  **Docs:** ADR-009 accepted. Unified provisions guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Trailhead` type, `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept from published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10

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

## 1.0.0-beta.8

### Patch Changes

- @ontrails/core@1.0.0-beta.8

## 1.0.0-beta.7

### Patch Changes

- @ontrails/core@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.5

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

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- Updated dependencies
  - @ontrails/core@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)
- Updated dependencies
  - @ontrails/core@1.0.0-beta.1

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
