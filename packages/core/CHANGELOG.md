# @ontrails/core

## 1.0.0-beta.24

## 1.0.0-beta.23

## 1.0.0-beta.22

## 1.0.0-beta.21

### Patch Changes

- 99523f2: Clean up resource context naming in shipped source and examples so resource
  factories consistently use resource vocabulary.

## 1.0.0-beta.20

### Patch Changes

- 851a2a3: Derive trail caller and blaze input types from the authored input schema while keeping one public input contract.

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- f8d80b9: Refresh current-facing compose vocabulary in package documentation after the composition cutover.
- 846a597: Reject versioned trail marker schemas that use Zod validation checks or object
  catchall policies outside the bounded marker subset.
- 223aaad: Fix `ctx.compose(trail, input)` inference for trails that do not define a
  `composeInput` schema while preserving authored compose-input requirements.
- 3125f4d: Add pure revision transpose validation and execution helpers for trail versions.
- 2494dc6: Infer `resource()` create-context config types from resource config schemas.
- 2d53717: Add trail-only `version` / `versions` authoring types and TopoGraph projection.
- 16cb740: Run examples and contract checks across live trail version entries, and project version-entry example coverage into topo and survey reports.
- 8894ecb: Project content-addressed trail version markers and marker-prefix resolution.
- fdf7ec9: Resolve trail versions during execution, including live revisions, forks, marker references, and unsupported-version errors.
- d76be13: Require deprecated trail version entries to carry successor, migration, or note guidance and expose typed lifecycle helpers.
- 84f56a5: Project live trail-version metadata on CLI, HTTP, and MCP surfaces and thread explicit surface version selection into shared trail execution.
- 431b04c: Expose archived trail version lifecycle helpers and validate archived status reason metadata.
- 5d88104: Polish Trails blaze terminology across package docs and Warden guidance.
- f04a9ef: Tighten trail-versioning API polish by keeping executor cross-validation internals out of public options and improving absent marker diagnostics.

## 1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 3dc8254: Fix README TypeScript snippets so the expanded documentation snippet gate can verify them.

## 1.0.0-beta.16

### Major Changes

- 331e3a9: Relocate the topo-store public API from `@ontrails/core` to `@ontrails/topographer` per ADR-0042. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

  Breaking pre-1.0 beta change. Update consumer imports:

  ```diff
  - import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
  + import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
  + import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
  ```

  The same root move applies to types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions`. The direct DB helper type `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

  Core newly exports `activationSourceKey`, `projectActivationSourceDeclaration`, `activationSourceDeclarationSignature`, and the `ActivationSourceProjection` type — these were already used internally and are now part of the public surface so `@ontrails/topographer` (the only consumer that needs them) can import them through normal package channels.

- 10eae9a: Migrate the Trails workspace to the documented `.trails/` layout: committed `.lock` files at the workspace root, ignored `cache/` for rebuildable derived data, ignored `state/` for mutable runtime state, and `.trails/config.local.{ts,js}` for local overrides. The default SQLite path is now `.trails/state/trails.db`. Workspace bootstrap creates only `cache/` and `state/` — the legacy `dev/` and `generated/` subdirectories are no longer created. Dev reset cleans both the new `.trails/state/` paths and legacy `.trails/trails.db*` and `.trails/dev/tracing.db*` paths for one cycle. Scaffold and workspace gitignores reflect the new layout.

  Workspace bootstrap is now owned by a single canonical source in `@ontrails/core`. The package exposes `ensureTrailsWorkspace()`, `WORKSPACE_GITIGNORE_CONTENT`, and `WORKSPACE_GITIGNORE_LINES`. `@ontrails/config` no longer exports its own `ensureWorkspace` (consumers should import from `@ontrails/core`). `trails create` now writes `.trails/.gitignore` during scaffolding so a fresh-scaffolded project's initial commit includes the workspace gitignore (resolves TRL-703).

### Minor Changes

- bcdc484: Add an explicit `unmockable: { reason }` resource marker and have testing auto-mock resolution skip intentionally unmockable resources.
- 4b8d13b: **BREAKING:** Complete the `trailhead` to `surface` public API cutover in core.

  - `TraceRecord.trailhead` is now `TraceRecord.surface`.
  - `SURFACE_KEY` now uses the `__trails_surface` extension key value, and the deprecated `TRAILHEAD_KEY` alias is removed.
  - Deprecated `transport*` surface-error aliases are removed; import the existing `surface*` names instead.
  - `isVisibleToTrailheads` is renamed to `isVisibleToSurfaces`.

  See `docs/migration/trailhead-to-surface.md` for the full migration map.

