# @ontrails/topography

## 1.0.0

### Major Changes

- [`93607de`](https://github.com/outfitter-dev/trails/commit/93607deae7f5a6badb4fed40f9f6b7fef43c8b64): API simplification: unified trail model, intent enum, blaze, metadata.

  **BREAKING CHANGES:**

  - `hike()` removed — use `trail()` with optional `crosses: [...]` field
  - `follows` renamed to `crosses` (matching `ctx.cross()`)
  - `topo.hikes` removed — single `topo.trails` map
  - `kind: 'hike'` removed — everything is `kind: 'trail'`
  - `readOnly`/`destructive` booleans replaced by `intent: 'read' | 'write' | 'destroy'`
  - `implementation` field renamed to `blaze`
  - `markers` field renamed to `metadata`
  - `testHike` renamed to `testCrosses`, `HikeScenario` to `CrossScenario`
  - `surface()` now returns the surface handle (`Command` for CLI, `Server` for MCP)

- [`1eb5bdc`](https://github.com/outfitter-dev/trails/commit/1eb5bdc06142d8886f3870801b2ef71a0c5f3844): Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
- [`2bf239e`](https://github.com/outfitter-dev/trails/commit/2bf239e0ed42f82c3b3789b89db98fb6fe0c017a): Move OpenAPI generation ownership to the HTTP surface.

  **http**: Export `deriveOpenApiSpec()` and its OpenAPI types from `@ontrails/http`.

  **schema**: Remove the OpenAPI helper export so schema stays focused on surface maps, locks, and semantic diffing.

- [`3395234`](https://github.com/outfitter-dev/trails/commit/33952349f2d475b170376a63587c89e50be3247a): Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- [`7a1d4a9`](https://github.com/outfitter-dev/trails/commit/7a1d4a904d05b1ccd46af01fdab389cb2ab10a3d): Rename the public resolved graph API from `SurfaceMap` to `TopoGraph`, including
  the derive, hash, diff, and current graph artifact I/O helpers.
- [`84f595a`](https://github.com/outfitter-dev/trails/commit/84f595afe4bc0c8c3d07f99d5d7682676fa119d1): Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
- [`d2cb9ba`](https://github.com/outfitter-dev/trails/commit/d2cb9ba3672cb224b5df7ecf363bbe5e5d77bff4): Rename topo-store export artifacts from surface-era names to TopoGraph names. The `topo_exports` table now stores `topo_graph`, `topo_graph_hash`, and `lock_manifest`, and backend-support export records expose `topoGraphJson`, `topoGraphHash`, and `lockManifestJson`.
- [`bbb1ea4`](https://github.com/outfitter-dev/trails/commit/bbb1ea4ff47a050094e1100e510e6e6196a21c57): Move the workspace trail index out of the lock manifest and into the serialized TopoGraph artifact. Workspace index reads now consult `topo.lock` workspace metadata, and `buildWorkspaceTrailIndex()` exposes `topo-lock` cache hits through the artifact-family path.

### Minor Changes

- [`69057e9`](https://github.com/outfitter-dev/trails/commit/69057e9348006b2b70c9f6237572a5aa8de3ee1f): Add hierarchical CLI command trees and structured input, enforce established-only topo exports across surfaces, move developer topo and tracing state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.
- [`ebbf0c5`](https://github.com/outfitter-dev/trails/commit/ebbf0c538550429f92944ac2d196b6bc9ca00c4b): Consolidated improvements across all surface packages.

  **core**: Add `TrailResult<T>` utility type, `topo.ids()` and `topo.count` accessors, `dispatch()` for headless trail execution, and extract shared `executeTrail` pipeline used by CLI/MCP/HTTP.

  **http**: Detect route path collisions and return `Result` from `buildHttpRoutes()`, wire request `AbortSignal` through to trail context, and make write → POST mapping explicit in intent-to-method lookup.

  **mcp**: Return `Result` from `buildMcpTools()` on collision instead of throwing.

  **cli**: Verify exception catching via centralized `executeTrail`.

  **testing**: Follow context awareness improvements.

  **warden**: Refactor rules as composable trails with examples.

  **schema**: Error code and empty body fixes.

- [`f2a7857`](https://github.com/outfitter-dev/trails/commit/f2a785777ba9cb2d540c0fd79c80b43d4cb934d3): Initial v1 beta release of the Trails framework.

  - **@ontrails/core** — Result type, error taxonomy, trail/signal/topo, validateTopo, validateInput/Output, deriveFields, patterns, redaction, branded types, resilience
  - **@ontrails/cli** — CLI command model, flag derivation, output formatting
  - **@ontrails/mcp** — MCP surface, tool generation, annotations, progress bridge
  - **@ontrails/testing** — testAll, testExamples, testTrail, testCrosses, testContracts, testDetours, surface harnesses
  - **@ontrails/warden** — AST-based code convention rules via oxc-parser, drift detection, CI formatters
  - **@ontrails/topographer** — Surface map generation, hashing, semantic diffing, lock helpers

- [`3f678d4`](https://github.com/outfitter-dev/trails/commit/3f678d47b7c6258b561c635b4d93ef75b5b65c2e): Record topo and trail layer attachments in trail surface-map entries, including layer input schemas, so resolved-contract hashing and diffing can detect layer contract changes.
- [`331e3a9`](https://github.com/outfitter-dev/trails/commit/331e3a90e2094ca3f10a206e6bbbe379301283b2): Relocate the topo-store public API from `@ontrails/core` to `@ontrails/topographer` per ADR-0042. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

  Breaking pre-1.0 beta change. Update consumer imports:

  ```diff
  - import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
  + import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
  + import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
  ```

  The same root move applies to types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions`. The direct DB helper type `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

  Core newly exports `activationSourceKey`, `projectActivationSourceDeclaration`, `activationSourceDeclarationSignature`, and the `ActivationSourceProjection` type — these were already used internally and are now part of the public surface so `@ontrails/topographer` (the only consumer that needs them) can import them through normal package channels.

- [`be3db8a`](https://github.com/outfitter-dev/trails/commit/be3db8a23a64e73ac00fc759520acd9ccc2711c9): Add a Config-fed app-partitioned workspace view over app-local locks, with deterministic collision and hash facts plus separate completeness, binding, freshness, collection-boundary, and unowned-lock evidence. The lock census honors configured app roots that sit at or below default-ignored directories, while ignored directories inside an app root stay pruned so dependency locks are never reported as unowned.
- [`120caf5`](https://github.com/outfitter-dev/trails/commit/120caf57e6b6da4e01e53a1bff3a629cadf48d6e): Promote topo artifact commands to `trails compile` and `trails validate`.
- [`4b8d13b`](https://github.com/outfitter-dev/trails/commit/4b8d13b6bbac0de4e78bcb0ea0aae6cf06638f1e): **BREAKING:** Rename surface-map exposure fields from `trailheads` to `surfaces`.

  `SurfaceMapEntry.trailheads` is now `SurfaceMapEntry.surfaces`, persisted surface-map JSON now writes `surfaces`, and diff details now report `Surface "<name>" added/removed`.

  See `docs/migration/trailhead-to-surface.md` for the full migration map.

- [`8424b67`](https://github.com/outfitter-dev/trails/commit/8424b67d929b8e48d5e27dbf5b0d2347fde8e481): Make `run`, Wayfinder navigation and semantic diff, Warden, and shell
  completions use Config-owned project identity. Add stable `--app <id>`
  selection and structured project provenance, preserve partial saved workspace
  navigation, and require complete app-partitioned views for workspace diff.
  Preserve canonical sole-app discovery for standalone run and live Wayfinder
  consumers, and keep healthy shell completions available when configured sibling
  apps cannot load. Keep nested app completion suggestions inside the selected
  app, and retain selected project provenance plus authored inputs when running or
  listing trail examples. Preserve completed `--app` selection and typed
  `--root-dir` boundaries throughout dynamic completion, encode shell tokens
  through the internal variadic input without losing flags, spaces, or empty
  values. While an app value is still being completed, preserve its typed root
  but defer app-local module selection until the app is complete. Validate
  Config-owned identity on the same fresh Survey lease that derives live
  Wayfinder responses. Record the executed app identity as `executedAppId` on
  `run.examples` and `run.example` results so every listing and comparison names
  the app that produced it, including standalone single-app runs.

  Remove the superseded `buildWorkspaceTrailIndex()` package-workspace discovery
  API now that no operator consumer uses it as identity.

  Let Config-owning Warden consumers provide expected stable app bindings so topo
  identity is validated before any safe source fixes run. Require every configured
  app target to have committed app-local lock evidence before Warden claims the
  workspace is current.
  Expose deterministic per-app Warden drift evidence alongside the aggregate
  workspace verdict.
  Run the Warden artifact preflight for every topo-aware run that consumes saved
  lock evidence, including `--fix` runs, and run that preflight before a fixing
  run applies any safe source fix so invalid saved evidence can never rewrite
  source first. Reject `wayfind diff` baselines whose recorded lock hash or
  summary contradicts the embedded graph, including `--against-dir` directories.

- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.
- [`6712075`](https://github.com/outfitter-dev/trails/commit/67120754df3f614c7f4dd98be1fa0ba9d69b7765): Complete the v1 hard cutover from the `contour` domain-object declaration
  vocabulary to `entity` across contracts, topo facts, store helpers, Warden,
  Wayfinder, operator surfaces, examples, and generated locks. Existing
  applications must rename contour APIs, run `trails dev reset --yes` to discard
  pre-cutover local Topographer snapshots, and then recompile committed
  `trails.lock` artifacts before upgrading. Those derived snapshots are
  intentionally not read through a compatibility layer.
  The entity-shaped wire contract advances `TopoGraph` and split lock manifests
  from schema version 3 to 4; old split artifacts fail with regeneration guidance,
  while the canonical root `trails.lock` remains schema version 5.
  Wayfinder reports those stale rows as topo-store drift while keeping current
  committed lock facts available for inspection.
- [`ea55825`](https://github.com/outfitter-dev/trails/commit/ea558259fa9a6585e5b7e58ff2e0acf94f4ab8a5): Add the namespaced-overlays extension point to the topo graph: `deriveTopoGraph` accepts overlay registrations (namespace + zod schema + derive function), embeds validated facts as `overlays.<namespace>`, covers them with the canonical graph hash, and preserves unknown namespaces byte-for-byte so older toolchains never drop or reject newer overlays.
- [`35e5fed`](https://github.com/outfitter-dev/trails/commit/35e5fedd228e498783f479f0dd502e2f3ec772b8): Fold the Wayfinder graph-read catalog into `@ontrails/topography`. Wayfind
  remains the product, trail-id, CLI, and MCP brand, but there is no longer an
  `@ontrails/wayfinder` package to install or import. Programmatic consumers
  should move imports such as `wayfinderTopo`, `wayfindOverviewTrail`,
  `loadWayfinderArtifacts`, and the Wayfinder filter/provenance types to
  `@ontrails/topography`.

  Expose that package move as a governed Regrade transition so exact
  `@ontrails/wayfinder` imports can move safely while product vocabulary and near
  routes remain unchanged for review. Regrade routes package manifests through
  structured review instead of rewriting dependency keys as plain text.

  The Trails operator now reads all `wayfind.*` query trails and artifact helpers
  from `@ontrails/topography` while preserving the existing CLI/MCP schemas,
  route IDs, output shapes, and internal trail visibility.

- [`3a65ae3`](https://github.com/outfitter-dev/trails/commit/3a65ae363e05b7589f4a9876da4346886353b48c): Rename the durable graph substrate package from `@ontrails/topographer` to
  `@ontrails/topography` after folding Wayfind graph queries into that owner.

  Update imports to `@ontrails/topography` or
  `@ontrails/topography/backend-support`. The pre-1.0 cutover does not ship a
  compatibility package. TopoGraph, lock, topo-store, semantic diff, and Wayfind
  APIs keep their existing contracts, and the `trails wayfind` CLI and MCP names
  remain unchanged.

  The governed package-route transition moves legacy `@ontrails/wayfinder`
  imports directly to `@ontrails/topography`; it does not emit the retired
  intermediate `@ontrails/topographer` route.

- [`6be2e95`](https://github.com/outfitter-dev/trails/commit/6be2e958d52561b1793ca569f537a4aa204e676b): Extend the lockfile schema to catalog trail IDs across apps. `SurfaceLock` now carries a Zod-validated `workspaceTrails` map whose entries include the trail ID, owning app name, and app module path, plus a narrowed `version: '2'` envelope for structured locks. The new `readWorkspaceLock()` reader returns the enriched trail-id index when present, or `null` for legacy / single-app locks. `TopoSnapshot` gains an optional `appName` attribution column (SQLite `topo_snapshots.app_name`, schema version 11) so snapshots can be attributed to their owning app. Single-app repos remain backward compatible — no workspace metadata is emitted unless the writer is given a `workspaceTrails` map.
- [`819de09`](https://github.com/outfitter-dev/trails/commit/819de09c3f4aa1ac5c234a3c7fb2e9218fa85ced): Add `buildWorkspaceTrailIndex()` for runtime workspace topo discovery and cross-app trail-ID resolution. Discovers apps via root `package.json` workspaces, identifies Trails apps by `package.json.trails.module` or a `src/app.ts` convention, and builds an enriched `{ trailId → { trailId, appName, modulePath } }` index. Prefers the lockfile's `workspaceTrails` map (from TRL-403) when present for fast paths; falls back to dynamic loader-based discovery otherwise. The loader is injectable for testing. This is the runtime substrate that `trails run <id>` (TRL-398) will use to resolve trail IDs to owning apps without scanning source. Per the TRL-608 boundary rule, this is Topographer-owned tooling — `@ontrails/core` is not modified.
- [`be08686`](https://github.com/outfitter-dev/trails/commit/be08686b7cd865708e18beb1f9027ce22604ccae): Detect trail-ID collisions across apps in `buildWorkspaceTrailIndex()`. Replaces last-write-wins behavior with structured collision facts: `WorkspaceTrailIndexResult` now carries `collisions: WorkspaceTrailCollision[]` where each collision records the trail ID and the sorted list of owning apps. Colliding IDs are **omitted from `index`** so silent ambiguity is impossible; callers such as `trails run` must explicitly resolve via `--app` or prompt. Non-colliding IDs continue to resolve through the enriched `index` entries. Lockfile path always returns `collisions: []` because the lockfile is already a flat map and cannot collide.
- [`893025e`](https://github.com/outfitter-dev/trails/commit/893025e5ed23157262621a4528758b43258698d0): Add `--permit '<json>'` to inject an inline permit on `trails run`. New `permitPreset()` exposes a `--permit` string flag that the CLI build parses and validates against the `BasePermit` shape (`{ id: string, scopes: string[] }`) using a small Zod schema. Valid permits flow through `ExecuteTrailOptions.permit` → `applyContextOverrides` → `ctx.permit` so existing `enforcePermitRequirement` behavior just sees a populated permit. Invalid JSON or schema mismatch surface as `Result.err(ValidationError)` (exit code 1) before the trail runs, avoiding spurious `PermitError` results from malformed input. The flag is global, never routed into trail input (added to `META_FLAG_CANDIDATES`), and overlays only when defined.

  Topographer now projects permit requirements into surface-map entries and classifies permit-tightening diffs as breaking when new scopes are required.

- [`eee1307`](https://github.com/outfitter-dev/trails/commit/eee130707fee679d0675e8879f83e7dc4d5aa176): Serialize resolved surface facet metadata in TopoGraph artifacts and expose adapter type evidence for downstream projection checks.
- [`fde5516`](https://github.com/outfitter-dev/trails/commit/fde5516ad396faa718936b10ff658b3ade3383b9): Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `trailhead(app)` → `surface(app)`
  - Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
  - Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
  - Package taxonomy: retired connector vocabulary in favor of adapters

### Patch Changes

- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`7065b55`](https://github.com/outfitter-dev/trails/commit/7065b55568dced6df9f8687288842cdbbfd7f6e4): Fix two blocking bugs from real-world migration:

  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)

- [`42a87c1`](https://github.com/outfitter-dev/trails/commit/42a87c1b8691c2fad94ba45175b6eec0219f4594): Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- [`5cab237`](https://github.com/outfitter-dev/trails/commit/5cab237bcdb47ba6317953ee42aeee3458d26acb): Restructure HTTP package and fix Codex review findings.

  **http**: BREAKING — the Hono adapter moved to `@ontrails/hono` while `@ontrails/http` owns framework-agnostic route definitions. Hono is now a peer dependency of the adapter. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

  **schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.

- [`81373bc`](https://github.com/outfitter-dev/trails/commit/81373bc5e980bb06d56fb06af4f0986f72e318c7): Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

  The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

  Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.

- [`00f7093`](https://github.com/outfitter-dev/trails/commit/00f7093132a50c49b7bc2dcf9eef98f9424fd2e0): Add resources as a first-class primitive.

  Resources make infrastructure dependencies declarative, injectable, and governable. Define a resource with `resource()`, declare it on a trail with `resources: [db]`, and access it with `db.from(ctx)` or `ctx.resource()`.

  **Core:** `resource()` factory, `ResourceSpec<T>`, `ResourceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isResource` guard, `findDuplicateResourceId`, topo resource discovery and validation, `resources` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `resources` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Resource mock propagation through cross graphs.

  **Warden:** `resource-declarations` rule validates `db.from(ctx)` and `ctx.resource()` usage matches declared `resources: [...]`. `resource-exists` rule validates declared resource IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Resource overrides thread through the CLI, MCP, and HTTP surfaces.

  **Introspection:** Survey and surface map outputs include resource graph. Topo exposes `.resources`, `.getResource()`, `.hasResource()`, `.listResources()`, `.resourceIds()`, `.resourceCount`.

  **Docs:** ADR-009 accepted. Unified resource guide, updated vocabulary, getting-started, architecture, and package READMEs.

- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).
- [`de30d6c`](https://github.com/outfitter-dev/trails/commit/de30d6c358048fba48822ac43b1c2cc04a3d30be): Introduce `topo.compile` as the canonical trail for writing `.trails` lockfile
  and surface artifacts, remove the `survey --generate` mode, and update drift
  guidance to point at the compile command.
- [`c40865a`](https://github.com/outfitter-dev/trails/commit/c40865ac596d0c97a88abd9ba7259b864b836698): Batch topo-store signal relation reads for list views so signal consumers, producers, and source trails are loaded with one bounded query per relation table instead of per signal.
- [`8db145e`](https://github.com/outfitter-dev/trails/commit/8db145eeda955e55d000e52eb79a84cff755a9f8): Move activation report derivation into Topographer and keep the Trails app
  consuming the owner-held activation facts through a compatibility re-export.
- [`4bc8a99`](https://github.com/outfitter-dev/trails/commit/4bc8a9933c03a30d34a97530b712aecc183f5889): Clarify the Topographer artifact workflow around top-level `trails compile`, `trails validate`, and `trails diff` commands, including explicit diagnostics for retired `trails topo compile`, `trails topo verify`, and `trails topo check` attempts.
- [`4399fdb`](https://github.com/outfitter-dev/trails/commit/4399fdb21782ec877e36fcd76b37fa5f439aaf29): Renamed `@ontrails/schema` to `@ontrails/topographer`. Mechanical rename only — no API changes. Update import sites from `@ontrails/schema` to `@ontrails/topographer`. See ADR-0042 for the durable graph substrate doctrine.
- [`2d53717`](https://github.com/outfitter-dev/trails/commit/2d53717f7984e4d712b17e26069e2155d5e2cc75): Add trail-only `version` / `versions` authoring types and TopoGraph projection.
- [`16cb740`](https://github.com/outfitter-dev/trails/commit/16cb74032ecea582161743d1d30647489772c0f1): Run examples and contract checks across live trail version entries, and project version-entry example coverage into topo and survey reports.
- [`8894ecb`](https://github.com/outfitter-dev/trails/commit/8894ecbcafc1eaf9c75dcf9093f627acd0535735): Project content-addressed trail version markers and marker-prefix resolution.
- [`c36aca9`](https://github.com/outfitter-dev/trails/commit/c36aca978c7e1561e68701c084241e5b3f85dcef): Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- [`f8403c4`](https://github.com/outfitter-dev/trails/commit/f8403c4e3e2aabdef42c455b96c129344be5f590): Collapse normal topo compilation onto one root `trails.lock` envelope that embeds the TopoGraph, hash, and summary while keeping legacy `.trails/trails.lock` plus `.trails/topo.lock` readers for migration compatibility.
- [`371d19e`](https://github.com/outfitter-dev/trails/commit/371d19ea243507bfc7f85882373c40eb37476d52): Move the default `trails.db` location to the per-user Trails state store, expose deterministic state-store path helpers, stop scaffolding disposable `.trails/cache` and `.trails/state` directories, and update topo-store documentation for the global-state substrate.
- [`6e63e48`](https://github.com/outfitter-dev/trails/commit/6e63e483617b84cb6868d0c4d58d5b5a8d3b9ed2): Complete the v1 grouped surface-entry vocabulary cutover from facet to trailhead, including Regrade dogfood support for governed string literal renames and composed AST rewrite application.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.
- [`a89d469`](https://github.com/outfitter-dev/trails/commit/a89d4696aa78f3dda9394c14665ab3ea8c0f313c): Make `trails compile` → `trails validate` round-trip deterministically (TRL-1191). The per-user topo store no longer reuses previously stored JSON Schema bytes by zod definition hash — that hash cannot see `.describe()` metadata or object field order, so a warm store could serve pre-edit schema values into a freshly compiled lock and make `validate` report it stale immediately. Every snapshot now regenerates schema JSON from the live Zod schema, the store's graph hash goes through the same shared `deriveStableHash` path as `deriveTopoGraphHash`, and the committed `trails.lock` omits the wallclock `generatedAt` field so recompiling unchanged sources yields a byte-identical lock. `TopoGraph.generatedAt` is now optional; locks written by earlier versions still parse.
- [`a89d469`](https://github.com/outfitter-dev/trails/commit/a89d4696aa78f3dda9394c14665ab3ea8c0f313c): Make the per-user topo store an honest cache (TRL-1196). Every snapshot now records a content fingerprint of the app source set (`topo_snapshots.source_fingerprint`, store schema v14), `trails compile` reports it in its output, and Wayfinder artifact loading compares it against a freshly derived fingerprint — a mismatch surfaces as a `topo-store-source-fingerprint-mismatch` stale reason instead of silently serving pre-edit facts. Compile derives everything from live source on every run, so a poisoned or stale store can never reach `trails.lock`, with or without `--force`.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.
- [`b12e19b`](https://github.com/outfitter-dev/trails/commit/b12e19b98f481e3eac7d33ac25f8d5f818026f7c): Added typed topo-store views over saved `TopoGraph` content, including typed
  `topoGraph`, `entries`, and `contours` accessors plus parsed lock manifest and
  TopoGraph payloads on exported snapshot records.
- [`ed7f6f6`](https://github.com/outfitter-dev/trails/commit/ed7f6f631f9a0ec2dd5437ac28469b2be60efc49): Expand topo-store and survey trail detail records with resolved TopoGraph contract facts for blind-agent review.
- [`653d1fc`](https://github.com/outfitter-dev/trails/commit/653d1fc27243164d43b16e50c7d6fb83a5faea8e): Add a top-level `trails diff` command and extend TopoGraph diffs with version, marker, lifecycle status, support set, and force-event audit details.
- [`2e76288`](https://github.com/outfitter-dev/trails/commit/2e76288ab0ba13afb5e648e90d6ecb54133e88ed): Add graph-only force event projection for forced compile break acceptance and block unforced breaking topo changes.
- [`99523f2`](https://github.com/outfitter-dev/trails/commit/99523f2a67e92091781165b6c847252b910554e2): Clean up resource context naming in shipped source and examples so resource
  factories consistently use resource vocabulary.
- [`9bcf34e`](https://github.com/outfitter-dev/trails/commit/9bcf34e53e0c7a40f4ebb78be7f47ac22421ff25): Add trail-owned CLI command projection metadata and serialize resolved command
  route facts for downstream tools.
- [`59d10da`](https://github.com/outfitter-dev/trails/commit/59d10da59dde304141736ef883d4257cc97f017c): Dogfood CLI command route aliases through the Trails operator, saved Topographer artifacts, and Wayfinder contract inspection.
- [`d9c6e50`](https://github.com/outfitter-dev/trails/commit/d9c6e507e552ad467b717d9b169e1f4850999565): Embed serializable library projection facts in `topo.lock` so Wayfinder, Warden,
  and generated library package governance can inspect exports, exclusions, and
  collisions from the artifact family.
- [`b248d4a`](https://github.com/outfitter-dev/trails/commit/b248d4ad3346eb25ade876eb57dc690e95d2fe1c): Add the read-only Wayfinder artifact loader and fact provenance envelope helpers, including cold topo-store schema preflight support.
- [`e95c6e3`](https://github.com/outfitter-dev/trails/commit/e95c6e3dafc51b432e0e43baa1f7afcce4f07d7f): Remove draft ADR anchors from public source comments.
- [`082408e`](https://github.com/outfitter-dev/trails/commit/082408e32c16fd737d8899fc8c8a51fa0f61b3d9): Warn when a configured workspace contains a nested `trails.lock` outside `workspace.apps`, and reject a workspace-root aggregate lock without deriving app identity from either artifact.

  Make the Trails operator topo reproducible by keeping its authored examples free of temporary filesystem paths, so its committed app-owned lock validates deterministically.

  Replay known operator current-app examples through the selected Config entry, including the nested project input in the authored `run` example, so custom app layouts do not fall back to `src/app.ts` without rewriting matching fields in domain examples.

  Add `trails config explain` as the operator-owned inspection surface for source-static project and app identity. It reports the Config-authored catalog, selected extent, and selection provenance without loading app modules or reading locks.

  **BREAKING:** Remove the public `@ontrails/config` `configExplain` trail export. Library consumers that inspect resolved deployment provenance must migrate to `deriveConfigProvenance`; operators and agents that inspect Config-authored app identity must migrate to `trails config explain`. The broader config cascade stays deferred.

## 1.0.0-beta.50

## 1.0.0-beta.49

## 1.0.0-beta.48

## 1.0.0-beta.47

## 1.0.0-beta.46

## 1.0.0-beta.45

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.

### Patch Changes

- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`6712075`](https://github.com/outfitter-dev/trails/commit/67120754df3f614c7f4dd98be1fa0ba9d69b7765): Complete the v1 hard cutover from the `contour` domain-object declaration
  vocabulary to `entity` across contracts, topo facts, store helpers, Warden,
  Wayfinder, operator surfaces, examples, and generated locks. Existing
  applications must rename contour APIs, run `trails dev reset --yes` to discard
  pre-cutover local Topographer snapshots, and then recompile committed
  `trails.lock` artifacts before upgrading. Those derived snapshots are
  intentionally not read through a compatibility layer.
  The entity-shaped wire contract advances `TopoGraph` and split lock manifests
  from schema version 3 to 4; old split artifacts fail with regeneration guidance,
  while the canonical root `trails.lock` remains schema version 5.
  Wayfinder reports those stale rows as topo-store drift while keeping current
  committed lock facts available for inspection.
- [`35e5fed`](https://github.com/outfitter-dev/trails/commit/35e5fedd228e498783f479f0dd502e2f3ec772b8): Fold the Wayfinder graph-read catalog into `@ontrails/topography`. Wayfind
  remains the product, trail-id, CLI, and MCP brand, but there is no longer an
  `@ontrails/wayfinder` package to install or import. Programmatic consumers
  should move imports such as `wayfinderTopo`, `wayfindOverviewTrail`,
  `loadWayfinderArtifacts`, and the Wayfinder filter/provenance types to
  `@ontrails/topography`.

  Expose that package move as a governed Regrade transition so exact
  `@ontrails/wayfinder` imports can move safely while product vocabulary and near
  routes remain unchanged for review. Regrade routes package manifests through
  structured review instead of rewriting dependency keys as plain text.

  The Trails operator now reads all `wayfind.*` query trails and artifact helpers
  from `@ontrails/topography` while preserving the existing CLI/MCP schemas,
  route IDs, output shapes, and internal trail visibility.

- [`3a65ae3`](https://github.com/outfitter-dev/trails/commit/3a65ae363e05b7589f4a9876da4346886353b48c): Rename the durable graph substrate package from `@ontrails/topographer` to
  `@ontrails/topography` after folding Wayfind graph queries into that owner.

  Update imports to `@ontrails/topography` or
  `@ontrails/topography/backend-support`. The pre-1.0 cutover does not ship a
  compatibility package. TopoGraph, lock, topo-store, semantic diff, and Wayfind
  APIs keep their existing contracts, and the `trails wayfind` CLI and MCP names
  remain unchanged.

  The governed package-route transition moves legacy `@ontrails/wayfinder`
  imports directly to `@ontrails/topography`; it does not emit the retired
  intermediate `@ontrails/topographer` route.

## 1.0.0-beta.39

### Minor Changes

- [`ea55825`](https://github.com/outfitter-dev/trails/commit/ea558259fa9a6585e5b7e58ff2e0acf94f4ab8a5): Add the namespaced-overlays extension point to the topo graph: `deriveTopoGraph` accepts overlay registrations (namespace + zod schema + derive function), embeds validated facts as `overlays.<namespace>`, covers them with the canonical graph hash, and preserves unknown namespaces byte-for-byte so older toolchains never drop or reject newer overlays.

### Patch Changes

- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`81373bc`](https://github.com/outfitter-dev/trails/commit/81373bc5e980bb06d56fb06af4f0986f72e318c7): Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

  The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

  Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.

- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).
- [`a89d469`](https://github.com/outfitter-dev/trails/commit/a89d4696aa78f3dda9394c14665ab3ea8c0f313c): Make `trails compile` → `trails validate` round-trip deterministically (TRL-1191). The per-user topo store no longer reuses previously stored JSON Schema bytes by zod definition hash — that hash cannot see `.describe()` metadata or object field order, so a warm store could serve pre-edit schema values into a freshly compiled lock and make `validate` report it stale immediately. Every snapshot now regenerates schema JSON from the live Zod schema, the store's graph hash goes through the same shared `deriveStableHash` path as `deriveTopoGraphHash`, and the committed `trails.lock` omits the wallclock `generatedAt` field so recompiling unchanged sources yields a byte-identical lock. `TopoGraph.generatedAt` is now optional; locks written by earlier versions still parse.
- [`a89d469`](https://github.com/outfitter-dev/trails/commit/a89d4696aa78f3dda9394c14665ab3ea8c0f313c): Make the per-user topo store an honest cache (TRL-1196). Every snapshot now records a content fingerprint of the app source set (`topo_snapshots.source_fingerprint`, store schema v14), `trails compile` reports it in its output, and Wayfinder artifact loading compares it against a freshly derived fingerprint — a mismatch surfaces as a `topo-store-source-fingerprint-mismatch` stale reason instead of silently serving pre-edit facts. Compile derives everything from live source on every run, so a poisoned or stale store can never reach `trails.lock`, with or without `--force`.

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

### Patch Changes

- [`6e63e48`](https://github.com/outfitter-dev/trails/commit/6e63e483617b84cb6868d0c4d58d5b5a8d3b9ed2): Complete the v1 grouped surface-entry vocabulary cutover from facet to trailhead, including Regrade dogfood support for governed string literal renames and composed AST rewrite application.

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- 8db145e: Move activation report derivation into Topographer and keep the Trails app
  consuming the owner-held activation facts through a compatibility re-export.
- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [21c6dda]
- Updated dependencies [fe72b84]
  - @ontrails/core@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/core@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/core@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/core@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/core@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- f8403c4: Collapse normal topo compilation onto one root `trails.lock` envelope that embeds the TopoGraph, hash, and summary while keeping legacy `.trails/trails.lock` plus `.trails/topo.lock` readers for migration compatibility.
- 371d19e: Move the default `trails.db` location to the per-user Trails state store, expose deterministic state-store path helpers, stop scaffolding disposable `.trails/cache` and `.trails/state` directories, and update topo-store documentation for the global-state substrate.
- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- c36aca9: Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- 9bcf34e: Add trail-owned CLI command projection metadata and serialize resolved command
  route facts for downstream tools.
- 59d10da: Dogfood CLI command route aliases through the Trails operator, saved Topographer artifacts, and Wayfinder contract inspection.
- d9c6e50: Embed serializable library projection facts in `topo.lock` so Wayfinder, Warden,
  and generated library package governance can inspect exports, exclusions, and
  collisions from the artifact family.
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

- 99523f2: Clean up resource context naming in shipped source and examples so resource
  factories consistently use resource vocabulary.
- Updated dependencies [99523f2]
  - @ontrails/core@1.0.0-beta.21

## 1.0.0-beta.20

### Minor Changes

- eee1307: Serialize resolved surface facet metadata in TopoGraph artifacts and expose adapter type evidence for downstream projection checks.

### Patch Changes

- b248d4a: Add the read-only Wayfinder artifact loader and fact provenance envelope helpers, including cold topo-store schema preflight support.
- Updated dependencies [851a2a3]
  - @ontrails/core@1.0.0-beta.20

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.

### Minor Changes

- 120caf5: Promote topo artifact commands to `trails compile` and `trails validate`.

### Patch Changes

- 4bc8a99: Clarify the Topographer artifact workflow around top-level `trails compile`, `trails validate`, and `trails diff` commands, including explicit diagnostics for retired `trails topo compile`, `trails topo verify`, and `trails topo check` attempts.
- 2d53717: Add trail-only `version` / `versions` authoring types and TopoGraph projection.
- 16cb740: Run examples and contract checks across live trail version entries, and project version-entry example coverage into topo and survey reports.
- 8894ecb: Project content-addressed trail version markers and marker-prefix resolution.
- 653d1fc: Add a top-level `trails diff` command and extend TopoGraph diffs with version, marker, lifecycle status, support set, and force-event audit details.
- 2e76288: Add graph-only force event projection for forced compile break acceptance and block unforced breaking topo changes.
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

- Updated dependencies [3dc8254]
  - @ontrails/core@1.0.0-beta.17

## 1.0.0-beta.16

### Major Changes

- 2bf239e: Move OpenAPI generation ownership to the HTTP surface.

  **http**: Export `deriveOpenApiSpec()` and its OpenAPI types from `@ontrails/http`.

  **schema**: Remove the OpenAPI helper export so schema stays focused on surface maps, locks, and semantic diffing.

- 3395234: Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- 7a1d4a9: Rename the public resolved graph API from `SurfaceMap` to `TopoGraph`, including
  the derive, hash, diff, and current graph artifact I/O helpers.
- 84f595a: Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
- d2cb9ba: Rename topo-store export artifacts from surface-era names to TopoGraph names. The `topo_exports` table now stores `topo_graph`, `topo_graph_hash`, and `lock_manifest`, and backend-support export records expose `topoGraphJson`, `topoGraphHash`, and `lockManifestJson`.
- bbb1ea4: Move the workspace trail index out of the lock manifest and into the serialized TopoGraph artifact. Workspace index reads now consult `topo.lock` workspace metadata, and `buildWorkspaceTrailIndex()` exposes `topo-lock` cache hits through the artifact-family path.

### Minor Changes

- 3f678d4: Record topo and trail layer attachments in trail surface-map entries, including layer input schemas, so resolved-contract hashing and diffing can detect layer contract changes.
- 331e3a9: Relocate the topo-store public API from `@ontrails/core` to `@ontrails/topographer` per ADR-0042. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

  Breaking pre-1.0 beta change. Update consumer imports:

  ```diff
  - import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
  + import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
  + import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
  ```

  The same root move applies to types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions`. The direct DB helper type `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

  Core newly exports `activationSourceKey`, `projectActivationSourceDeclaration`, `activationSourceDeclarationSignature`, and the `ActivationSourceProjection` type — these were already used internally and are now part of the public surface so `@ontrails/topographer` (the only consumer that needs them) can import them through normal package channels.

- 4b8d13b: **BREAKING:** Rename surface-map exposure fields from `trailheads` to `surfaces`.

  `SurfaceMapEntry.trailheads` is now `SurfaceMapEntry.surfaces`, persisted surface-map JSON now writes `surfaces`, and diff details now report `Surface "<name>" added/removed`.

  See `docs/migration/trailhead-to-surface.md` for the full migration map.

- 6be2e95: Extend the lockfile schema to catalog trail IDs across apps. `SurfaceLock` now carries a Zod-validated `workspaceTrails` map whose entries include the trail ID, owning app name, and app module path, plus a narrowed `version: '2'` envelope for structured locks. The new `readWorkspaceLock()` reader returns the enriched trail-id index when present, or `null` for legacy / single-app locks. `TopoSnapshot` gains an optional `appName` attribution column (SQLite `topo_snapshots.app_name`, schema version 11) so snapshots can be attributed to their owning app. Single-app repos remain backward compatible — no workspace metadata is emitted unless the writer is given a `workspaceTrails` map.
- 819de09: Add `buildWorkspaceTrailIndex()` for runtime workspace topo discovery and cross-app trail-ID resolution. Discovers apps via root `package.json` workspaces, identifies Trails apps by `package.json.trails.module` or a `src/app.ts` convention, and builds an enriched `{ trailId → { trailId, appName, modulePath } }` index. Prefers the lockfile's `workspaceTrails` map (from TRL-403) when present for fast paths; falls back to dynamic loader-based discovery otherwise. The loader is injectable for testing. This is the runtime substrate that `trails run <id>` (TRL-398) will use to resolve trail IDs to owning apps without scanning source. Per the TRL-608 boundary rule, this is Topographer-owned tooling — `@ontrails/core` is not modified.
- be08686: Detect trail-ID collisions across apps in `buildWorkspaceTrailIndex()`. Replaces last-write-wins behavior with structured collision facts: `WorkspaceTrailIndexResult` now carries `collisions: WorkspaceTrailCollision[]` where each collision records the trail ID and the sorted list of owning apps. Colliding IDs are **omitted from `index`** so silent ambiguity is impossible; callers such as `trails run` must explicitly resolve via `--app` or prompt. Non-colliding IDs continue to resolve through the enriched `index` entries. Lockfile path always returns `collisions: []` because the lockfile is already a flat map and cannot collide.
- 893025e: Add `--permit '<json>'` to inject an inline permit on `trails run`. New `permitPreset()` exposes a `--permit` string flag that the CLI build parses and validates against the `BasePermit` shape (`{ id: string, scopes: string[] }`) using a small Zod schema. Valid permits flow through `ExecuteTrailOptions.permit` → `applyContextOverrides` → `ctx.permit` so existing `enforcePermitRequirement` behavior just sees a populated permit. Invalid JSON or schema mismatch surface as `Result.err(ValidationError)` (exit code 1) before the trail runs, avoiding spurious `PermitError` results from malformed input. The flag is global, never routed into trail input (added to `META_FLAG_CANDIDATES`), and overlays only when defined.

  Topographer now projects permit requirements into surface-map entries and classifies permit-tightening diffs as breaking when new scopes are required.

### Patch Changes

- de30d6c: Introduce `topo.compile` as the canonical trail for writing `.trails` lockfile
  and surface artifacts, remove the `survey --generate` mode, and update drift
  guidance to point at the compile command.
- c40865a: Batch topo-store signal relation reads for list views so signal consumers, producers, and source trails are loaded with one bounded query per relation table instead of per signal.
- 4399fdb: Renamed `@ontrails/schema` to `@ontrails/topographer`. Mechanical rename only — no API changes. Update import sites from `@ontrails/schema` to `@ontrails/topographer`. See ADR-0042 for the durable graph substrate doctrine.
- b12e19b: Added typed topo-store views over saved `TopoGraph` content, including typed
  `topoGraph`, `entries`, and `contours` accessors plus parsed lock manifest and
  TopoGraph payloads on exported snapshot records.
- ed7f6f6: Expand topo-store and survey trail detail records with resolved TopoGraph contract facts for blind-agent review.
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

## Unreleased

### Patch Changes

- Renamed package from `@ontrails/schema` to `@ontrails/topographer`. No API changes; mechanical rename only. See ADR-0042 for the durable graph substrate doctrine.

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

### Patch Changes

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

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

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

- Restructure HTTP package and fix Codex review findings.

  **http**: BREAKING — `trailhead()` moved to `@ontrails/http/hono` subpath. Hono is now a peer dependency. `buildHttpRoutes()` is framework-agnostic. Fixed: malformed JSON → 400, execute() never throws, query parsing preserves raw strings and supports arrays.

  **schema**: OpenAPI 200 response wraps in `{ data }` envelope matching wire format. Always includes 400 ValidationError with error schema. basePath trailing slash normalized.

  - @ontrails/core@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- HTTP trailhead and OpenAPI generation.

  **http**: New `@ontrails/http` package — Hono-based HTTP connector. `trailhead()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

  **schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

  **trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.

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
