# @ontrails/core

## 1.0.0-beta.40

### Minor Changes

- [`1e64ee7`](https://github.com/outfitter-dev/trails/commit/1e64ee7bc270901486c5bb51ac38bf045c924adc): Add first-class queue activation sources with `queue()` in `@ontrails/core`.
  Queue sources validate their runtime queue name and parse contract, project the
  queue name into durable topo facts, participate in activation input
  compatibility, and block established outputs when malformed.

  Add `@ontrails/cloudflare/queues` with `cloudflareQueue`, `createMemoryQueue`,
  and `createQueueHandler`. Cloudflare Workers now expose both `fetch` and
  `queue` entrypoints from `createWorkersHandler`, resolve env-bound resources for
  queue-activated trails, acknowledge successful/skipped/cancelled messages, and
  acknowledge traced non-retryable Trails errors so permanently invalid messages
  do not churn through the queue. Failures explicitly marked retryable enter
  Cloudflare's retry and DLQ flow, with rate-limit delays preserved.

  `@ontrails/warden` now treats queue activation sources as materialized and
  requires `cloudflareQueue` public export example coverage.

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
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

### Patch Changes

- [`9874e0b`](https://github.com/outfitter-dev/trails/commit/9874e0bb034c0f98edeb19833d9d3519c2a07a4c): Add `@ontrails/cloudflare/d1`, an env-bound Cloudflare D1 store resource for `@ontrails/store` definitions. The new subpath exports `cloudflareD1` and `connectD1`, supports the backend-agnostic store accessor contract (`get`, `list`, `upsert`, `remove`), versioned-table optimistic concurrency, fixture/mock seeding, store-derived write signals, Miniflare-backed conformance tests, and Worker env-bridge integration.

  `@ontrails/core` and `@ontrails/store` no longer require the Bun global for signal fire ids or late-bound store signal tokens, so store definitions and store-derived signal emission work inside Worker modules. `@ontrails/warden` now treats `cloudflareD1` as a required Cloudflare public export with `@example` coverage.

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

### Patch Changes

- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`6b75a46`](https://github.com/outfitter-dev/trails/commit/6b75a46ab6210237d306cceade833bf9ce6e7431): The core barrel is now execution-portable: no eager `bun:`/`node:` builtin imports remain on its module graph (TRL-1198). `trails-db`, workspace discovery, and path security load `bun:sqlite`, `node:fs`, `node:os`, and `node:path` lazily through `process.getBuiltinModule` at first use, and signal payload summaries plus per-project store keys use a pure SHA-256 (output-identical to `node:crypto`). A Worker bundle no longer needs a `bun:sqlite` stub plugin or the `nodejs_compat` flag to serve trails; the Cloudflare adapter's miniflare lane now bundles without externals and boots workerd without `nodejs_compat` as the structural regression gate, and its README stub instructions are replaced with the portable posture. Tooling helpers throw a clear `InternalError` naming the missing builtin when called on runtimes without it.
- [`81373bc`](https://github.com/outfitter-dev/trails/commit/81373bc5e980bb06d56fb06af4f0986f72e318c7): Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

  The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

  Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.

- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).
- [`28d75fb`](https://github.com/outfitter-dev/trails/commit/28d75fbadecc62794f43957bc3aca11a4cf39c51): Add `forkVersion()` so fork version entries get typed blazes (TRL-1180). `TrailVersions` fixes every entry's generics to `unknown`, which left fork blazes with `unknown` input and forced authors to re-parse the already-validated value just to narrow it. `forkVersion({ input, output, blaze, ... })` threads the entry's own schemas into the blaze signature (including merged `composeInput` fields) and enforces the entry's output shape at compile time; the erasure back to `TrailVersionEntry` is sound because the fork pipeline validates raw input against the entry's own schema before dispatch. `TrailVersionForkSpec` is exported alongside it.
- [`b9e82a3`](https://github.com/outfitter-dev/trails/commit/b9e82a33546356c93fbc302fb934a83f19f1c2c5): Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.

## 1.0.0-beta.38

### Patch Changes

- [`a105127`](https://github.com/outfitter-dev/trails/commit/a105127e5662ed9a6c245125f791fb0182da3f5e): Add the `@ontrails/cloudflare` adapter collection with its first two service subpaths. `@ontrails/cloudflare/workers` exports `createWorkersHandler`, a materializer producing the `{ fetch(request, env, ctx) }` Worker export on the shared HTTP fetch kernel, with an env bridge that re-resolves env-bound resources whenever a new Worker `env` arrives so no resource instance serves a request with a stale env. `@ontrails/cloudflare/kv` exports `cloudflareKv`, a resource definition wrapping a KV namespace binding (`get`/`put`/`delete`/`list` with TTL options) plus an in-memory `createMemoryKv` mock so `testAll` runs configuration-free.

  `@ontrails/core` now guards the default trail context fields: `requestId` falls back to `crypto.randomUUID()` when the `Bun` global is absent, and `cwd`/`env` fall back to `'/'`/`{}` when `process` is absent, so trail execution works on runtimes like Cloudflare Workers.

  `@ontrails/warden` registers the `@ontrails/cloudflare` public barrel in the repo-local `public-export-example-coverage` policy, requiring `@example` TSDoc coverage on `createWorkersHandler` and `cloudflareKv`.

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

### Patch Changes

- [`417bd84`](https://github.com/outfitter-dev/trails/commit/417bd8471d0f0f47ad5f33cd2ac1c606eccd72f8): Promote signal trace helpers from tracing compatibility code to core exports, and make tracing's memory sink wrapper use the observe-owned implementation.
- [`a88114b`](https://github.com/outfitter-dev/trails/commit/a88114b4dd0772db6b58ecdb7671e4169e6bdca5): Expose stable typed topo diagnostics for missing references so downstream
  migration tooling can consume validation results without parsing human messages.

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

### Patch Changes

- 3e5c0fc: Export shared diagnostic base types from core and align governance diagnostic
  severity vocabulary across adapter checks, permits, and Warden.
- f3c4fef: Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
- cb0a9d8: Export shared workspace package discovery helpers from core and migrate first-party discovery callers.
- 21c6dda: Rename topo and draft report types to `TopoDiagnostic` and `DraftDiagnostic`, with deprecated `TopoIssue` and `DraftFinding` aliases preserved for source compatibility.
- fe72b84: Fold remaining Regrade and Warden scan-target surfaces onto the shared path-scope vocabulary.

## 1.0.0-beta.31

### Patch Changes

- 4cd5d4e: Add shared glob, path-scope, and trail-id glob contracts for downstream Trails tooling.
- 38907cc: Adopt the shared trail-id glob engine for surface filtering and Wayfinder entity filters so dotted `*`, `**`, and `?` patterns behave consistently across graph inspection and surface selection.

## 1.0.0-beta.30

## 1.0.0-beta.29

## 1.0.0-beta.28

## 1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- 1307568: Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
- 371d19e: Move the default `trails.db` location to the per-user Trails state store, expose deterministic state-store path helpers, stop scaffolding disposable `.trails/cache` and `.trails/state` directories, and update topo-store documentation for the global-state substrate.

## 1.0.0-beta.25

### Patch Changes

- c36aca9: Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- 3befcf1: Configure Trails SQLite read and write connections with a busy timeout so concurrent artifact readers and writers wait through transient lock contention instead of failing immediately.
- a4f9cf6: Reserve the `shift` error category and `WorkspaceShiftError` before the stable
  cutover so surface mappings can distinguish moved-workspace retry verdicts.
  Update Warden's error-mapping completeness examples to cover the reserved
  category.
- 9bcf34e: Add trail-owned CLI command projection metadata and serialize resolved command
  route facts for downstream tools.

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