- 112b9f2: Add `dryRun` to `TrailContext` and wire `--dry-run`. `TrailContext` gains an optional `dryRun?: boolean` field, defaulted to `false` in `createTrailContext`. `ExecuteTrailOptions` carries `dryRun?: boolean` through `applyContextOverrides` so `executeTrail(t, input, { dryRun: true })` produces `ctx.dryRun === true`. The CLI's existing `dryRunPreset` (auto-derived for `intent: 'write' | 'destroy'` trails) now flows through `META_FLAG_CANDIDATES` and reaches the executor via `runTrailOnce`, so `trails run booking.cancel … --dry-run` lands `ctx.dryRun === true` on the trail's blaze. Trails that don't read the field are unchanged. Read-intent trails don't get `--dry-run` exposed.
- 893025e: Add `--permit '<json>'` to inject an inline permit on `trails run`. New `permitPreset()` exposes a `--permit` string flag that the CLI build parses and validates against the `BasePermit` shape (`{ id: string, scopes: string[] }`) using a small Zod schema. Valid permits flow through `ExecuteTrailOptions.permit` → `applyContextOverrides` → `ctx.permit` so existing `enforcePermitRequirement` behavior just sees a populated permit. Invalid JSON or schema mismatch surface as `Result.err(ValidationError)` (exit code 1) before the trail runs, avoiding spurious `PermitError` results from malformed input. The flag is global, never routed into trail input (added to `META_FLAG_CANDIDATES`), and overlays only when defined.

  Topographer now projects permit requirements into surface-map entries and classifies permit-tightening diffs as breaking when new scopes are required.

- eec5e9d: Default `ctx.logger` to a structured stdout console sink when `topo()` is called without an `observe:` option. Apps now get observability for free with zero configuration, per ADR-0041. Explicit `observe:` values (including `combine()` with no sinks, an explicit `Logger`, or an explicit `{ log }` config) are preserved untouched — the default is only injected when no `observe:` is supplied.
- ebd4434: Phase 7 starts: typed layers with optional object-shaped surface input. `Layer` gains an optional `input?: LayerInputSchema` field for surface projection (TRL-473/474 will project it onto CLI/MCP/HTTP). `executeTrail({ layers })` remains the canonical per-call wrapper option. Layers without `input` schemas stay surface-invisible and cover runtime-only concerns such as tenant guards, rate limiting, circuit breaking, and custom audit logging.
- 863d473: Add three attachment scopes for typed layers — trail, surface, topo — with composition order **topo → surface → trail → blaze**. `TrailSpec` and `Trail` gain `layers?: readonly Layer[]` (default `[]`). `topo()` accepts `{ layers: [...] }` as the third options argument; the topo carries those layers and they reach the executor via `ExecuteTrailOptions.topoLayers`. The CLI's `surface()`/`createProgram()`/`deriveCliCommands` already supports a `layers` option; that now flows through `runTrailOnce` as `surfaceLayers`. The executor builds the layer chain `[...topoLayers, ...surfaceLayers, ...trail.layers, ...options.layers]` so topo wraps surface wraps trail wraps blaze (verified by composition-order tests at every level). Survey's `TrailDetailReport` adds `composedLayers: { topo, surface, trail }` so agents can introspect the layer chain per trail. Backward-compatible: every new field is optional with a non-undefined default; existing call sites are unchanged.
- 344f2f7: Project typed-layer `input` schemas onto CLI flags. Each effective layer (topo + surface + trail composition order) with a non-undefined `input` schema gets its fields auto-derived into `--flag` options on every command it attaches to. Parsed values route to the layer at runtime via `ctx.extensions[LAYER_INPUTS_KEY][layer.name]` — `Layer.wrap` is unchanged. Collision rule: if a layer field name collides with a trail input field, another layer's projected name, or a CLI meta flag, the layer's flag is renamed to `--<layer-name>-<original-flag-name>` and a one-line warning emits to stderr (`[trails] ...`). Renames are deterministic across builds. New `LAYER_INPUTS_KEY` (exported from `@ontrails/core`) reserves the `ctx.extensions` slot.
- 26f9ffd: Project typed-layer `input` schemas onto MCP and HTTP surfaces. Closes Phase 7. Lifts `collectAttachedTypedLayers` and `projectLayerFieldName` (collision-rename rule) into `@ontrails/core/internal/layer-projection` so all three surfaces share one source of truth. The CLI surface refactors to consume the lifted helpers (no behavior change). MCP merges layer fields into each tool's `inputSchema` and partitions inbound args at invocation time. HTTP merges layer fields into the route's request schema (query for reads, body for writes) and exposes new optional `HttpRouteDefinition.inputSchema` + `layerInputProjections` for surface adapters / OpenAPI generators. Collision rule matches TRL-473's: deterministic rename to a layer-prefixed camelCase name with the original captured in the routing table. Side fix: MCP and HTTP handlers now forward `topoLayers: graph.layers` + `surfaceLayers: layers` so topo-scope layers actually compose at runtime (previously the handlers used the deprecated `layers` alias and never read `graph.layers`).
- 22c6c06: Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.

### Patch Changes

- 73622ae: Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT adapter from typed config while preserving existing mock and override paths.
- 6300f70: Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- d172013: Preserve specialized TrailsError identity and retry-exhaustion metadata when
  serializing and deserializing framework errors.
