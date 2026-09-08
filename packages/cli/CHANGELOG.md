# @ontrails/cli

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

- [`39ecab9`](https://github.com/outfitter-dev/trails/commit/39ecab9940ad8255215c25b9db55047180828457): Bug fixes across all surface packages found via parallel Codex review.

  **core**: Fix Result.toJson false circular detection on DAGs, deserializeError subclass round-trip, topo cross-kind ID collisions, validateTopo multi-node cycle detection, error example input validation bypass, and deriveFields array type collapse.

  **cli**: Switch the CLI surface to parseAsync for proper async error handling, add boolean flag negation (--no-flag), and strict number parsing that rejects partial input.

  **mcp**: Align BlobRef with core (including ReadableStream support) and detect tool-name collisions after normalization.

  **testing**: Include trails in testContracts validation, with cross-context awareness.

  **warden**: Collect trail detour targets, validate detour refs in trail specs, and stop implementation-returns-result from walking into nested function bodies.

- [`e991a5b`](https://github.com/outfitter-dev/trails/commit/e991a5b2e8b9057d8e33a067e29fb0aca641d5ad): Add generic enum value aliases for CLI flags and migrate Warden command aliases onto the shared alias model.
- [`25f3c5c`](https://github.com/outfitter-dev/trails/commit/25f3c5ca3e4e7d5ec105f06384111a2ec37c7b72): Add the dedicated `@ontrails/commander` adapter package and move the Commander runtime out of the `@ontrails/cli/commander` subpath. Extend the repo-local package-source guardrails to cover adapter package source as the Commander runtime moves under `adapters/`.
- [`f2a7857`](https://github.com/outfitter-dev/trails/commit/f2a785777ba9cb2d540c0fd79c80b43d4cb934d3): Initial v1 beta release of the Trails framework.

  - **@ontrails/core** — Result type, error taxonomy, trail/signal/topo, validateTopo, validateInput/Output, deriveFields, patterns, redaction, branded types, resilience
  - **@ontrails/cli** — CLI command model, flag derivation, output formatting
  - **@ontrails/mcp** — MCP surface, tool generation, annotations, progress bridge
  - **@ontrails/testing** — testAll, testExamples, testTrail, testCrosses, testContracts, testDetours, surface harnesses
  - **@ontrails/warden** — AST-based code convention rules via oxc-parser, drift detection, CI formatters
  - **@ontrails/topographer** — Surface map generation, hashing, semantic diffing, lock helpers

- [`4ad6b25`](https://github.com/outfitter-dev/trails/commit/4ad6b257497bc4e07bb66c261b4164277e7b62be): Lexicon rename cleanup (ADR-0023). Breaking for `@ontrails/core`, `@ontrails/cli`, and `@ontrails/tracing` at the boundary; internal-only churn for `@ontrails/warden`.

  - **core**: the topo store schema renames `topo_provisions` / `topo_trail_provisions` → `topo_resources` / `topo_trail_resources` and `provision_count` → `resource_count`. Schema version bumped v4→v5. Stores still carrying the legacy schema are detected on open, dropped, and recreated from the new DDL — previous topo saves are cleared. Stored-data helpers `listTopoStoreProvisions` / `getTopoStoreProvision` / `readProvisionUsage` / `mapProvisionRow` renamed to their `resource` counterparts. TS row types `TopoTrailProvisionRow` / `TopoProvisionRow` renamed to `TopoTrailResourceRow` / `TopoResourceRow`.
  - **cli**: CLI output mode env vars are now derived from the topo name per ADR-0023. Legacy globals `TRAILS_JSON` / `TRAILS_JSONL` are no longer honored — a topo named `stash` reads `STASH_JSON` / `STASH_JSONL`. `ActionResultContext` gains a `topoName: string` field; `resolveOutputMode(flags, topoName)` takes a topo name argument.
  - **tracing**: legacy `.trails/dev/tracker.db` migration path removed. Any user still running a pre-rename beta build with a `tracker.db` should delete it or migrate before upgrading.
  - **warden**: internal-only rename of `provisionDeclarations` / `provisionExists` rules and their trails to `resourceDeclarations` / `resourceExists`. No behavior change.

- [`ed171d5`](https://github.com/outfitter-dev/trails/commit/ed171d5c95da98c09ee6eb316d4dd65853228b6b): Split `trails survey` detail inspection into role-anchored `survey.trail`, `survey.resource`, and `survey.signal` trails while keeping bare `survey <id>` as an all-kinds lookup. Remove the temporary `survey --openapi` and `topo.show` CLI shapes. CLI command projection now supports executable parent commands with positional arguments alongside child commands.
- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.
- [`fbd42fc`](https://github.com/outfitter-dev/trails/commit/fbd42fcc249816bcee1b220bc4b555fda28c4d46): Unify structured CLI input around `--input <path|->` and `--input-json`.
  `--input` reads JSON from a file path or from stdin when the value is `-`;
  `--input-file`, `--stdin`, and the `structuredInputFieldByTrail` routing
  option are removed. Structured payloads now merge directly into each trail's
  typed input object, so `trails run` callers provide the inner trail payload
  under the run trail's `input` field.
- [`63d1aef`](https://github.com/outfitter-dev/trails/commit/63d1aef4c320b9981e647f7e21a4061e4a368a88): Add `--quiet` / `-q` flag to strip the `inner-trail-result` envelope from `trails run` stdout. On success, stdout becomes the inner value JSON only (no `{ kind, trailId, value }` wrapper). Composes with `--json` / `--jsonl` (those control format; `--quiet` controls envelope vs unwrapped). Wired as a global CLI flag via `outputModePreset()` so all commands surface it; the run-trail-specific unwrap logic lives in `apps/trails/src/cli.ts` next to the existing collision-recovery wrapper.
- [`112b9f2`](https://github.com/outfitter-dev/trails/commit/112b9f21ebc27e18f970a717a3f3f06e209f7d23): Add `dryRun` to `TrailContext` and wire `--dry-run`. `TrailContext` gains an optional `dryRun?: boolean` field, defaulted to `false` in `createTrailContext`. `ExecuteTrailOptions` carries `dryRun?: boolean` through `applyContextOverrides` so `executeTrail(t, input, { dryRun: true })` produces `ctx.dryRun === true`. The CLI's existing `dryRunPreset` (auto-derived for `intent: 'write' | 'destroy'` trails) now flows through `META_FLAG_CANDIDATES` and reaches the executor via `runTrailOnce`, so `trails run booking.cancel … --dry-run` lands `ctx.dryRun === true` on the trail's blaze. Trails that don't read the field are unchanged. Read-intent trails don't get `--dry-run` exposed.
- [`893025e`](https://github.com/outfitter-dev/trails/commit/893025e5ed23157262621a4528758b43258698d0): Add `--permit '<json>'` to inject an inline permit on `trails run`. New `permitPreset()` exposes a `--permit` string flag that the CLI build parses and validates against the `BasePermit` shape (`{ id: string, scopes: string[] }`) using a small Zod schema. Valid permits flow through `ExecuteTrailOptions.permit` → `applyContextOverrides` → `ctx.permit` so existing `enforcePermitRequirement` behavior just sees a populated permit. Invalid JSON or schema mismatch surface as `Result.err(ValidationError)` (exit code 1) before the trail runs, avoiding spurious `PermitError` results from malformed input. The flag is global, never routed into trail input (added to `META_FLAG_CANDIDATES`), and overlays only when defined.

  Topographer now projects permit requirements into surface-map entries and classifies permit-tightening diffs as breaking when new scopes are required.

- [`ed888e2`](https://github.com/outfitter-dev/trails/commit/ed888e27856212c25cb27cbfc365fc9852bea6b9): Add `--token <token>` to `trails run` for permit resolution via the topo's auth adapter. New `tokenPreset()` exposes the flag; `'token'` is added to `META_FLAG_CANDIDATES`. The CLI resolves the `auth` resource through the shared permit-boundary helper, calls `adapter.authenticate({ surface: 'cli', bearerToken, requestId })`, and projects the resolved `Permit` into `ExecuteTrailOptions.permit` (added in TRL-408) so it reaches `ctx.permit`. Failures: missing adapter → `ValidationError` (exit 1); adapter returns `Err(AuthError)` or `Ok(null)` → `AuthError` (category `'auth'`, exit 9, with the adapter's code preserved on `error.context.code`). `--token` and `--permit` are mutually exclusive — supplying both yields `ValidationError`.
- [`2e05e27`](https://github.com/outfitter-dev/trails/commit/2e05e27c09eb2e9addecd3c526c5df75b4c2f1ef): Add `--dev-permit` for local-development synthetic full-access. New `devPermitPreset()` exposes a boolean flag; when set, the CLI synthesizes a `BasePermit` (`id: 'dev-permit'`, scopes enumerated from every declared scope across the topo) and overlays it on `ctx.permit`. Mutually exclusive with `--permit` and `--token` — any combination fails with `ValidationError` listing the conflicting flags. New Warden rule `no-dev-permit-in-source` flags any committed source file containing `--dev-permit` as an error, with a tight allow-list (`packages/cli/src/flags.ts`, `packages/cli/src/build.ts`, the rule itself). The Warden runner still scans test TypeScript files for this literal while keeping unrelated source rules filtered out of tests. Apps that import `authResource`/`authLayer` are unaffected.
- [`c8caa5e`](https://github.com/outfitter-dev/trails/commit/c8caa5ed7b08e2407a37296651a5c6c6e67c4ec8): Wire the `--trace` flag for the `trails run` family. Adds `tracePreset()` to `@ontrails/cli` (registered via the `presets` option) and threads `'trace'` through `META_FLAG_CANDIDATES` so the flag is treated as CLI metadata (never routed into trail input). On activation, `apps/trails/src/cli.ts` installs a per-invocation memory sink before `surface()` runs and finalizes it in a `finally` block: the post-execution tree (rendered via `renderTraceTree` from TRL-411) goes to stderr; the result still goes to stdout. With `--trace --json`, regular `trails run <id>` emits a single JSON envelope on stdout that includes `tracing: TraceRecord[]`; `trails run example <id> <exampleName>` keeps its comparison envelope, and `trails run examples <id>` remains a metadata read. `--quiet` keeps the tree on stderr and the unwrapped value on stdout, while `--jsonl` streams items as before. Sink registration is per-invocation so concurrent runs don't bleed records.
- [`f4b90c9`](https://github.com/outfitter-dev/trails/commit/f4b90c90524c33a774b97d93dd25819d2ef82ccc): Add `--watch` for the `trails run` family. File-system events are cheap wake-ups; the rerun gate compares the resolved trail's surface-map entry hash so edits only rerun when the public contract for the watched trail changes. New `watchPreset()` exposes the boolean flag; `'watch'` is added to `META_FLAG_CANDIDATES` so the flag never routes into trail input. The watch loop in `apps/trails/src/run-watch.ts` runs once, then sets up a debounced (`100ms`) `node:fs.watch` filtered to `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` extensions in the trail's source directory. SIGINT closes the watcher cleanly. A short startup warmup window (`150ms`) suppresses the macOS FSEvents replay event that would otherwise produce a phantom rerun on first invocation.
- [`4e75129`](https://github.com/outfitter-dev/trails/commit/4e7512969cb32060a9c2317bb69de51158250987): Absorb `autoIterateLayer` behavior into CLI surface derivation. Trails whose output schema matches the paginated shape (`{ items, hasMore, nextCursor }`) now auto-emit a `--all` flag on the CLI command. When `--all` is set, the executor iterates pages with the trail's cursor field until `hasMore: false` and aggregates `items[]` across pages. With `--jsonl --all`, items stream one per line as they arrive (no in-memory aggregation). If a page reports `hasMore: true` without a non-empty `nextCursor`, `--all` now fails with `ValidationError` instead of silently truncating results. Detection lives in `packages/cli/src/pagination.ts`. The legacy `autoIterateLayer` export is **kept** through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
- [`47505fe`](https://github.com/outfitter-dev/trails/commit/47505fe9b790ab540dd8cdbe230bbb998b63eba5): Absorb `dateShortcutsLayer` behavior into CLI surface derivation. Trails with date input fields (`z.iso.datetime()`, `z.iso.date()`, `z.string().datetime()`, `z.date()`, plus optional/default wrappers) now auto-accept shortcuts on the CLI: `today`, `yesterday`, `Nd` (N days ago), `this-week` (start-of-week Monday UTC), `this-month` (first-of-this-month UTC). Shortcuts expand to UTC ISO before Zod validation. Plain ISO strings pass through unchanged. Digit-led typos like `7day`/`3w` surface a `ValidationError`. Detection lives in `packages/cli/src/date-shortcuts.ts`. The legacy `dateShortcutsLayer` export is kept through Phase 2–7 for back-compat; removal lands in TRL-475 (Phase 8).
- [`863d473`](https://github.com/outfitter-dev/trails/commit/863d4739982eb744e2f5c0419045bf8ed0df25a5): Add three attachment scopes for typed layers — trail, surface, topo — with composition order **topo → surface → trail → blaze**. `TrailSpec` and `Trail` gain `layers?: readonly Layer[]` (default `[]`). `topo()` accepts `{ layers: [...] }` as the third options argument; the topo carries those layers and they reach the executor via `ExecuteTrailOptions.topoLayers`. The CLI's `surface()`/`createProgram()`/`deriveCliCommands` already supports a `layers` option; that now flows through `runTrailOnce` as `surfaceLayers`. The executor builds the layer chain `[...topoLayers, ...surfaceLayers, ...trail.layers, ...options.layers]` so topo wraps surface wraps trail wraps blaze (verified by composition-order tests at every level). Survey's `TrailDetailReport` adds `composedLayers: { topo, surface, trail }` so agents can introspect the layer chain per trail. Backward-compatible: every new field is optional with a non-undefined default; existing call sites are unchanged.
- [`344f2f7`](https://github.com/outfitter-dev/trails/commit/344f2f75c75f83239bd1257371235a93bfcf0597): Project typed-layer `input` schemas onto CLI flags. Each effective layer (topo + surface + trail composition order) with a non-undefined `input` schema gets its fields auto-derived into `--flag` options on every command it attaches to. Parsed values route to the layer at runtime via `ctx.extensions[LAYER_INPUTS_KEY][layer.name]` — `Layer.wrap` is unchanged. Collision rule: if a layer field name collides with a trail input field, another layer's projected name, or a CLI meta flag, the layer's flag is renamed to `--<layer-name>-<original-flag-name>` and a one-line warning emits to stderr (`[trails] ...`). Renames are deterministic across builds. New `LAYER_INPUTS_KEY` (exported from `@ontrails/core`) reserves the `ctx.extensions` slot.
- [`26f9ffd`](https://github.com/outfitter-dev/trails/commit/26f9ffd7f168fc3c45a1a57d5315902f41963a2e): Project typed-layer `input` schemas onto MCP and HTTP surfaces. Closes Phase 7. Lifts `collectAttachedTypedLayers` and `projectLayerFieldName` (collision-rename rule) into `@ontrails/core/internal/layer-projection` so all three surfaces share one source of truth. The CLI surface refactors to consume the lifted helpers (no behavior change). MCP merges layer fields into each tool's `inputSchema` and partitions inbound args at invocation time. HTTP merges layer fields into the route's request schema (query for reads, body for writes) and exposes new optional `HttpRouteDefinition.inputSchema` + `layerInputProjections` for surface adapters / OpenAPI generators. Collision rule matches TRL-473's: deterministic rename to a layer-prefixed camelCase name with the original captured in the routing table. Side fix: MCP and HTTP handlers now forward `topoLayers: graph.layers` + `surfaceLayers: layers` so topo-scope layers actually compose at runtime (previously the handlers used the deprecated `layers` alias and never read `graph.layers`).
- [`66056ac`](https://github.com/outfitter-dev/trails/commit/66056ac3325e513519bc788e4bf27ccba202ddb0): **BREAKING:** TRL-475 drops user-facing exports of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`. Breaking change for any app still wiring these layers manually.

  Migration:

  - **`autoIterateLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now derives the `--all` flag and multi-page collection automatically from any trail whose output matches the pagination pattern (`items`, `hasMore`, `nextCursor`). See TRL-469.
  - **`dateShortcutsLayer`** — remove from `blaze`/`run`/`surface` options. The CLI surface now expands `since`/`until` shortcut strings (`today`, `yesterday`, `7d`, `30d`, `this-week`, `this-month`) automatically from input schema shape. See TRL-470.
  - **`authLayer`** — remove from `blaze`/`run`/`surface` options. Permit scope enforcement is intrinsic to `executeTrail` (`enforcePermitRequirement` runs before resource creation and layer composition). The compatibility shim was already a no-op.

  The `Layer` type, `composeLayers`, and canonical per-call `executeTrail({ layers })` option remain available; only the legacy layer exports were removed.

- [`fde5516`](https://github.com/outfitter-dev/trails/commit/fde5516ad396faa718936b10ff658b3ade3383b9): Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `trailhead(app)` → `surface(app)`
  - Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
  - Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
  - Package taxonomy: retired connector vocabulary in favor of adapters

### Patch Changes

- [`73622ae`](https://github.com/outfitter-dev/trails/commit/73622aec93125756d589af3e056d252bdb91169e): Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT adapter from typed config while preserving existing mock and override paths.
- [`e41c382`](https://github.com/outfitter-dev/trails/commit/e41c3829c2d692683b78c730e67fd5b17ac0ff4e): Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- [`da6e2ca`](https://github.com/outfitter-dev/trails/commit/da6e2caeb06f150042148f10f03a6a9dae5648d1): Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused surface-map type plus legacy `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept files from the published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- [`6944147`](https://github.com/outfitter-dev/trails/commit/694414712949a1107235684a2492ac982ed39a20): Complete trifecta for config, permits, and tracker (formerly tracks)

  - **config**: Add `configResource`, `config.trail`, and `config.workspace` trails with full `defineConfig`, `resolve`, `describe`, `explain`, `doctor`, and code generation support
  - **permits**: Add `authResource` and `auth.verify` trail for runtime authorization checks
  - **tracing**: Rename tracks to tracing; add `tracingResource` and `tracing.status` trail for structured signal tracking
  - **cli**: Fix build flag handling and improve bootstrap scaffolding
  - **testing**: Expand test context helpers and example-based testing utilities
  - **core/mcp/http**: Internal alignment for resource and composition updates

- [`a2f1825`](https://github.com/outfitter-dev/trails/commit/a2f1825bd36f4fb0008e812a5a34345ac046ccf6): Add `@example` coverage in CLI public API docs for flag and preset helpers so API docs tooling can verify public examples for missing exports.
- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`a2f1825`](https://github.com/outfitter-dev/trails/commit/a2f1825bd36f4fb0008e812a5a34345ac046ccf6): Add public API examples for CLI result, prompt, and validation helpers.
- [`454e935`](https://github.com/outfitter-dev/trails/commit/454e935088782a181df89a205c0ff6f2eb936434): Define bounded multiselect argv normalization in the framework CLI model and apply it automatically in the Commander adapter, accepting both contiguous and repeated forms while preserving child routes after the first explicit value.
- [`6300f70`](https://github.com/outfitter-dev/trails/commit/6300f709bb6dffc0e6cc82479fe8d0204c52bbba): Refresh source comments and test labels for retired connector terminology as adapter guardrails become strict.
- [`7065b55`](https://github.com/outfitter-dev/trails/commit/7065b55568dced6df9f8687288842cdbbfd7f6e4): Fix two blocking bugs from real-world migration:

  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)

- [`42a87c1`](https://github.com/outfitter-dev/trails/commit/42a87c1b8691c2fad94ba45175b6eec0219f4594): Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- [`00f7093`](https://github.com/outfitter-dev/trails/commit/00f7093132a50c49b7bc2dcf9eef98f9424fd2e0): Add resources as a first-class primitive.

  Resources make infrastructure dependencies declarative, injectable, and governable. Define a resource with `resource()`, declare it on a trail with `resources: [db]`, and access it with `db.from(ctx)` or `ctx.resource()`.

  **Core:** `resource()` factory, `ResourceSpec<T>`, `ResourceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isResource` guard, `findDuplicateResourceId`, topo resource discovery and validation, `resources` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `resources` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Resource mock propagation through cross graphs.

  **Warden:** `resource-declarations` rule validates `db.from(ctx)` and `ctx.resource()` usage matches declared `resources: [...]`. `resource-exists` rule validates declared resource IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Resource overrides thread through the CLI, MCP, and HTTP surfaces.

  **Introspection:** Survey and surface map outputs include resource graph. Topo exposes `.resources`, `.getResource()`, `.hasResource()`, `.listResources()`, `.resourceIds()`, `.resourceCount`.

  **Docs:** ADR-009 accepted. Unified resource guide, updated vocabulary, getting-started, architecture, and package READMEs.

- [`49c2e7d`](https://github.com/outfitter-dev/trails/commit/49c2e7d5c7c063b9aa6abee1d2932bf3003133cc): Refresh published package README taxonomy to use adapter language instead of retired connector vocabulary.
- [`92e709b`](https://github.com/outfitter-dev/trails/commit/92e709bfaa4593ad46722bc9693adab510cf9ace): Declare explicit permit scopes on mutating built-in CLI trails and scaffolded entity starter trails.

  Preserve the resolved CLI permit on result callbacks so run-collision recovery can re-execute protected trails without losing authorization context.

- [`f1e6efa`](https://github.com/outfitter-dev/trails/commit/f1e6efa4f383287f0b2196f48185699e7476b18c): Derive enum array inputs as repeatable flags so choice lists do not consume trailing command tokens.
- [`860ef32`](https://github.com/outfitter-dev/trails/commit/860ef32a0925f44a08a5e4ad5e21f2b9f44bfa42): Re-export the canonical `AnyTrail` type from `@ontrails/core`.
- [`945cb4b`](https://github.com/outfitter-dev/trails/commit/945cb4b0bef40ddb098c2a3816f9adad6f135410): Honor explicit structured input values over CLI flag defaults when commands merge
  `--input-json` or `--input` payloads.

  Commander now forwards user-supplied flag metadata so explicit flag values that
  match a default still keep normal CLI precedence over structured input.

- [`84f56a5`](https://github.com/outfitter-dev/trails/commit/84f56a5b97e9fed3d673e87da8eebdd916390449): Project live trail-version metadata on CLI, HTTP, and MCP surfaces and thread explicit surface version selection into shared trail execution.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.
- [`4030698`](https://github.com/outfitter-dev/trails/commit/40306984467625844564f0f84156530d7118a79c): Keep structured input on nested child commands from being reinterpreted as a
  bare child-name positional fallback, while preserving schema-authored
  `inputJson` flags as ordinary trail input, including through the public Trails
  CLI. Optional numeric flags now consume negative values with Commander's own
  parsing semantics, and variadic flags consume every following value, before
  nested command routing is resolved.
- [`93757ba`](https://github.com/outfitter-dev/trails/commit/93757ba102ae7ba8d9a7a6c17f119cda47d342a7): Expose ordered Regrade lifecycle phases and wall-clock timings across CLI and
  MCP completion results, with concise human CLI progress isolated on stderr.
  Keep topo-scoped JSON and JSONL environment selectors effective when the
  operator does not explicitly choose an output mode.
- [`0bad534`](https://github.com/outfitter-dev/trails/commit/0bad5341f16398fd81eb3df47813d97544b05d2c): Reject ambiguous CLI value-alias conflicts when non-Commander callers provide a
  defaulted canonical flag value without caller-supplied key tracking.
- [`5d88104`](https://github.com/outfitter-dev/trails/commit/5d88104c6c269e2ef1e92ba3b9e09a410df10c7b): Polish Trails blaze terminology across package docs and Warden guidance.
- [`9bcf34e`](https://github.com/outfitter-dev/trails/commit/9bcf34e53e0c7a40f4ebb78be7f47ac22421ff25): Add trail-owned CLI command projection metadata and serialize resolved command
  route facts for downstream tools.
- [`f7d97fc`](https://github.com/outfitter-dev/trails/commit/f7d97fca59e56ff09d991752526fd928bc16f8f6): Expose resolved CLI command routes through schema helpers, the Trails operator
  schema command, and Wayfinder trail contract output.
- [`61497c5`](https://github.com/outfitter-dev/trails/commit/61497c54deaaae2d067af88d0be6db0a5acb5faf): Add v1-minimum public API examples for shipped surface entrypoints.

## 1.0.0-beta.50

## 1.0.0-beta.49

## 1.0.0-beta.48

## 1.0.0-beta.47

## 1.0.0-beta.46

### Patch Changes

- [`93757ba`](https://github.com/outfitter-dev/trails/commit/93757ba102ae7ba8d9a7a6c17f119cda47d342a7): Expose ordered Regrade lifecycle phases and wall-clock timings across CLI and
  MCP completion results, with concise human CLI progress isolated on stderr.
  Keep topo-scoped JSON and JSONL environment selectors effective when the
  operator does not explicitly choose an output mode.

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

## 1.0.0-beta.42

### Patch Changes

- [`454e935`](https://github.com/outfitter-dev/trails/commit/454e935088782a181df89a205c0ff6f2eb936434): Define bounded multiselect argv normalization in the framework CLI model and apply it automatically in the Commander adapter, accepting both contiguous and repeated forms while preserving child routes after the first explicit value.

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.

### Patch Changes

- [`4030698`](https://github.com/outfitter-dev/trails/commit/40306984467625844564f0f84156530d7118a79c): Keep structured input on nested child commands from being reinterpreted as a
  bare child-name positional fallback, while preserving schema-authored
  `inputJson` flags as ordinary trail input, including through the public Trails
  CLI. Optional numeric flags now consume negative values with Commander's own
  parsing semantics, and variadic flags consume every following value, before
  nested command routing is resolved.

## 1.0.0-beta.39

### Patch Changes

- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

### Patch Changes

- [`945cb4b`](https://github.com/outfitter-dev/trails/commit/945cb4b0bef40ddb098c2a3816f9adad6f135410): Honor explicit structured input values over CLI flag defaults when commands merge
  `--input-json` or `--input` payloads.

  Commander now forwards user-supplied flag metadata so explicit flag values that
  match a default still keep normal CLI precedence over structured input.

## 1.0.0-beta.32

### Patch Changes

- 860ef32: Re-export the canonical `AnyTrail` type from `@ontrails/core`.
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

- Updated dependencies [1307568]
- Updated dependencies [371d19e]
  - @ontrails/core@1.0.0-beta.26

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