- c3fc5c3: Move previously root-exported helper contracts out of `src/internal/*` to stable core module homes, document their public boundary, and guard the public barrel against future internal re-exports.
- 20d7a5c: Enforce the shared safe error projection policy for public error bodies, diagnostics, serialized payloads, and CLI stderr.
- be5fb46: Publish registry-driven error taxonomy documentation and checks from the core error registry.
- e898cc4: Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
- 3395234: Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- 4399fdb: Renamed `@ontrails/schema` to `@ontrails/topographer`. Mechanical rename only — no API changes. Update import sites from `@ontrails/schema` to `@ontrails/topographer`. See ADR-0042 for the durable graph substrate doctrine.

## 1.0.0-beta.15

### Minor Changes

- 4ad6b25: Lexicon rename cleanup (ADR-0023). Breaking for `@ontrails/core`, `@ontrails/cli`, and `@ontrails/tracing` at the boundary; internal-only churn for `@ontrails/warden`.

  - **core**: the topo store schema renames `topo_provisions` / `topo_trail_provisions` → `topo_resources` / `topo_trail_resources` and `provision_count` → `resource_count`. Schema version bumped v4→v5. Stores still carrying the legacy schema are detected on open, dropped, and recreated from the new DDL — previous topo saves are cleared. Stored-data helpers `listTopoStoreProvisions` / `getTopoStoreProvision` / `readProvisionUsage` / `mapProvisionRow` renamed to their `resource` counterparts. TS row types `TopoTrailProvisionRow` / `TopoProvisionRow` renamed to `TopoTrailResourceRow` / `TopoResourceRow`.
  - **cli**: CLI output mode env vars are now derived from the topo name per ADR-0023. Legacy globals `TRAILS_JSON` / `TRAILS_JSONL` are no longer honored — a topo named `stash` reads `STASH_JSON` / `STASH_JSONL`. `ActionResultContext` gains a `topoName: string` field; `resolveOutputMode(flags, topoName)` takes a topo name argument.
  - **tracing**: legacy `.trails/dev/tracker.db` migration path removed. Any user still running a pre-rename beta build with a `tracker.db` should delete it or migrate before upgrading.
  - **warden**: internal-only rename of `provisionDeclarations` / `provisionExists` rules and their trails to `resourceDeclarations` / `resourceExists`. No behavior change.

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

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

## 1.0.0-beta.12

### Patch Changes

- Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configProvision`, `config.gate`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authProvision` and `auth.verify` trail for runtime authorization checks
  - **tracker**: Rename tracks to tracker; add `trackerProvision` and `tracker.status` trail for structured event tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for provision and composition updates

## 1.0.0-beta.11

### Minor Changes

- Add provisions as a first-class primitive.

  Provisions make infrastructure dependencies declarative, injectable, and governable. Define a provision with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

  **Core:** `provision()` factory, `ProvisionSpec<T>`, `ProvisionContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isProvision` guard, `findDuplicateProvisionId`, topo provision discovery and validation, `provisions` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `services` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Service mock propagation through crossing graphs.

  **Warden:** `provision-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `provision-exists` rule validates declared provision IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Trailheads:** Provision overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and trailhead map outputs include provision graph. Topo exposes `.provisions`, `.getProvision()`, `.hasProvision()`, `.listProvisions()`, `.provisionIds()`, `.provisionCount`.

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

## 1.0.0-beta.10

### Minor Changes

- Cleanup and hardening pass across all packages.

  **core**: Deduplicate `RunOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Trailhead` type, `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept from published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

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

## 1.0.0-beta.8

## 1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Fix Codex review findings on type-utils and cross-declarations.

  **core**: `inputOf()`/`outputOf()` now preserve the exact Zod schema subtype instead of widening to `z.ZodType`.

  **warden**: `cross-declarations` rule now recognizes single-object trail overload, detects any context parameter name (not just `ctx`), matches destructured `cross()` calls, resolves const identifiers in `crosses` arrays, and restricts blaze body extraction to top-level config properties.

## 1.0.0-beta.5

### Minor Changes

- Type utilities and cross-declarations warden rule.

  **core**: Add `TrailInput<T>`, `TrailOutput<T>` utility types and `inputOf()`, `outputOf()` runtime schema accessors.

  **warden**: Add `cross-declarations` rule — statically analyzes `ctx.cross()` calls against declared `crosses: [...]` arrays. Errors on undeclared calls, warns on unused declarations.

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

## 1.0.0-beta.3

### Minor Changes

- Bug fixes across all trailhead packages found via parallel Codex review.

  **core**: Fix Result.toJson false circular detection on DAGs, deserializeError subclass round-trip, topo cross-kind ID collisions, validateTopo multi-node cycle detection, error example input validation bypass, and deriveFields array type collapse.

  **cli**: Switch trailhead to parseAsync for proper async error handling, add boolean flag negation (--no-flag), and strict number parsing that rejects partial input.

  **mcp**: Align BlobRef with core (including ReadableStream support) and detect tool-name collisions after normalization.

  **testing**: Include hikes in testContracts validation, with cross-context awareness.

  **warden**: Collect hike detour targets, validate detour refs in hike specs, and stop implementation-returns-result from walking into nested function bodies.

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)

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
