# @ontrails/warden

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

- [`4fb20a6`](https://github.com/outfitter-dev/trails/commit/4fb20a68e1ed98972d99fed8b2df96bfa6804bd3): Derive deterministic, provenance-bearing vocabulary plan proposals from a minimal `from`/`to` seed, including morphology, public and compound identifier review, filename and reference-closure candidates, namespace census, and validated live-topo API preserves. Classified governed transitions retain their registry identity while routing every governed form to review instead of inventing a single safe successor.
- [`8fde0a6`](https://github.com/outfitter-dev/trails/commit/8fde0a6c66a7f64f0c27909df7db2731fa4b10f4): Add an advisory project-static rule that reports unknown governed vocabulary permutations from the latest committed Regrade history until they are classified.
- [`e991a5b`](https://github.com/outfitter-dev/trails/commit/e991a5b2e8b9057d8e33a067e29fb0aca641d5ad): Add generic enum value aliases for CLI flags and migrate Warden command aliases onto the shared alias model.
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

- [`d3215b0`](https://github.com/outfitter-dev/trails/commit/d3215b0966f13af2a72ece9adbcc2c68c70f81b6): Add governed file renames to vocabulary Regrade plans, with move-first derived reference closure and persisted policy-aware evidence across CLI and MCP.
- [`5a7d22a`](https://github.com/outfitter-dev/trails/commit/5a7d22ab9d674f86b28758f23c3e94a17efb5be1): Add three-tier vocabulary migration scope. Protected historical paths remain
  scanned and counted as `historical-by-policy` without being rewritten, while
  reports expose scope-tier totals and census-expected teaching-surface coverage
  through equivalent CLI and MCP plan schemas. Applied vocabulary occurrences
  remain auditable in history with an `applied` verdict, while policy-only
  evidence does not make an active plan stale merely by being recorded.
- [`00f7093`](https://github.com/outfitter-dev/trails/commit/00f7093132a50c49b7bc2dcf9eef98f9424fd2e0): Add resources as a first-class primitive.

  Resources make infrastructure dependencies declarative, injectable, and governable. Define a resource with `resource()`, declare it on a trail with `resources: [db]`, and access it with `db.from(ctx)` or `ctx.resource()`.

  **Core:** `resource()` factory, `ResourceSpec<T>`, `ResourceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isResource` guard, `findDuplicateResourceId`, topo resource discovery and validation, `resources` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `resources` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Resource mock propagation through cross graphs.

  **Warden:** `resource-declarations` rule validates `db.from(ctx)` and `ctx.resource()` usage matches declared `resources: [...]`. `resource-exists` rule validates declared resource IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Surfaces:** Resource overrides thread through the CLI, MCP, and HTTP surfaces.

  **Introspection:** Survey and surface map outputs include resource graph. Topo exposes `.resources`, `.getResource()`, `.hasResource()`, `.listResources()`, `.resourceIds()`, `.resourceCount`.

  **Docs:** ADR-009 accepted. Unified resource guide, updated vocabulary, getting-started, architecture, and package READMEs.

- [`120caf5`](https://github.com/outfitter-dev/trails/commit/120caf57e6b6da4e01e53a1bff3a629cadf48d6e): Promote topo artifact commands to `trails compile` and `trails validate`.
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

- [`5adb995`](https://github.com/outfitter-dev/trails/commit/5adb99551c2dda6190d46cce7f60bb08d63c99aa): Complete the v1 hard cutover from the authored `blaze` field to
  `implementation` across trail contracts, surface projections, tests, examples,
  and public source-analysis helpers. Existing applications must rename authored
  trail behavior fields and direct trail-object access before upgrading.
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
- [`aedb87b`](https://github.com/outfitter-dev/trails/commit/aedb87b3b536c5849636c7a5951c51e1e7f0d1cc): Add governed identifier-segment renames for AST-backed migrations. Regrade can
  now migrate camelCase, PascalCase, leading-underscore, and SCREAMING_SNAKE
  identifier segments, including single-segment forms such as `BLAZE` and
  `_BLAZE`, while preserving exact-mode behavior and rejecting lowercase
  substring, concatenated acronym, or inflection matches.
- [`fb0ba0a`](https://github.com/outfitter-dev/trails/commit/fb0ba0ab706bbdce470123e9a6fb2ef9f1822806): Convert the eight committed governed Regrade histories to canonical v3 receipts and remove the temporary schema-v2 compatibility path after migration.
- [`9a8b6e4`](https://github.com/outfitter-dev/trails/commit/9a8b6e4af394c76c11e6d0007e0f5f94d0be2cb3): Persist Regrade lifecycle runs as canonical v3 receipts with exact Git blob evidence and authored field provenance, and validate their compact classified-form projection independently in Warden.
- [`2e05e27`](https://github.com/outfitter-dev/trails/commit/2e05e27c09eb2e9addecd3c526c5df75b4c2f1ef): Add `--dev-permit` for local-development synthetic full-access. New `devPermitPreset()` exposes a boolean flag; when set, the CLI synthesizes a `BasePermit` (`id: 'dev-permit'`, scopes enumerated from every declared scope across the topo) and overlays it on `ctx.permit`. Mutually exclusive with `--permit` and `--token` — any combination fails with `ValidationError` listing the conflicting flags. New Warden rule `no-dev-permit-in-source` flags any committed source file containing `--dev-permit` as an error, with a tight allow-list (`packages/cli/src/flags.ts`, `packages/cli/src/build.ts`, the rule itself). The Warden runner still scans test TypeScript files for this literal while keeping unrelated source rules filtered out of tests. Apps that import `authResource`/`authLayer` are unaffected.
- [`ad553a6`](https://github.com/outfitter-dev/trails/commit/ad553a60173233be1a0a566840e6eac3463e0ec8): Add one warden rule coaching against the removed legacy layer API. `no-legacy-layer-imports` (error) flags any source-string reference to `authLayer`, `autoIterateLayer`, or `dateShortcutsLayer` and points the developer at the migration paths (CLI surface derivation for pagination/date-shortcuts; intrinsic permit enforcement for auth). Allow-list covers the migration notes in `packages/cli/src/{pagination,date-shortcuts}.ts` and the rule's own files. The rule is classified `lifecycle: temporary` with a `retireWhen` string tying it to the legacy layer migration window. Trail count bumps 45 → 46.
- [`802fdfc`](https://github.com/outfitter-dev/trails/commit/802fdfc0360800404c83f2255c6ac7c6f67fee45): Rename Warden guide manifest rule grouping from `category` to `concern` so the
  public JSON contract matches the source metadata field.
- [`1c975c3`](https://github.com/outfitter-dev/trails/commit/1c975c3e969d1aa999c6c2474ce72ecfb52e7c65): Define the Warden fix-metadata contract (`WardenFix`, `WardenFixCapability`, `WardenFixClass`, `WardenFixSafety`, `WardenFixEdit`) with optional `fix` metadata on diagnostics and rule metadata, projected through the guide, manifest, markdown, and agent guidance. Export `wardenFixClasses`/`wardenFixSafeties` value arrays and surface the rule `fix` capability in the `warden.guide` trail output schema. Dormant until a rule declares it.
- [`d5d518e`](https://github.com/outfitter-dev/trails/commit/d5d518e165f106b408b00187e9165359bedf5db3): Add `warden --fix` to apply safe source fixes. The executor applies only `safety: 'safe'` edits last-to-first, re-reading and rewriting affected files, while review-required, edit-less, and topo diagnostics stay reported but unapplied. The report surfaces applied, changed-file, and skipped counts.

  Expose `fix` through the Trails app wrapper and mark the `warden` trail as write intent with explicit public access because `fix: true` mutates source files while the local governance command remains directly runnable.

- [`8bc0708`](https://github.com/outfitter-dev/trails/commit/8bc07086bbfad54f6563996b80e7e4148beb36dd): Add surface facet coherence diagnostics for selector overlap, visibility widening acknowledgements, dynamic selectors, and description hygiene.
- [`88e2ac7`](https://github.com/outfitter-dev/trails/commit/88e2ac7d831ca15aefbad4763886386523581dcf): Type utilities and cross-declarations warden rule.

  **core**: Add `TrailInput<T>`, `TrailOutput<T>` utility types and `inputOf()`, `outputOf()` runtime schema accessors.

  **warden**: Add `cross-declarations` rule — statically analyzes `ctx.cross()` calls against declared `crosses: [...]` arrays. Errors on undeclared calls, warns on unused declarations.

- [`22c6c06`](https://github.com/outfitter-dev/trails/commit/22c6c06a3b846dab64b78b7ccc27cb1ebd22e402): Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.
- [`fde5516`](https://github.com/outfitter-dev/trails/commit/fde5516ad396faa718936b10ff658b3ade3383b9): Trail-native vocabulary cutover. Breaking API field renames across all packages:

  - Trail spec: `run:` → `blaze:`, `follow:` → `crosses:`, `services:` → `resources:`, `metadata:` → `meta:`, `emits:` → `fires:`
  - Runtime: `ctx.follow()` → `ctx.cross()`, `ctx.emit()` → `ctx.fire()`, `ctx.signal` (abort) → `ctx.abortSignal`
  - Entry points: `trailhead(app)` → `surface(app)`
  - Package rename: `@ontrails/crumbs` / `@ontrails/tracker` → `@ontrails/tracing`
  - Wrapper types: retired gate/middleware vocabulary in favor of `Layer` and `layers`
  - Package taxonomy: retired connector vocabulary in favor of adapters

- [`767eb41`](https://github.com/outfitter-dev/trails/commit/767eb41008d73133363cdb330f297090e8aa2837): Ship the default `warden` bin from `@ontrails/warden` and migrate the old private `apps/ci` runner into the package-local CLI surface.

  The new bin supports `--ci`, `--pre-push`, `--depth`, `--fail-on`, `--strict`, `--format`, `--lock`, `--drafts`, `--apps`, and the Sprint 1 standalone aliases. CI output now uses the package Warden formatters directly, so GitHub annotations and JSON payloads follow the `@ontrails/warden` report shape instead of the retired `apps/ci` wrapper shape.

- [`82019a7`](https://github.com/outfitter-dev/trails/commit/82019a7d44736d18c8f1e9db4d81fe9025653b1d): Export `wardenConfigSchema` for composing Warden options into `trails.config.ts`.
- [`f6fdc62`](https://github.com/outfitter-dev/trails/commit/f6fdc62de1088f35a5615760261e11411a22a690): Add structured Warden remediation guidance to rule metadata, diagnostics, report output, and the `trails warden` result schema.
- [`a10ffa4`](https://github.com/outfitter-dev/trails/commit/a10ffa4efe655e0a6e800b362f8e7e3f5373e136): Add a Warden guide manifest projection and expose it through `trails warden guide` in markdown, agent-json, and manifest formats.
- [`5be032c`](https://github.com/outfitter-dev/trails/commit/5be032c48779f7b7dc9bbc28ab7a22cbfabc83f0): Add the repo-local `public-export-example-coverage` Warden rule (and its `publicExportExampleCoverageTrail` wrapper), graduating `scripts/check-public-api-examples.ts` into governed rule coverage. The rule anchors to this repository's five public surface package barrels via the rule module's own on-disk location, so it stays silent in consumer repositories.
- [`7085f01`](https://github.com/outfitter-dev/trails/commit/7085f01d6487c62f8f80535cdf77f0d542b55927): Add a Warden topo-aware rule that requires public MCP/HTTP surface-eligible trails to declare output schemas.
- [`8ddf5ff`](https://github.com/outfitter-dev/trails/commit/8ddf5ff71a3955a540b450f9312b8caf58fa735f): Extend `runWarden` into the shared Warden orchestration entrypoint with effective config resolution, depth/fail thresholds, rule facets, and multi-topo report metadata.

  Adapt the built-in `trails warden` wrapper to consume the readonly Warden report diagnostics contract without weakening its output schema.

- [`f5b6112`](https://github.com/outfitter-dev/trails/commit/f5b6112a7f88e76f72b2d82e863f11d0c89b518b): Add an advisory Warden rule that prefers static resource helpers over dynamic context resource lookups when the resource definition is already in scope.
- [`bd1bd96`](https://github.com/outfitter-dev/trails/commit/bd1bd96b90cd8b55f73061e4078a14cd75bed745): Require committed Regrade provenance for governed vocabulary transitions.

  Applied governed plans now expose deterministic transition, plan, source,
  safe-apply, and review-follow-up evidence through history results. Warden loads
  committed history into project context, cites it for reintroduced symbols, and
  rejects invalid or missing provenance for transitions that require Regrade in
  the workspace that owns the governed registry, without making downstream apps
  prove the framework's own migrations.
  Portable validation accepts the authoritative numeric file-rename counters
  persisted by Regrade history.

- [`082408e`](https://github.com/outfitter-dev/trails/commit/082408e32c16fd737d8899fc8c8a51fa0f61b3d9): Warn when a configured workspace contains a nested `trails.lock` outside `workspace.apps`, and reject a workspace-root aggregate lock without deriving app identity from either artifact.

  Make the Trails operator topo reproducible by keeping its authored examples free of temporary filesystem paths, so its committed app-owned lock validates deterministically.

  Replay known operator current-app examples through the selected Config entry, including the nested project input in the authored `run` example, so custom app layouts do not fall back to `src/app.ts` without rewriting matching fields in domain examples.

  Add `trails config explain` as the operator-owned inspection surface for source-static project and app identity. It reports the Config-authored catalog, selected extent, and selection provenance without loading app modules or reading locks.

  **BREAKING:** Remove the public `@ontrails/config` `configExplain` trail export. Library consumers that inspect resolved deployment provenance must migrate to `deriveConfigProvenance`; operators and agents that inspect Config-authored app identity must migrate to `trails config explain`. The broader config cascade stays deferred.

### Patch Changes

- [`da6e2ca`](https://github.com/outfitter-dev/trails/commit/da6e2caeb06f150042148f10f03a6a9dae5648d1): Cleanup and hardening pass across all packages.

  **core**: Deduplicate `DispatchOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused surface-map type plus legacy `connectors.ts`, `health.ts`, and `job.ts` proof-of-concept files from the published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `surface()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- [`ea2f296`](https://github.com/outfitter-dev/trails/commit/ea2f296e8119cf79bd03aeca3f0aa804f2fbcdd6): Classify adjacent package-route variants in the authored Warden AST regression
  fixtures as explicit preserves so the completed transition remains auditable.
- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`9874e0b`](https://github.com/outfitter-dev/trails/commit/9874e0bb034c0f98edeb19833d9d3519c2a07a4c): Add `@ontrails/cloudflare/d1`, an env-bound Cloudflare D1 store resource for `@ontrails/store` definitions. The new subpath exports `cloudflareD1` and `connectD1`, supports the backend-agnostic store accessor contract (`get`, `list`, `upsert`, `remove`), versioned-table optimistic concurrency, fixture/mock seeding, store-derived write signals, Miniflare-backed conformance tests, and Worker env-bridge integration.

  `@ontrails/core` and `@ontrails/store` no longer require the Bun global for signal fire ids or late-bound store signal tokens, so store definitions and store-derived signal emission work inside Worker modules. `@ontrails/warden` now treats `cloudflareD1` as a required Cloudflare public export with `@example` coverage.

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

- [`4086b5b`](https://github.com/outfitter-dev/trails/commit/4086b5b2f01b24660924fd8b667523f38caaed29): Add `@ontrails/cloudflare/r2`, an env-bound Cloudflare R2 bucket resource with
  `cloudflareR2`, `createMemoryR2`, and `r2ObjectToBlobRef`. The resource
  materializes Worker `r2_buckets` bindings through the shared env bridge, records
  Cloudflare lock overlay facts, carries an in-memory object mock for
  configuration-free tests, and documents the supported object operations plus
  streaming/metadata boundaries.

  `@ontrails/warden` now treats `cloudflareR2` as a required Cloudflare public
  export with `@example` coverage.

- [`a105127`](https://github.com/outfitter-dev/trails/commit/a105127e5662ed9a6c245125f791fb0182da3f5e): Add the `@ontrails/cloudflare` adapter collection with its first two service subpaths. `@ontrails/cloudflare/workers` exports `createWorkersHandler`, a materializer producing the `{ fetch(request, env, ctx) }` Worker export on the shared HTTP fetch kernel, with an env bridge that re-resolves env-bound resources whenever a new Worker `env` arrives so no resource instance serves a request with a stale env. `@ontrails/cloudflare/kv` exports `cloudflareKv`, a resource definition wrapping a KV namespace binding (`get`/`put`/`delete`/`list` with TTL options) plus an in-memory `createMemoryKv` mock so `testAll` runs configuration-free.

  `@ontrails/core` now guards the default trail context fields: `requestId` falls back to `crypto.randomUUID()` when the `Bun` global is absent, and `cwd`/`env` fall back to `'/'`/`{}` when `process` is absent, so trail execution works on runtimes like Cloudflare Workers.

  `@ontrails/warden` registers the `@ontrails/cloudflare` public barrel in the repo-local `public-export-example-coverage` policy, requiring `@example` TSDoc coverage on `createWorkersHandler` and `cloudflareKv`.

- [`26be41d`](https://github.com/outfitter-dev/trails/commit/26be41d229ab688d3bf315b53cb7ebf2456b63db): Fix Codex review findings on type-utils and cross-declarations.

  **core**: `inputOf()`/`outputOf()` now preserve the exact Zod schema subtype instead of widening to `z.ZodType`.

  **warden**: `cross-declarations` rule now recognizes single-object trail overload, detects any context parameter name (not just `ctx`), matches destructured `cross()` calls, resolves const identifiers in `crosses` arrays, and restricts blaze body extraction to top-level config properties.

- [`f8d80b9`](https://github.com/outfitter-dev/trails/commit/f8d80b9cd823f02b2aa854934702f598bceff07d): Refresh current-facing compose vocabulary in package documentation after the composition cutover.
- [`3e5c0fc`](https://github.com/outfitter-dev/trails/commit/3e5c0fc1f2db8fae130782d167cd6b7bb141f4e5): Export shared diagnostic base types from core and align governance diagnostic
  severity vocabulary across adapter checks, permits, and Warden.
- [`f3c4fef`](https://github.com/outfitter-dev/trails/commit/f3c4fef87617461a20b641d60f359dab3c625ca8): Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
- [`c3fc5c3`](https://github.com/outfitter-dev/trails/commit/c3fc5c3b89a3128631ee6045af6673d9108bbfd9): Move previously root-exported helper contracts out of `src/internal/*` to stable core module homes, document their public boundary, and guard the public barrel against future internal re-exports.
- [`cb0a9d8`](https://github.com/outfitter-dev/trails/commit/cb0a9d8fe294494fb3e026d1f066ab5281b3557c): Export shared workspace package discovery helpers from core and migrate first-party discovery callers.
- [`bafde1f`](https://github.com/outfitter-dev/trails/commit/bafde1fc8172abb8d8617f69a3c7a70667626d10): Fresh derivations now collect app-module overlays through the shared channel compile uses. `@ontrails/adapter-kit` exports `resolveTrailsOverlays()`, the one reader of an app module's `trailsOverlays` export; the compile-path fresh app lease and Warden's fresh topo loading both go through it, making per-namespace drift asymmetry structurally impossible. Warden drift checks (`checkDrift` now accepts derive options carrying overlays) and the topo-aware rule context graph derive with the same overlays the committed lock embeds, so rules like `surface-overlay-coherence` fire on standard runs. Stale drift results name the drifted overlay namespaces (`DriftResult.driftedOverlayNamespaces`) and point at `trails compile` as the remediation.
- [`b077fb7`](https://github.com/outfitter-dev/trails/commit/b077fb7ba6d9724cac6f0e59bc3fec9aec28984c): Add the export-restructure Regrade class family (TRL-1210). `export-restructure:cli-aliases` inverts legacy `cliAliases`/`trailsCliAliases` exports into `surfaceOverlay({ cli })` bindings inside the module's `trailsOverlays` export — adding the `@ontrails/core` import, deleting the legacy export, and routing anything it cannot prove safe (computed keys, spreads, in-module `aliases:` references) to `needs-review` with the exact target shape named. `export-restructure:mcp-trailheads` projects call-site MCP trailhead maps into `surfaceOverlay({ mcp })` group bindings: it rewrites in place when the same module exports `trailsOverlays`, and otherwise emits a classified `needs-review` handoff naming the module-overlay target while the call-site map stays as the richer-metadata override-in-context. Warden's fix-class union grows to `'export-restructure' | 'term-rewrite'`, `no-legacy-cli-alias-export` now advertises the `export-restructure` class, and `loadWardenRegradeClasses` supersedes `loadWardenTermRewriteClasses` (still exported) as the full Warden-routed class loader. Class-mode Regrade also gains the full plan lifecycle: `trails regrade plan --type class --class-ids ...` writes a `.trails/regrade/<slug>.json` plan carrying class ids, scope, and intent, `regrade check` re-runs the dry run and gates on outstanding rewrites or review, and `regrade apply` applies and graduates the plan to `.trails/regrade/history/<slug>-<hash>.json` — the same plan → check → apply → history evidence trail vocabulary regrades already had, now available to structural transforms. The class family ships for downstream apps bridging the pre-1.0 gap, so pre-cutover alias exports and trailhead maps migrate mechanically instead of by hand.
- [`7065b55`](https://github.com/outfitter-dev/trails/commit/7065b55568dced6df9f8687288842cdbbfd7f6e4): Fix two blocking bugs from real-world migration:

  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)

- [`42a87c1`](https://github.com/outfitter-dev/trails/commit/42a87c1b8691c2fad94ba45175b6eec0219f4594): Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- [`e898cc4`](https://github.com/outfitter-dev/trails/commit/e898cc4042ffa66f977b425a98419ee77183f27d): Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
- [`81373bc`](https://github.com/outfitter-dev/trails/commit/81373bc5e980bb06d56fb06af4f0986f72e318c7): Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

  The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

  Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.

- [`f0f7e2f`](https://github.com/outfitter-dev/trails/commit/f0f7e2f33c0c34d1b0834fa14e86eb24ed8c7035): Avoid draft-marker false positives when a packed Warden install scans the Trails framework source tree from a different package location.
- [`53014a4`](https://github.com/outfitter-dev/trails/commit/53014a4593170edd5adfbaa2c94c895c67a320d1): Exclude immutable Regrade history artifacts from downstream migration source scans while preserving active plan and other policy-classified evidence. Warden continues to validate committed history through its dedicated provenance loader.
- [`3395234`](https://github.com/outfitter-dev/trails/commit/33952349f2d475b170376a63587c89e50be3247a): Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- [`90d394c`](https://github.com/outfitter-dev/trails/commit/90d394c005fdf6b898ba7052d0b56755af0f4954): Derive nested worktree, repository, and submodule collection boundaries in the
  shared Source walker. Regrade and Warden now observe one directly targeted
  working tree per run, and Regrade audit summaries expose boundary skip counts.
- [`ee9f3ae`](https://github.com/outfitter-dev/trails/commit/ee9f3ae0c1f42e371bae6568c00bbdfccb4da677): Let Warden fix capabilities declare downstream scan targets and have Regrade
  honor those targets for Warden-backed term-rewrite classes.

  Dogfood the first safe facet-to-trailhead prose rewrite through project-local
  Warden rules and Regrade.

- [`d40430d`](https://github.com/outfitter-dev/trails/commit/d40430d65f2169178e27147bf120296df67fe418): Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/observe/logtape` for LogTape forwarding.
- [`851a2a3`](https://github.com/outfitter-dev/trails/commit/851a2a3cb805993d16ef74d43d3c963f286cce15): Derive trail caller and blaze input types from the authored input schema while keeping one public input contract.
- [`54d259b`](https://github.com/outfitter-dev/trails/commit/54d259be81fb6c41d85be48a6cb2100c746a7126): Expose parser-native comment spans from `parseWithDiagnostics` so source-aware
  tooling can distinguish exact JavaScript and TypeScript comment trivia without
  reimplementing a lexer.

  Use the shared spans in Warden's public-example rule while keeping leading
  comment ownership fail-closed across JavaScript line terminators.

- [`a9fdbc7`](https://github.com/outfitter-dev/trails/commit/a9fdbc7769be77e1ee63d89a4a25d17b9f29d8ed): Clarify surface accommodation doctrine in MCP surface facet metadata and Warden trail-fork coaching guidance.
- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).
- [`de30d6c`](https://github.com/outfitter-dev/trails/commit/de30d6c358048fba48822ac43b1c2cc04a3d30be): Introduce `topo.compile` as the canonical trail for writing `.trails` lockfile
  and surface artifacts, remove the `survey --generate` mode, and update drift
  guidance to point at the compile command.
- [`331e3a9`](https://github.com/outfitter-dev/trails/commit/331e3a90e2094ca3f10a206e6bbbe379301283b2): Relocate the topo-store public API from `@ontrails/core` to `@ontrails/topographer` per ADR-0042. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

  Breaking pre-1.0 beta change. Update consumer imports:

  ```diff
  - import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
  + import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
  + import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
  ```

  The same root move applies to types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions`. The direct DB helper type `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

  Core newly exports `activationSourceKey`, `projectActivationSourceDeclaration`, `activationSourceDeclarationSignature`, and the `ActivationSourceProjection` type — these were already used internally and are now part of the public surface so `@ontrails/topographer` (the only consumer that needs them) can import them through normal package channels.

- [`4399fdb`](https://github.com/outfitter-dev/trails/commit/4399fdb21782ec877e36fcd76b37fa5f439aaf29): Renamed `@ontrails/schema` to `@ontrails/topographer`. Mechanical rename only — no API changes. Update import sites from `@ontrails/schema` to `@ontrails/topographer`. See ADR-0042 for the durable graph substrate doctrine.
- [`f8fd6ca`](https://github.com/outfitter-dev/trails/commit/f8fd6ca741e521bcfed1954d0949e76fd4e15dc4): Add OXC Walker-backed AST facade helpers for parent-aware traversal, scope-aware traversal, source locations, and safe source edits.
- [`0fcc42b`](https://github.com/outfitter-dev/trails/commit/0fcc42b544945f27d9d1bf3f13e9f5281c1efbed): Add `dead-public-trail` and `duplicate-public-contract` Warden coaching rules so exported public trails stay anchored and duplicate surface contracts become visible drift.
- [`c36aca9`](https://github.com/outfitter-dev/trails/commit/c36aca978c7e1561e68701c084241e5b3f85dcef): Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- [`1307568`](https://github.com/outfitter-dev/trails/commit/13075680e1c77c0a3abee36aaecce8cecad2f347): Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
- [`01b9204`](https://github.com/outfitter-dev/trails/commit/01b92046db52c71f22a871e58a308d7a94483cab): Harden governed v1 vocabulary transitions with property-key-only blaze literal
  rewrites, structured review for ambiguous literal positions, explicit
  scratch/history boundaries, and scan-only preservation for migration plans and
  historical decision evidence.
- [`768cc79`](https://github.com/outfitter-dev/trails/commit/768cc79ca10947b8808b376e281e1a81131b4acc): Close missed projection vocabulary residue in Regrade internals and public
  error-rendering guidance, and keep lifecycle-ambiguous governed identifiers in
  the Warden review inventory instead of assigning them an unsafe automatic
  target.
- [`ef09e46`](https://github.com/outfitter-dev/trails/commit/ef09e4673563fc3b763fef3df510b34d67c45fe1): Add shared Trails project-root discovery helpers and use them in Warden so nested
  cwd invocations still load root `trails.config.*` and project-local
  `.trails/rules*` governance.
- [`6250729`](https://github.com/outfitter-dev/trails/commit/6250729665c6bc2022c92938be93d156bebdf6b1): Expands the public AST guard/accessor surface and migrates Warden/Regrade AST
  consumers onto the typed helpers instead of rule-local node-field casts.
- [`d73c38e`](https://github.com/outfitter-dev/trails/commit/d73c38e47218500d18ca62b641ef889b195fe508): Warn when Warden rules add raw AST node-field casts where a typed accessor exists.
- [`a8e4dc3`](https://github.com/outfitter-dev/trails/commit/a8e4dc35cbc88a419dafa9082b31c51ae735526b): Clean up the Wayfinder navigation grammar before RC, including explicit pattern/query/file selectors, target-bound dependency and impact flags, drift-first provenance fields, stricter fires declaration diagnostics, and updated operator dogfood coverage.
- [`38cd9d6`](https://github.com/outfitter-dev/trails/commit/38cd9d63ad40ae45986f6bdb01109f383b3a19ab): Add a shared Trails config file loader that treats `trails.config.ts` as the natural primary while supporting JSON, JSONC, YAML, and TOML peer formats. Release and Warden config loading now consume the same loader and local overrides can be authored as data files.
- [`f8403c4`](https://github.com/outfitter-dev/trails/commit/f8403c4e3e2aabdef42c455b96c129344be5f590): Collapse normal topo compilation onto one root `trails.lock` envelope that embeds the TopoGraph, hash, and summary while keeping legacy `.trails/trails.lock` plus `.trails/topo.lock` readers for migration compatibility.
- [`ff48e41`](https://github.com/outfitter-dev/trails/commit/ff48e413bf2c3c12fe9596561a7c01499c89e4bf): Harden project-local rule loading: Warden now discovers `.trails/rules.ts` and direct `.trails/rules/*.ts` files only, reports duplicate project-local rule ids, and emits a migration diagnostic for the retired `trails/warden/rules` location.
- [`a0126d9`](https://github.com/outfitter-dev/trails/commit/a0126d901b57648a3415dc71d692c71f78f93bb6): Add Warden `scope.exclude` globs through project config and the Trails CLI
  wrapper so governance runs can exclude local notes, scratch space, and generated
  state without dropping durable skills or plugin assets from scope.
- [`6a26a08`](https://github.com/outfitter-dev/trails/commit/6a26a088480fe0b8ac6988566d2b52d4a73d91f6): Rename Warden governance scope controls from jurisdiction ignore settings to `scope.exclude` across config, CLI, and Trails surfaces.
- [`fe72b84`](https://github.com/outfitter-dev/trails/commit/fe72b84f88f4b18025f3d1b9463ca99238662d99): Fold remaining Regrade and Warden scan-target surfaces onto the shared path-scope vocabulary.
- [`1f5659b`](https://github.com/outfitter-dev/trails/commit/1f5659bfe39568f7bbee0503ace8b6e562d3f899): Add the `duplicate-exported-symbol` Warden rule to warn when multiple first-party packages define the same exported symbol name.
- [`6e63e48`](https://github.com/outfitter-dev/trails/commit/6e63e483617b84cb6868d0c4d58d5b5a8d3b9ed2): Complete the v1 grouped surface-entry vocabulary cutover from facet to trailhead, including Regrade dogfood support for governed string literal renames and composed AST rewrite application.
- [`fc002d5`](https://github.com/outfitter-dev/trails/commit/fc002d5669f4303427e99f45f9998fd0b0172bdb): Add governed AST identifier rename helpers and Warden residue detection for
  active vocabulary symbol transitions.
- [`6ca0d8f`](https://github.com/outfitter-dev/trails/commit/6ca0d8f776801eee71ddd86cb88c198eaf5815fd): Add a typed governed-vocabulary transition registry that Warden owns and Regrade
  can consume for migration planning.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Allow source rules to opt into documentation and text-file scanning so durable repository vocabulary guards cover every declared source kind.
- [`58db715`](https://github.com/outfitter-dev/trails/commit/58db715209442604fe58f5004fec37426c5969b1): `duplicate-public-contract` now includes contour anchoring in the normalized contract fingerprint, so factory CRUD trails derived against different contours (for example two tables' `delete` trails that both normalize to `{ id } → void` with the same intent) are no longer flagged as duplicates. Genuine duplicates — identical facts with the same or no contour anchoring — still warn, and the diagnostic message names contours among the shared facts.
- [`7cd0576`](https://github.com/outfitter-dev/trails/commit/7cd0576db8bc421cfd441c126f884e425e2254af): `signal-graph-coaching` no longer flags store-derived table signals (`created`/`updated`/`removed`) that have no consumers. Store resources advertise those signals as available capability, so leaving them unconsumed is a legitimate steady state for store-backed apps. Non-store produced signals without consumers still warn, and dead-signal coaching (no producer and no consumer) is unchanged.
- [`b9e82a3`](https://github.com/outfitter-dev/trails/commit/b9e82a33546356c93fbc302fb934a83f19f1c2c5): Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.
- [`64fb15a`](https://github.com/outfitter-dev/trails/commit/64fb15acaaa76bd9785b69296e4f433886dfe098): Add Warden rules for trail version lifecycle guidance, version gaps, marker-safe schemas, pinned composes, examples, and pending force audit events.
- [`ce86e06`](https://github.com/outfitter-dev/trails/commit/ce86e06ea1624cb426f50f7333ae9b01c592868e): Treat same-scope inverse operation pairs such as enable/disable, pause/resume,
  star/unstar, and archive/restore as intentional distinct public contracts in
  the `duplicate-public-contract` rule.
- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.
- [`3531b58`](https://github.com/outfitter-dev/trails/commit/3531b58ba5320753d6d2594257ef71bc950d28a1): Add the advisory captured-kernel Warden rule for ownership review when a public
  subpath re-exports package internals and multiple production workspaces consume
  that subpath, including import-then-export barrels that preserve the internal
  binding through a local alias or default export.

  Expose typed import-kind inspection from `@ontrails/source` so project rules
  can keep erased type bindings separate from runtime exports.

- [`35cbe28`](https://github.com/outfitter-dev/trails/commit/35cbe289db46539b3689dbf6cf8ab0e5d9a1b09c): Found `@ontrails/source` as the shared source-code AST kernel for parsing,
  walking, locations, edits, literals, and generic Trails syntax recognition.
  Warden, Regrade, Wayfinder, and the Trails operator now import those shared
  mechanics from `@ontrails/source`; the legacy Warden AST route is removed by the
  stacked hard cutover.
- [`113aed6`](https://github.com/outfitter-dev/trails/commit/113aed62d20041e35b0cf9d6c1b1a18df4b88f57): Rename the dependency-light observability owner from `@ontrails/observe` to
  `@ontrails/observability` as a pre-v1 hard cut. Update dependent packages,
  documentation, package discovery, and the governed Regrade route; no
  compatibility package or old import route is retained.
- [`0938e7b`](https://github.com/outfitter-dev/trails/commit/0938e7badc0c5470d194139d642b673658d099e0): Fold the removed `@ontrails/tracing` package into the truthful existing
  owners: intrinsic trace contracts remain in core, developer-state tooling now
  lives at `@ontrails/observability/dev`, and the dependency-light OTel adapter
  lives at `@ontrails/observability/otel`. There is intentionally no root-package
  compatibility redirect because the former root had more than one owner.
- [`50e2779`](https://github.com/outfitter-dev/trails/commit/50e27796d074851bccd57d7df009db749757b457): Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
  temporary observability subpaths. The new packages own their namesake foreign
  dependencies and preserve Trails record metadata, levels, redaction boundaries,
  and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

  Add governed Regrade transitions for both exact import replacements and expose
  the observability adapter target through the shared adapter readiness check.

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

- [`f1bd093`](https://github.com/outfitter-dev/trails/commit/f1bd09395fcf81db0bcb8657030288877c2e26e6): Recognize conditional, aliased, and parenthesized Result provenance while invalidating provenance after reassignment across the implementation-return and redundant-error-wrap rules.
- [`2b7da24`](https://github.com/outfitter-dev/trails/commit/2b7da245b7d689e056bfd642e3651244c95e7ff4): Split Warden's source-analysis implementation into focused shared mechanics and
  Warden-owned policy modules while preserving the public AST helper contract.
- [`76a9e1d`](https://github.com/outfitter-dev/trails/commit/76a9e1da974de24259f7384947e198e1f6380e44): Remove the legacy Warden AST compatibility export now that shared source-analysis helpers are published from `@ontrails/source`.
- [`a45cead`](https://github.com/outfitter-dev/trails/commit/a45cead6e3ddf6ce606bf5e663b74c0d3b5664b8): Make the planned contour-to-entity Regrade transition code-fact complete for
  apply readiness while leaving the repository cutover status planned.
  Identifiers that already contain the target segment now stay in the review
  inventory instead of producing duplicated target names.
- [`8a1ac00`](https://github.com/outfitter-dev/trails/commit/8a1ac00b5d789be41ca6e464358c96b01e442bf4): Govern the exact `@ontrails/warden/ast` to `@ontrails/source` package route
  transition for Regrade string-literal and module-specifier rewrites exposed
  through the Trails CLI and MCP tools. Safe rewrites now require the owning
  manifest to already declare the target package; otherwise Regrade preserves the
  occurrence with dependency repair guidance. Invalid manifests remain unchanged
  and produce structured repair guidance that names the owning manifest. Explicit
  preserve rules remain no-ops before dependency validation, and dotted or
  subpath-like near routes remain deferred instead of becoming invented imports.
- [`2dd9cda`](https://github.com/outfitter-dev/trails/commit/2dd9cdaac251378bda9e9600653ffc9b9defeaa2): Promote ADR-0043 (Layer Evolution) from draft to accepted, amend it on 2026-05-04 to remove the briefly proposed `Middleware` split, and publish the Layer Evolution Migration Guide at `docs/migration/layer-evolution.md`.

  Documentation-only change capturing the post-implementation state of the layer-evolution work shipped across TRL-471 through TRL-476: typed `Layer` primitive with optional `input` schema, three attachment scopes (trail, surface, topo), CLI/MCP/HTTP surface projection of layer inputs, removal of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`, and warden coaching via `no-legacy-layer-imports` (error). The migration guide is the durable countermeasure to the vocabulary churn flagged in ADR-0043's tradeoffs.

- [`fb10112`](https://github.com/outfitter-dev/trails/commit/fb10112eb3a6f2092871e451a39d1bd1f339c7f8): Polish Warden guidance projection by preserving labels in plain-text doc links
  and reusing the shared diagnostic schema from the Trails CLI wrapper.
- [`bfabe09`](https://github.com/outfitter-dev/trails/commit/bfabe09eda8f61abebfc369193f134c7db009ef1): Suppress static resource accessor warnings when a string lookup resolves to a
  resource variable name shadowed inside `blaze`.
- [`7a1d4a9`](https://github.com/outfitter-dev/trails/commit/7a1d4a904d05b1ccd46af01fdab389cb2ab10a3d): Rename the public resolved graph API from `SurfaceMap` to `TopoGraph`, including
  the derive, hash, diff, and current graph artifact I/O helpers.
- [`84f595a`](https://github.com/outfitter-dev/trails/commit/84f595afe4bc0c8c3d07f99d5d7682676fa119d1): Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
- [`d2cb9ba`](https://github.com/outfitter-dev/trails/commit/d2cb9ba3672cb224b5df7ecf363bbe5e5d77bff4): Rename topo-store export artifacts from surface-era names to TopoGraph names. The `topo_exports` table now stores `topo_graph`, `topo_graph_hash`, and `lock_manifest`, and backend-support export records expose `topoGraphJson`, `topoGraphHash`, and `lockManifestJson`.
- [`2cc05da`](https://github.com/outfitter-dev/trails/commit/2cc05da8dbf8c9bb72e7ad23c624f6f1290a2f01): Harden Warden drift checks for lock v3 manifests. Malformed legacy lock files and manifests without the `topo.lock` artifact now report blocked drift with a regenerate instruction instead of throwing or silently passing.
- [`5d88104`](https://github.com/outfitter-dev/trails/commit/5d88104c6c269e2ef1e92ba3b9e09a410df10c7b): Polish Trails blaze terminology across package docs and Warden guidance.
- [`8f0cd26`](https://github.com/outfitter-dev/trails/commit/8f0cd26528428059173c7ba335c8982911dc2b7d): Upgrade the second wave of Warden diagnostics — the audit's "partial" set — to coaching diagnostics that teach the canonical fix instead of only naming the violation: `context-no-surface-types`, `static-resource-accessor-preference` (inline dependency construction), `example-valid`, `valid-detour-contract` (`on:` constructor), `intent-propagation`, `error-mapping-completeness`, `unreachable-detour-shadowing`, `draft-visible-debt`, `version-pinned-compose`, `orphaned-signal`, `scheduled-destroy-intent`, `resource-id-grammar`, `incomplete-crud`, and `webhook-route-collision`. Rule firing logic is unchanged; only diagnostic text and the matching test/example expectations moved.
- [`48d5ff4`](https://github.com/outfitter-dev/trails/commit/48d5ff446c6f933b5a5501fd1be861dfe02a5a07): Attach term-rewrite fix metadata to the `no-legacy-layer-imports` rule, marking it review-required with no mechanical edits (the legacy layers were removed, not renamed) so `warden --fix` reports but never auto-applies the migration.
- [`216bf10`](https://github.com/outfitter-dev/trails/commit/216bf10d92359d8464343ea81f6c445d06b43629): Fix a false `dead-internal-trail` warning by unioning file-local compose evidence with the project-context compose set, so same-file composition in scanned-but-unregistered packages is recognized.
- [`678cb1c`](https://github.com/outfitter-dev/trails/commit/678cb1c6f49ee0e12615f9dbf757672df49bdcdd): Expose the shared adapter readiness engine through Warden's opt-in
  `--adapter-check` diagnostics and the local `trails adapter check` authoring
  workflow.
- [`5874fd6`](https://github.com/outfitter-dev/trails/commit/5874fd6df872123eff26ce3e10c191681b3eec50): Preserve diagnostic fix metadata through Warden rule trail outputs.
- [`a4f9cf6`](https://github.com/outfitter-dev/trails/commit/a4f9cf6062d0d602eb9c00d06369a098950b72b2): Reserve the `shift` error category and `WorkspaceShiftError` before the stable
  cutover so surface mappings can distinguish moved-workspace retry verdicts.
  Update Warden's error-mapping completeness examples to cover the reserved
  category.
- [`00c0cf8`](https://github.com/outfitter-dev/trails/commit/00c0cf8aa4d7bd4c893883413128d9bf0c5c03b2): Add Warden governance for CLI command route and alias coherence.
- [`b313c58`](https://github.com/outfitter-dev/trails/commit/b313c5864e3ca950193e5f10cc5002874f36c363): Add library projection coherence governance so Warden reports generated library export collisions and stale projection targets before packages materialize.
- [`f245fa0`](https://github.com/outfitter-dev/trails/commit/f245fa03081178163076712fc2c7fbca4ad940fa): Add advisory trail-fork coaching so Warden can warn when a trail may be hiding
  several capabilities behind one branching action or operation input.
- [`f1e6efa`](https://github.com/outfitter-dev/trails/commit/f1e6efa4f383287f0b2196f48185699e7476b18c): Recognize module-local helper functions that receive the trail context when checking declared compose usage.
- [`caff950`](https://github.com/outfitter-dev/trails/commit/caff950232df606ad48106c9324f191b81b43ba6): `implementation-returns-result` now recognizes conditional returns whose branches are all recognized Result expressions — both `return cond ? Result.err(...) : Result.ok(...)` statements (including branches that are Result helpers or Result-bound variables) and concise ternary blaze bodies. Previously the idiomatic two-branch ternary was flagged as an error.
- [`6901776`](https://github.com/outfitter-dev/trails/commit/6901776beaa1412a859f0e9e69c0251c7c432fd9): Add a Warden rule and safe-fix metadata for rewriting retired cross vocabulary to compose vocabulary.
- [`619cb15`](https://github.com/outfitter-dev/trails/commit/619cb15085059b9d3af57b1cd56bfd1e205d48f9): Add a Warden rule (`no-destructured-compose`) that coaches trail blazes to call `ctx.compose(...)` directly instead of destructuring `compose` from the context.

  Keep the generated `create` trail on the direct `ctx.compose(...)` shape so framework-authored trails follow the same composition guidance.

- [`4642268`](https://github.com/outfitter-dev/trails/commit/464226862202b682a450e9858d9900e149a08f14): Make the standalone `warden --help` entry point print CLI help instead of running Warden with an unknown-option diagnostic.
- [`9bab0cf`](https://github.com/outfitter-dev/trails/commit/9bab0cf0a3c7d2a24c22605899653c84af7c3e6b): Follow schema aliases when detecting hidden optional wrappers in version marker
  schemas.
- [`3ceeba8`](https://github.com/outfitter-dev/trails/commit/3ceeba8a0d4f7f8bc889a2455c106e60271c051e): Expand marker-schema-unsupported diagnostics to catch Zod schema constructs that
  runtime marker derivation rejects.
- [`5e7fee8`](https://github.com/outfitter-dev/trails/commit/5e7fee84902c5015f8aefb249e3b0306704a8c92): Keep file-authored signal, resource, entity, and trail definitions known to existence rules for workspace files outside a narrowed app selection. A `trails warden --app <id>` run scans the whole configured workspace but previously built its known-id sets only from the selected app's topo, so honest references in unselected apps — such as a demo trail's `on:` reference to its own declared signal — failed `on-references-exist`. Loaded topos stay authoritative for files under their app-local roots, and root-less topo targets keep governing the entire scan.
- [`df9a7d0`](https://github.com/outfitter-dev/trails/commit/df9a7d00fe4d9ebec948b6ebed6dc4525fc8e0dc): Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- [`beafd03`](https://github.com/outfitter-dev/trails/commit/beafd0359435a8427f48126271fa59aebc2bcc32): Add a warning for blazes that re-wrap an existing Result error with Result.err(result.error) instead of returning the original Result.
- [`30a2c7e`](https://github.com/outfitter-dev/trails/commit/30a2c7e362e75cf8c04a2472c6e2179cedea5ea4): Add the resolver-backed `resolved-import-boundary` Warden rule for cross-package import boundary enforcement.
- [`81bffec`](https://github.com/outfitter-dev/trails/commit/81bffece74acc353a59749b7153f70000f52e3e3): Add Warden import-resolution substrate backed by `oxc-resolver`.
- [`7b173e0`](https://github.com/outfitter-dev/trails/commit/7b173e0cae2f12859e0ee06299e579e492d88706): Warn when a `resource('id', { ... })` definition declares neither a `mock` factory nor an explicit `unmockable` reason, so `testAll(app)` can provision it without production configuration (common pitfall #10).
- [`6e50e7b`](https://github.com/outfitter-dev/trails/commit/6e50e7b43386cd2a52fec9dea8e0bc72412fc8e4): Recognize Result-returning helper provenance when helpers use an imported Result type alias.
- [`48edf8d`](https://github.com/outfitter-dev/trails/commit/48edf8d5d3d11f482101b21e268d296a3815480c): Expose shared Warden source scan-target predicates so downstream consumers can
  preserve the CLI runner's test and declaration-file filtering before invoking
  Warden-owned rules directly.
- [`12ffa3b`](https://github.com/outfitter-dev/trails/commit/12ffa3b86a77a591e624108bfff7a802b4057483): Align Warden signal-rule trail examples so producer trails call `ctx.fire()` for their declared signals.
- [`2f262f7`](https://github.com/outfitter-dev/trails/commit/2f262f7b092d68a9f4351a94ff6176058e86f11f): Improve Warden diagnostics so names-only findings teach the canonical fix instead of only naming the violation.
- [`58b01f2`](https://github.com/outfitter-dev/trails/commit/58b01f24a8ec96eb835bd427469eaca83c803cac): Warn when topo export modules open Trails surfaces at module top level.
- [`d675a53`](https://github.com/outfitter-dev/trails/commit/d675a53e0232f6116d5c5ee8a26eded720ea4d62): Omit `topoNames` from Warden reports when no topo targets were governed, matching the optional report contract.
- [`df13faf`](https://github.com/outfitter-dev/trails/commit/df13faf0c2cb55804bdfeb65abcea1570efb4c61): Tighten Wayfinder navigation review findings: carry adapter filters into included adapter facts, keep live-source outline off the operator MCP surface until host-root binding exists, make unknown MCP resources protocol errors, route secondary Wayfinder graph populations through unified flags, and keep undeclared string `ctx.compose()` calls as Warden errors.

## 1.0.0-beta.50

## 1.0.0-beta.49

## 1.0.0-beta.48

## 1.0.0-beta.47

### Patch Changes

- [`ea2f296`](https://github.com/outfitter-dev/trails/commit/ea2f296e8119cf79bd03aeca3f0aa804f2fbcdd6): Classify adjacent package-route variants in the authored Warden AST regression
  fixtures as explicit preserves so the completed transition remains auditable.
- [`90d394c`](https://github.com/outfitter-dev/trails/commit/90d394c005fdf6b898ba7052d0b56755af0f4954): Derive nested worktree, repository, and submodule collection boundaries in the
  shared Source walker. Regrade and Warden now observe one directly targeted
  working tree per run, and Regrade audit summaries expose boundary skip counts.

## 1.0.0-beta.46

### Minor Changes

- [`fb0ba0a`](https://github.com/outfitter-dev/trails/commit/fb0ba0ab706bbdce470123e9a6fb2ef9f1822806): Convert the eight committed governed Regrade histories to canonical v3 receipts and remove the temporary schema-v2 compatibility path after migration.
- [`9a8b6e4`](https://github.com/outfitter-dev/trails/commit/9a8b6e4af394c76c11e6d0007e0f5f94d0be2cb3): Persist Regrade lifecycle runs as canonical v3 receipts with exact Git blob evidence and authored field provenance, and validate their compact classified-form projection independently in Warden.

### Patch Changes

- [`54d259b`](https://github.com/outfitter-dev/trails/commit/54d259be81fb6c41d85be48a6cb2100c746a7126): Expose parser-native comment spans from `parseWithDiagnostics` so source-aware
  tooling can distinguish exact JavaScript and TypeScript comment trivia without
  reimplementing a lexer.

  Use the shared spans in Warden's public-example rule while keeping leading
  comment ownership fail-closed across JavaScript line terminators.

- [`768cc79`](https://github.com/outfitter-dev/trails/commit/768cc79ca10947b8808b376e281e1a81131b4acc): Close missed projection vocabulary residue in Regrade internals and public
  error-rendering guidance, and keep lifecycle-ambiguous governed identifiers in
  the Warden review inventory instead of assigning them an unsafe automatic
  target.

## 1.0.0-beta.45

### Patch Changes

- [`f1bd093`](https://github.com/outfitter-dev/trails/commit/f1bd09395fcf81db0bcb8657030288877c2e26e6): Recognize conditional, aliased, and parenthesized Result provenance while invalidating provenance after reassignment across the implementation-return and redundant-error-wrap rules.

## 1.0.0-beta.44

### Patch Changes

- [`b1fbe57`](https://github.com/outfitter-dev/trails/commit/b1fbe574e6f44d1fecb5e3a000270955c0a77b7b): Publish Bun-validated package tarballs through an npm trusted-publishing adapter
  binding, add exact repository metadata for each public workspace package, and
  correct the native Bun release descriptor to its pack-only runtime boundary.

## 1.0.0-beta.43

### Minor Changes

- [`4fb20a6`](https://github.com/outfitter-dev/trails/commit/4fb20a68e1ed98972d99fed8b2df96bfa6804bd3): Derive deterministic, provenance-bearing vocabulary plan proposals from a minimal `from`/`to` seed, including morphology, public and compound identifier review, filename and reference-closure candidates, namespace census, and validated live-topo API preserves. Classified governed transitions retain their registry identity while routing every governed form to review instead of inventing a single safe successor.
- [`8fde0a6`](https://github.com/outfitter-dev/trails/commit/8fde0a6c66a7f64f0c27909df7db2731fa4b10f4): Add an advisory project-static rule that reports unknown governed vocabulary permutations from the latest committed Regrade history until they are classified.
- [`d3215b0`](https://github.com/outfitter-dev/trails/commit/d3215b0966f13af2a72ece9adbcc2c68c70f81b6): Add governed file renames to vocabulary Regrade plans, with move-first derived reference closure and persisted policy-aware evidence across CLI and MCP.
- [`5a7d22a`](https://github.com/outfitter-dev/trails/commit/5a7d22ab9d674f86b28758f23c3e94a17efb5be1): Add three-tier vocabulary migration scope. Protected historical paths remain
  scanned and counted as `historical-by-policy` without being rewritten, while
  reports expose scope-tier totals and census-expected teaching-surface coverage
  through equivalent CLI and MCP plan schemas. Applied vocabulary occurrences
  remain auditable in history with an `applied` verdict, while policy-only
  evidence does not make an active plan stale merely by being recorded.
- [`88a6a62`](https://github.com/outfitter-dev/trails/commit/88a6a62a9e9e230ca6d368fa78dc3ece6c816204): Complete the v1 classification-first cutover from projection/project vocabulary
  to derive/derived for contract-owned fact production and render/rendered for
  surface presentation. Public type, helper, rule, relation, and report names move
  without compatibility aliases; ordinary repository/project nouns remain
  explicit preserves or structured review inventory.
- [`bd1bd96`](https://github.com/outfitter-dev/trails/commit/bd1bd96b90cd8b55f73061e4078a14cd75bed745): Require committed Regrade provenance for governed vocabulary transitions.

  Applied governed plans now expose deterministic transition, plan, source,
  safe-apply, and review-follow-up evidence through history results. Warden loads
  committed history into project context, cites it for reintroduced symbols, and
  rejects invalid or missing provenance for transitions that require Regrade in
  the workspace that owns the governed registry, without making downstream apps
  prove the framework's own migrations.
  Portable validation accepts the authoritative numeric file-rename counters
  persisted by Regrade history.

### Patch Changes

- [`53014a4`](https://github.com/outfitter-dev/trails/commit/53014a4593170edd5adfbaa2c94c895c67a320d1): Exclude immutable Regrade history artifacts from downstream migration source scans while preserving active plan and other policy-classified evidence. Warden continues to validate committed history through its dedicated provenance loader.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.
- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Allow source rules to opt into documentation and text-file scanning so durable repository vocabulary guards cover every declared source kind.
- [`113aed6`](https://github.com/outfitter-dev/trails/commit/113aed62d20041e35b0cf9d6c1b1a18df4b88f57): Rename the dependency-light observability owner from `@ontrails/observe` to
  `@ontrails/observability` as a pre-v1 hard cut. Update dependent packages,
  documentation, package discovery, and the governed Regrade route; no
  compatibility package or old import route is retained.
- [`0938e7b`](https://github.com/outfitter-dev/trails/commit/0938e7badc0c5470d194139d642b673658d099e0): Fold the removed `@ontrails/tracing` package into the truthful existing
  owners: intrinsic trace contracts remain in core, developer-state tooling now
  lives at `@ontrails/observability/dev`, and the dependency-light OTel adapter
  lives at `@ontrails/observability/otel`. There is intentionally no root-package
  compatibility redirect because the former root had more than one owner.
- [`50e2779`](https://github.com/outfitter-dev/trails/commit/50e27796d074851bccd57d7df009db749757b457): Extract the real `@ontrails/logtape` and `@ontrails/pino` adapters from the
  temporary observability subpaths. The new packages own their namesake foreign
  dependencies and preserve Trails record metadata, levels, redaction boundaries,
  and lifecycle behavior; the old subpaths are removed in the pre-v1 hard cut.

  Add governed Regrade transitions for both exact import replacements and expose
  the observability adapter target through the shared adapter readiness check.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

### Minor Changes

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
- [`aedb87b`](https://github.com/outfitter-dev/trails/commit/aedb87b3b536c5849636c7a5951c51e1e7f0d1cc): Add governed identifier-segment renames for AST-backed migrations. Regrade can
  now migrate camelCase, PascalCase, leading-underscore, and SCREAMING_SNAKE
  identifier segments, including single-segment forms such as `BLAZE` and
  `_BLAZE`, while preserving exact-mode behavior and rejecting lowercase
  substring, concatenated acronym, or inflection matches.

### Patch Changes

- [`9874e0b`](https://github.com/outfitter-dev/trails/commit/9874e0bb034c0f98edeb19833d9d3519c2a07a4c): Add `@ontrails/cloudflare/d1`, an env-bound Cloudflare D1 store resource for `@ontrails/store` definitions. The new subpath exports `cloudflareD1` and `connectD1`, supports the backend-agnostic store accessor contract (`get`, `list`, `upsert`, `remove`), versioned-table optimistic concurrency, fixture/mock seeding, store-derived write signals, Miniflare-backed conformance tests, and Worker env-bridge integration.

  `@ontrails/core` and `@ontrails/store` no longer require the Bun global for signal fire ids or late-bound store signal tokens, so store definitions and store-derived signal emission work inside Worker modules. `@ontrails/warden` now treats `cloudflareD1` as a required Cloudflare public export with `@example` coverage.

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

- [`4086b5b`](https://github.com/outfitter-dev/trails/commit/4086b5b2f01b24660924fd8b667523f38caaed29): Add `@ontrails/cloudflare/r2`, an env-bound Cloudflare R2 bucket resource with
  `cloudflareR2`, `createMemoryR2`, and `r2ObjectToBlobRef`. The resource
  materializes Worker `r2_buckets` bindings through the shared env bridge, records
  Cloudflare lock overlay facts, carries an in-memory object mock for
  configuration-free tests, and documents the supported object operations plus
  streaming/metadata boundaries.

  `@ontrails/warden` now treats `cloudflareR2` as a required Cloudflare public
  export with `@example` coverage.

- [`01b9204`](https://github.com/outfitter-dev/trails/commit/01b92046db52c71f22a871e58a308d7a94483cab): Harden governed v1 vocabulary transitions with property-key-only blaze literal
  rewrites, structured review for ambiguous literal positions, explicit
  scratch/history boundaries, and scan-only preservation for migration plans and
  historical decision evidence.
- [`ce86e06`](https://github.com/outfitter-dev/trails/commit/ce86e06ea1624cb426f50f7333ae9b01c592868e): Treat same-scope inverse operation pairs such as enable/disable, pause/resume,
  star/unstar, and archive/restore as intentional distinct public contracts in
  the `duplicate-public-contract` rule.
- [`3531b58`](https://github.com/outfitter-dev/trails/commit/3531b58ba5320753d6d2594257ef71bc950d28a1): Add the advisory captured-kernel Warden rule for ownership review when a public
  subpath re-exports package internals and multiple production workspaces consume
  that subpath, including import-then-export barrels that preserve the internal
  binding through a local alias or default export.

  Expose typed import-kind inspection from `@ontrails/source` so project rules
  can keep erased type bindings separate from runtime exports.

- [`35cbe28`](https://github.com/outfitter-dev/trails/commit/35cbe289db46539b3689dbf6cf8ab0e5d9a1b09c): Found `@ontrails/source` as the shared source-code AST kernel for parsing,
  walking, locations, edits, literals, and generic Trails syntax recognition.
  Warden, Regrade, Wayfinder, and the Trails operator now import those shared
  mechanics from `@ontrails/source`; the legacy Warden AST route is removed by the
  stacked hard cutover.
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

- [`2b7da24`](https://github.com/outfitter-dev/trails/commit/2b7da245b7d689e056bfd642e3651244c95e7ff4): Split Warden's source-analysis implementation into focused shared mechanics and
  Warden-owned policy modules while preserving the public AST helper contract.
- [`76a9e1d`](https://github.com/outfitter-dev/trails/commit/76a9e1da974de24259f7384947e198e1f6380e44): Remove the legacy Warden AST compatibility export now that shared source-analysis helpers are published from `@ontrails/source`.
- [`a45cead`](https://github.com/outfitter-dev/trails/commit/a45cead6e3ddf6ce606bf5e663b74c0d3b5664b8): Make the planned contour-to-entity Regrade transition code-fact complete for
  apply readiness while leaving the repository cutover status planned.
  Identifiers that already contain the target segment now stay in the review
  inventory instead of producing duplicated target names.
- [`8a1ac00`](https://github.com/outfitter-dev/trails/commit/8a1ac00b5d789be41ca6e464358c96b01e442bf4): Govern the exact `@ontrails/warden/ast` to `@ontrails/source` package route
  transition for Regrade string-literal and module-specifier rewrites exposed
  through the Trails CLI and MCP tools. Safe rewrites now require the owning
  manifest to already declare the target package; otherwise Regrade preserves the
  occurrence with dependency repair guidance. Invalid manifests remain unchanged
  and produce structured repair guidance that names the owning manifest. Explicit
  preserve rules remain no-ops before dependency validation, and dotted or
  subpath-like near routes remain deferred instead of becoming invented imports.

## 1.0.0-beta.39

### Patch Changes

- [`f42ca6e`](https://github.com/outfitter-dev/trails/commit/f42ca6e40b29155acec446e5bf44e52e014466bd): Hard cutover: the CLI consumes `cli` bindings from the app-authored surfaces overlay. Scalar bindings behave identically to the removed cliAliases (parity-tested) — the binding name splits on `.` into a transparent synonym command path for exactly one trail. List bindings arrive as command groups: each expanded member trail gets a group-prefixed route that dispatches the member trail with its identity preserved, and a singleton list stays a group. Expansion is fail-fast boundary validation: a scalar binding resolving to zero or multiple trails, or a group with an empty member union, is a `ValidationError` naming the binding. `DeriveTopoGraphOptions.cliAliases`, the `cliAliases`/`trailsCliAliases` app-module export convention, and the per-kind compile lift are deleted; `deriveCliCommands`/`createProgram` take `overlays` instead of `aliases`, and both topo-graph derivation pipelines expand the same bindings through one shared helper so runtime CLI routes and lock routes come from one semantic. A leftover legacy export is now a Warden error (`no-legacy-cli-alias-export`) naming the `surfaceOverlay({ cli: { ... } })` rewrite.

  This is a breaking API removal shipped under the lockstep beta patch convention (pre-1.0 hard-cutover posture, zero external adoption); the removed options have no deprecation window by design.

- [`bafde1f`](https://github.com/outfitter-dev/trails/commit/bafde1fc8172abb8d8617f69a3c7a70667626d10): Fresh derivations now collect app-module overlays through the shared channel compile uses. `@ontrails/adapter-kit` exports `resolveTrailsOverlays()`, the one reader of an app module's `trailsOverlays` export; the compile-path fresh app lease and Warden's fresh topo loading both go through it, making per-namespace drift asymmetry structurally impossible. Warden drift checks (`checkDrift` now accepts derive options carrying overlays) and the topo-aware rule context graph derive with the same overlays the committed lock embeds, so rules like `surface-overlay-coherence` fire on standard runs. Stale drift results name the drifted overlay namespaces (`DriftResult.driftedOverlayNamespaces`) and point at `trails compile` as the remediation.
- [`b077fb7`](https://github.com/outfitter-dev/trails/commit/b077fb7ba6d9724cac6f0e59bc3fec9aec28984c): Add the export-restructure Regrade class family (TRL-1210). `export-restructure:cli-aliases` inverts legacy `cliAliases`/`trailsCliAliases` exports into `surfaceOverlay({ cli })` bindings inside the module's `trailsOverlays` export — adding the `@ontrails/core` import, deleting the legacy export, and routing anything it cannot prove safe (computed keys, spreads, in-module `aliases:` references) to `needs-review` with the exact target shape named. `export-restructure:mcp-trailheads` projects call-site MCP trailhead maps into `surfaceOverlay({ mcp })` group bindings: it rewrites in place when the same module exports `trailsOverlays`, and otherwise emits a classified `needs-review` handoff naming the module-overlay target while the call-site map stays as the richer-metadata override-in-context. Warden's fix-class union grows to `'export-restructure' | 'term-rewrite'`, `no-legacy-cli-alias-export` now advertises the `export-restructure` class, and `loadWardenRegradeClasses` supersedes `loadWardenTermRewriteClasses` (still exported) as the full Warden-routed class loader. Class-mode Regrade also gains the full plan lifecycle: `trails regrade plan --type class --class-ids ...` writes a `.trails/regrade/<slug>.json` plan carrying class ids, scope, and intent, `regrade check` re-runs the dry run and gates on outstanding rewrites or review, and `regrade apply` applies and graduates the plan to `.trails/regrade/history/<slug>-<hash>.json` — the same plan → check → apply → history evidence trail vocabulary regrades already had, now available to structural transforms. The class family ships for downstream apps bridging the pre-1.0 gap, so pre-cutover alias exports and trailhead maps migrate mechanically instead of by hand.
- [`81373bc`](https://github.com/outfitter-dev/trails/commit/81373bc5e980bb06d56fb06af4f0986f72e318c7): Wave-2 MCP cutover to the app-authored `surfaces` overlay. The overlay's `mcp` bindings are now the authored, lockable default for the MCP surface: a list binding derives one grouped trailhead tool (member selection in `{ trail, input }`, member identity preserved in `{ trail, output }`, deterministic derived description), and a scalar binding derives an additional tool synonym whose MCP-safe name is published verbatim and must expand to exactly one trail. `deriveMcpTools`/`createServer` accept the new `overlays` option; `@ontrails/core` gains `expandMcpSurfaceBindings` and `deriveMcpTrailheadDescription`.

  The call-site `CreateServerOptions.trailheads` map survives as permanent override-in-context design, not a compatibility bridge: when both channels are present, the call-site map wins at runtime. Warden's new `trailhead-override-divergence` rule (warn) names both sides when a call-site map's binding names or member selectors diverge from the authored overlay default.

  Topographer now derives `graph.trailheads` from the overlay's `mcp` list bindings in both `deriveTopoGraph` and the store-side graph build, so trailhead facts flow from compiled locks into Wayfinder reads for the first time. The never-wired `DeriveTopoGraphOptions.trailheads` option and the `TopoGraphTrailheadDeclaration`/`TopoGraphTrailheadTrailSelector` types are removed — a beta-window hard cutover of an option no caller could reach; author the equivalent `mcp` list binding in `surfaceOverlay({ mcp })` instead.

- [`820b4ad`](https://github.com/outfitter-dev/trails/commit/820b4ad9c40ea383b3c489a05fe7e4b2328e324f): Add `surfaceOverlay` — the shared surface-naming schema (scalar binding = synonym, list binding = grouped entry, singleton list stays a group) with app-authored/adapter-derived overlay provenance enforced at collection and consumption, and the `surface-overlay-coherence` Warden rule. MCP tool-name derivation moves to `@ontrails/core` (`deriveMcpToolName`) so the surface and governance read one projection; `@ontrails/mcp`'s `deriveToolName` now delegates to it. The coherence rule activates on standard warden runs once fresh derivations collect app-module overlays through the shared compile channel (TRL-1209, next in this stack).
- [`58db715`](https://github.com/outfitter-dev/trails/commit/58db715209442604fe58f5004fec37426c5969b1): `duplicate-public-contract` now includes contour anchoring in the normalized contract fingerprint, so factory CRUD trails derived against different contours (for example two tables' `delete` trails that both normalize to `{ id } → void` with the same intent) are no longer flagged as duplicates. Genuine duplicates — identical facts with the same or no contour anchoring — still warn, and the diagnostic message names contours among the shared facts.
- [`7cd0576`](https://github.com/outfitter-dev/trails/commit/7cd0576db8bc421cfd441c126f884e425e2254af): `signal-graph-coaching` no longer flags store-derived table signals (`created`/`updated`/`removed`) that have no consumers. Store resources advertise those signals as available capability, so leaving them unconsumed is a legitimate steady state for store-backed apps. Non-store produced signals without consumers still warn, and dead-signal coaching (no producer and no consumer) is unchanged.
- [`b9e82a3`](https://github.com/outfitter-dev/trails/commit/b9e82a33546356c93fbc302fb934a83f19f1c2c5): Webhook ingress v2 (TRL-1194, absorbing TRL-1174 and TRL-1175): store-verified, per-endpoint webhook ingress becomes framework-expressible. `webhook()` accepts dynamic path segments (`path: '/hooks/:endpoint'`) whose values are delivered as envelope fields, opt-in `rawBody: true` delivery (a non-JSON body is no longer a surface-level failure — the trail owns payload interpretation), an allowlisted `headers` list delivered lowercased, and `resources` that make `verify` resource-capable: the HTTP surface resolves the declared resources into a context for the verifier and releases them afterwards, so signature checks can reach stores holding per-endpoint secrets. Envelope-mode ingress responds 202 Accepted; classic static webhooks keep their exact-match, JSON-gated, 200 behavior. Core exports `parseWebhookPathParams`, `matchWebhookPath`, `webhookPathPatternsOverlap`, and `createResources`. The `webhook-route-collision` Warden rule now also flags dynamic patterns that overlap other webhook or derived routes, not just exact method/path duplicates.

## 1.0.0-beta.38

### Patch Changes

- [`a105127`](https://github.com/outfitter-dev/trails/commit/a105127e5662ed9a6c245125f791fb0182da3f5e): Add the `@ontrails/cloudflare` adapter collection with its first two service subpaths. `@ontrails/cloudflare/workers` exports `createWorkersHandler`, a materializer producing the `{ fetch(request, env, ctx) }` Worker export on the shared HTTP fetch kernel, with an env bridge that re-resolves env-bound resources whenever a new Worker `env` arrives so no resource instance serves a request with a stale env. `@ontrails/cloudflare/kv` exports `cloudflareKv`, a resource definition wrapping a KV namespace binding (`get`/`put`/`delete`/`list` with TTL options) plus an in-memory `createMemoryKv` mock so `testAll` runs configuration-free.

  `@ontrails/core` now guards the default trail context fields: `requestId` falls back to `crypto.randomUUID()` when the `Bun` global is absent, and `cwd`/`env` fall back to `'/'`/`{}` when `process` is absent, so trail execution works on runtimes like Cloudflare Workers.

  `@ontrails/warden` registers the `@ontrails/cloudflare` public barrel in the repo-local `public-export-example-coverage` policy, requiring `@example` TSDoc coverage on `createWorkersHandler` and `cloudflareKv`.

## 1.0.0-beta.37

## 1.0.0-beta.36

### Patch Changes

- [`6e63e48`](https://github.com/outfitter-dev/trails/commit/6e63e483617b84cb6868d0c4d58d5b5a8d3b9ed2): Complete the v1 grouped surface-entry vocabulary cutover from facet to trailhead, including Regrade dogfood support for governed string literal renames and composed AST rewrite application.

## 1.0.0-beta.35

### Patch Changes

- [`1f5659b`](https://github.com/outfitter-dev/trails/commit/1f5659bfe39568f7bbee0503ace8b6e562d3f899): Add the `duplicate-exported-symbol` Warden rule to warn when multiple first-party packages define the same exported symbol name.

## 1.0.0-beta.34

## 1.0.0-beta.33

### Patch Changes

- [`fc002d5`](https://github.com/outfitter-dev/trails/commit/fc002d5669f4303427e99f45f9998fd0b0172bdb): Add governed AST identifier rename helpers and Warden residue detection for
  active vocabulary symbol transitions.
- [`6ca0d8f`](https://github.com/outfitter-dev/trails/commit/6ca0d8f776801eee71ddd86cb88c198eaf5815fd): Add a typed governed-vocabulary transition registry that Warden owns and Regrade
  can consume for migration planning.

## 1.0.0-beta.32

### Patch Changes

- 3e5c0fc: Export shared diagnostic base types from core and align governance diagnostic
  severity vocabulary across adapter checks, permits, and Warden.
- f3c4fef: Export a shared `escapeRegExp` helper from core and migrate first-party callers off local copies.
- cb0a9d8: Export shared workspace package discovery helpers from core and migrate first-party discovery callers.
- fe72b84: Fold remaining Regrade and Warden scan-target surfaces onto the shared path-scope vocabulary.
- Updated dependencies [3e5c0fc]
- Updated dependencies [f3c4fef]
- Updated dependencies [cb0a9d8]
- Updated dependencies [8db145e]
- Updated dependencies [2b819f4]
- Updated dependencies [21c6dda]
- Updated dependencies [860ef32]
- Updated dependencies [fe72b84]
  - @ontrails/adapter-kit@1.0.0-beta.32
  - @ontrails/core@1.0.0-beta.32
  - @ontrails/permits@1.0.0-beta.32
  - @ontrails/topographer@1.0.0-beta.32
  - @ontrails/config@1.0.0-beta.32
  - @ontrails/cli@1.0.0-beta.32
  - @ontrails/store@1.0.0-beta.32

## 1.0.0-beta.31

### Patch Changes

- ee9f3ae: Let Warden fix capabilities declare downstream scan targets and have Regrade
  honor those targets for Warden-backed term-rewrite classes.

  Dogfood the first safe facet-to-trailhead prose rewrite through project-local
  Warden rules and Regrade.

- a0126d9: Add Warden `scope.exclude` globs through project config and the Trails CLI
  wrapper so governance runs can exclude local notes, scratch space, and generated
  state without dropping durable skills or plugin assets from scope.
- 6a26a08: Rename Warden governance scope controls from jurisdiction ignore settings to `scope.exclude` across config, CLI, and Trails surfaces.
- Updated dependencies [4cd5d4e]
- Updated dependencies [38907cc]
  - @ontrails/core@1.0.0-beta.31
  - @ontrails/adapter-kit@1.0.0-beta.31
  - @ontrails/cli@1.0.0-beta.31
  - @ontrails/config@1.0.0-beta.31
  - @ontrails/permits@1.0.0-beta.31
  - @ontrails/store@1.0.0-beta.31
  - @ontrails/topographer@1.0.0-beta.31

## 1.0.0-beta.30

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.30
- @ontrails/cli@1.0.0-beta.30
- @ontrails/config@1.0.0-beta.30
- @ontrails/core@1.0.0-beta.30
- @ontrails/permits@1.0.0-beta.30
- @ontrails/store@1.0.0-beta.30
- @ontrails/topographer@1.0.0-beta.30

## 1.0.0-beta.29

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.29
- @ontrails/cli@1.0.0-beta.29
- @ontrails/config@1.0.0-beta.29
- @ontrails/core@1.0.0-beta.29
- @ontrails/permits@1.0.0-beta.29
- @ontrails/store@1.0.0-beta.29
- @ontrails/topographer@1.0.0-beta.29

## 1.0.0-beta.28

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.28
- @ontrails/cli@1.0.0-beta.28
- @ontrails/config@1.0.0-beta.28
- @ontrails/core@1.0.0-beta.28
- @ontrails/permits@1.0.0-beta.28
- @ontrails/store@1.0.0-beta.28
- @ontrails/topographer@1.0.0-beta.28

## 1.0.0-beta.27

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.27
- @ontrails/cli@1.0.0-beta.27
- @ontrails/config@1.0.0-beta.27
- @ontrails/core@1.0.0-beta.27
- @ontrails/permits@1.0.0-beta.27
- @ontrails/store@1.0.0-beta.27
- @ontrails/topographer@1.0.0-beta.27

## 1.0.0-beta.26

### Patch Changes

- 1307568: Centralize Trails config module path conventions, move local config overrides to root `trails.config.local.*`, scaffold the matching gitignore entries, and load project-local Warden rules from `.trails/rules.ts` or `.trails/rules/`.
- ef09e46: Add shared Trails project-root discovery helpers and use them in Warden so nested
  cwd invocations still load root `trails.config.*` and project-local
  `.trails/rules*` governance.
- 38cd9d6: Add a shared Trails config file loader that treats `trails.config.ts` as the natural primary while supporting JSON, JSONC, YAML, and TOML peer formats. Release and Warden config loading now consume the same loader and local overrides can be authored as data files.
- f8403c4: Collapse normal topo compilation onto one root `trails.lock` envelope that embeds the TopoGraph, hash, and summary while keeping legacy `.trails/trails.lock` plus `.trails/topo.lock` readers for migration compatibility.
- ff48e41: Harden project-local rule loading: Warden now discovers `.trails/rules.ts` and direct `.trails/rules/*.ts` files only, reports duplicate project-local rule ids, and emits a migration diagnostic for the retired `trails/warden/rules` location.
- Updated dependencies [1307568]
- Updated dependencies [ef09e46]
- Updated dependencies [38cd9d6]
- Updated dependencies [f8403c4]
- Updated dependencies [371d19e]
  - @ontrails/config@1.0.0-beta.26
  - @ontrails/core@1.0.0-beta.26
  - @ontrails/topographer@1.0.0-beta.26
  - @ontrails/adapter-kit@1.0.0-beta.26
  - @ontrails/cli@1.0.0-beta.26
  - @ontrails/permits@1.0.0-beta.26
  - @ontrails/store@1.0.0-beta.26

## 1.0.0-beta.25

### Patch Changes

- a9fdbc7: Clarify surface accommodation doctrine in MCP surface facet metadata and Warden trail-fork coaching guidance.
- f8fd6ca: Add OXC Walker-backed AST facade helpers for parent-aware traversal, scope-aware traversal, source locations, and safe source edits.
- 0fcc42b: Add `dead-public-trail` and `duplicate-public-contract` Warden coaching rules so exported public trails stay anchored and duplicate surface contracts become visible drift.
- c36aca9: Preserve existing Result error boundaries directly and widen Warden pass-through
  coaching beyond trail blazes.
- f556559: Adds curated typed AST node guards to the public `@ontrails/warden/ast` helper
  surface so source consumers can narrow common OXC node shapes without assertion
  casts.
- 6250729: Expands the public AST guard/accessor surface and migrates Warden/Regrade AST
  consumers onto the typed helpers instead of rule-local node-field casts.
- d73c38e: Warn when Warden rules add raw AST node-field casts where a typed accessor exists.
- a8e4dc3: Clean up the Wayfinder navigation grammar before RC, including explicit pattern/query/file selectors, target-bound dependency and impact flags, drift-first provenance fields, stricter fires declaration diagnostics, and updated operator dogfood coverage.
- a4f9cf6: Reserve the `shift` error category and `WorkspaceShiftError` before the stable
  cutover so surface mappings can distinguish moved-workspace retry verdicts.
  Update Warden's error-mapping completeness examples to cover the reserved
  category.
- 00c0cf8: Add Warden governance for CLI command route and alias coherence.
- b313c58: Add library projection coherence governance so Warden reports generated library export collisions and stale projection targets before packages materialize.
- f245fa0: Add advisory trail-fork coaching so Warden can warn when a trail may be hiding
  several capabilities behind one branching action or operation input.
- f1e6efa: Recognize module-local helper functions that receive the trail context when checking declared compose usage.
- caff950: `implementation-returns-result` now recognizes conditional returns whose branches are all recognized Result expressions — both `return cond ? Result.err(...) : Result.ok(...)` statements (including branches that are Result helpers or Result-bound variables) and concise ternary blaze bodies. Previously the idiomatic two-branch ternary was flagged as an error.
- df13faf: Tighten Wayfinder navigation review findings: carry adapter filters into included adapter facts, keep live-source outline off the operator MCP surface until host-root binding exists, make unknown MCP resources protocol errors, route secondary Wayfinder graph populations through unified flags, and keep undeclared string `ctx.compose()` calls as Warden errors.
- Updated dependencies [c36aca9]
- Updated dependencies [3befcf1]
- Updated dependencies [f1e6efa]
- Updated dependencies [a4f9cf6]
- Updated dependencies [9bcf34e]
- Updated dependencies [f7d97fc]
- Updated dependencies [59d10da]
- Updated dependencies [d9c6e50]
  - @ontrails/core@1.0.0-beta.25
  - @ontrails/topographer@1.0.0-beta.25
  - @ontrails/cli@1.0.0-beta.25
  - @ontrails/adapter-kit@1.0.0-beta.25
  - @ontrails/permits@1.0.0-beta.25
  - @ontrails/store@1.0.0-beta.25

## 1.0.0-beta.24

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.24
- @ontrails/cli@1.0.0-beta.24
- @ontrails/core@1.0.0-beta.24
- @ontrails/permits@1.0.0-beta.24
- @ontrails/store@1.0.0-beta.24
- @ontrails/topographer@1.0.0-beta.24

## 1.0.0-beta.23

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.23
- @ontrails/cli@1.0.0-beta.23
- @ontrails/core@1.0.0-beta.23
- @ontrails/permits@1.0.0-beta.23
- @ontrails/store@1.0.0-beta.23
- @ontrails/topographer@1.0.0-beta.23

## 1.0.0-beta.22

### Patch Changes

- @ontrails/adapter-kit@1.0.0-beta.22
- @ontrails/cli@1.0.0-beta.22
- @ontrails/core@1.0.0-beta.22
- @ontrails/permits@1.0.0-beta.22
- @ontrails/store@1.0.0-beta.22
- @ontrails/topographer@1.0.0-beta.22

## 1.0.0-beta.21

### Minor Changes

- 5be032c: Add the repo-local `public-export-example-coverage` Warden rule (and its `publicExportExampleCoverageTrail` wrapper), graduating `scripts/check-public-api-examples.ts` into governed rule coverage. The rule anchors to this repository's five public surface package barrels via the rule module's own on-disk location, so it stays silent in consumer repositories.

### Patch Changes

- Updated dependencies [99523f2]
- Updated dependencies [3caa263]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/permits@1.0.0-beta.21
  - @ontrails/topographer@1.0.0-beta.21
  - @ontrails/adapter-kit@1.0.0-beta.21
  - @ontrails/cli@1.0.0-beta.21
  - @ontrails/store@1.0.0-beta.21

## 1.0.0-beta.20

### Minor Changes

- 8bc0708: Add surface facet coherence diagnostics for selector overlap, visibility widening acknowledgements, dynamic selectors, and description hygiene.

### Patch Changes

- 851a2a3: Derive trail caller and blaze input types from the authored input schema while keeping one public input contract.
- 6901776: Add a Warden rule and safe-fix metadata for rewriting retired cross vocabulary to compose vocabulary.
- Updated dependencies [851a2a3]
- Updated dependencies [eee1307]
- Updated dependencies [b248d4a]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/store@1.0.0-beta.20
  - @ontrails/topographer@1.0.0-beta.20
  - @ontrails/adapter-kit@1.0.0-beta.20
  - @ontrails/cli@1.0.0-beta.20
  - @ontrails/permits@1.0.0-beta.20

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.

### Minor Changes

- 120caf5: Promote topo artifact commands to `trails compile` and `trails validate`.
- 1c975c3: Define the Warden fix-metadata contract (`WardenFix`, `WardenFixCapability`, `WardenFixClass`, `WardenFixSafety`, `WardenFixEdit`) with optional `fix` metadata on diagnostics and rule metadata, projected through the guide, manifest, markdown, and agent guidance. Export `wardenFixClasses`/`wardenFixSafeties` value arrays and surface the rule `fix` capability in the `warden.guide` trail output schema. Dormant until a rule declares it.
- d5d518e: Add `warden --fix` to apply safe source fixes. The executor applies only `safety: 'safe'` edits last-to-first, re-reading and rewriting affected files, while review-required, edit-less, and topo diagnostics stay reported but unapplied. The report surfaces applied, changed-file, and skipped counts.

  Expose `fix` through the Trails app wrapper and mark the `warden` trail as write intent with explicit public access because `fix: true` mutates source files while the local governance command remains directly runnable.

### Patch Changes

- f8d80b9: Refresh current-facing compose vocabulary in package documentation after the composition cutover.
- f0f7e2f: Avoid draft-marker false positives when a packed Warden install scans the Trails framework source tree from a different package location.
- 64fb15a: Add Warden rules for trail version lifecycle guidance, version gaps, marker-safe schemas, pinned composes, examples, and pending force audit events.
- 5d88104: Polish Trails blaze terminology across package docs and Warden guidance.
- 48d5ff4: Attach term-rewrite fix metadata to the `no-legacy-layer-imports` rule, marking it review-required with no mechanical edits (the legacy layers were removed, not renamed) so `warden --fix` reports but never auto-applies the migration.
- 216bf10: Fix a false `dead-internal-trail` warning by unioning file-local compose evidence with the project-context compose set, so same-file composition in scanned-but-unregistered packages is recognized.
- 678cb1c: Expose the shared adapter readiness engine through Warden's opt-in
  `--adapter-check` diagnostics and the local `trails adapter check` authoring
  workflow.
- 5874fd6: Preserve diagnostic fix metadata through Warden rule trail outputs.
- 619cb15: Add a Warden rule (`no-destructured-compose`) that coaches trail blazes to call `ctx.compose(...)` directly instead of destructuring `compose` from the context.

  Keep the generated `create` trail on the direct `ctx.compose(...)` shape so framework-authored trails follow the same composition guidance.

- 4642268: Make the standalone `warden --help` entry point print CLI help instead of running Warden with an unknown-option diagnostic.
- 9bab0cf: Follow schema aliases when detecting hidden optional wrappers in version marker
  schemas.
- 3ceeba8: Expand marker-schema-unsupported diagnostics to catch Zod schema constructs that
  runtime marker derivation rejects.
- beafd03: Add a warning for blazes that re-wrap an existing Result error with Result.err(result.error) instead of returning the original Result.
- 7b173e0: Warn when a `resource('id', { ... })` definition declares neither a `mock` factory nor an explicit `unmockable` reason, so `testAll(app)` can provision it without production configuration (common pitfall #10).
- 6e50e7b: Recognize Result-returning helper provenance when helpers use an imported Result type alias.
- 48edf8d: Expose shared Warden source scan-target predicates so downstream consumers can
  preserve the CLI runner's test and declaration-file filtering before invoking
  Warden-owned rules directly.
- 12ffa3b: Align Warden signal-rule trail examples so producer trails call `ctx.fire()` for their declared signals.
- 2f262f7: Improve Warden diagnostics so names-only findings teach the canonical fix instead of only naming the violation.
- 58b01f2: Warn when topo export modules open Trails surfaces at module top level.
- Updated dependencies [bb81ffe]
- Updated dependencies [e41c382]
- Updated dependencies [a2f1825]
- Updated dependencies [a2f1825]
- Updated dependencies [1eb5bdc]
- Updated dependencies [f8d80b9]
- Updated dependencies [846a597]
- Updated dependencies [223aaad]
- Updated dependencies [3125f4d]
- Updated dependencies [2494dc6]
- Updated dependencies [4bc8a99]
- Updated dependencies [120caf5]
- Updated dependencies [2d53717]
- Updated dependencies [16cb740]
- Updated dependencies [8894ecb]
- Updated dependencies [fdf7ec9]
- Updated dependencies [92e709b]
- Updated dependencies [d76be13]
- Updated dependencies [84f56a5]
- Updated dependencies [653d1fc]
- Updated dependencies [431b04c]
- Updated dependencies [2e76288]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
- Updated dependencies [fc00aeb]
- Updated dependencies [ab1c77c]
- Updated dependencies [4f43874]
- Updated dependencies [678cb1c]
  - @ontrails/adapter-kit@1.0.0-beta.19
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/cli@1.0.0-beta.19
  - @ontrails/store@1.0.0-beta.19
  - @ontrails/topographer@1.0.0-beta.19
  - @ontrails/permits@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- @ontrails/cli@1.0.0-beta.18
- @ontrails/core@1.0.0-beta.18
- @ontrails/permits@1.0.0-beta.18
- @ontrails/store@1.0.0-beta.18
- @ontrails/topographer@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- Updated dependencies [3dc8254]
- Updated dependencies [61497c5]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/cli@1.0.0-beta.17
  - @ontrails/permits@1.0.0-beta.17
  - @ontrails/store@1.0.0-beta.17
  - @ontrails/topographer@1.0.0-beta.17

## 1.0.0-beta.16

### Minor Changes

- e991a5b: Add generic enum value aliases for CLI flags and migrate Warden command aliases onto the shared alias model.
- 2e05e27: Add `--dev-permit` for local-development synthetic full-access. New `devPermitPreset()` exposes a boolean flag; when set, the CLI synthesizes a `BasePermit` (`id: 'dev-permit'`, scopes enumerated from every declared scope across the topo) and overlays it on `ctx.permit`. Mutually exclusive with `--permit` and `--token` — any combination fails with `ValidationError` listing the conflicting flags. New Warden rule `no-dev-permit-in-source` flags any committed source file containing `--dev-permit` as an error, with a tight allow-list (`packages/cli/src/flags.ts`, `packages/cli/src/build.ts`, the rule itself). The Warden runner still scans test TypeScript files for this literal while keeping unrelated source rules filtered out of tests. Apps that import `authResource`/`authLayer` are unaffected.
- ad553a6: Add one warden rule coaching against the removed legacy layer API. `no-legacy-layer-imports` (error) flags any source-string reference to `authLayer`, `autoIterateLayer`, or `dateShortcutsLayer` and points the developer at the migration paths (CLI surface derivation for pagination/date-shortcuts; intrinsic permit enforcement for auth). Allow-list covers the migration notes in `packages/cli/src/{pagination,date-shortcuts}.ts` and the rule's own files. The rule is classified `lifecycle: temporary` with a `retireWhen` string tying it to the legacy layer migration window. Trail count bumps 45 → 46.
- 802fdfc: Rename Warden guide manifest rule grouping from `category` to `concern` so the
  public JSON contract matches the source metadata field.
- 22c6c06: Accept ADR-0041 Unified Observability and ship the first activation and
  observability primitives it depends on: activation trace records, topo-level
  observe configuration, webhook activation materialization, signal/webhook
  warden coaching, the `@ontrails/observe` package, sink composition, and
  zero-dependency observe sinks.
- 767eb41: Ship the default `warden` bin from `@ontrails/warden` and migrate the old private `apps/ci` runner into the package-local CLI surface.

  The new bin supports `--ci`, `--pre-push`, `--depth`, `--fail-on`, `--strict`, `--format`, `--lock`, `--drafts`, `--apps`, and the Sprint 1 standalone aliases. CI output now uses the package Warden formatters directly, so GitHub annotations and JSON payloads follow the `@ontrails/warden` report shape instead of the retired `apps/ci` wrapper shape.

- 82019a7: Export `wardenConfigSchema` for composing Warden options into `trails.config.ts`.
- f6fdc62: Add structured Warden remediation guidance to rule metadata, diagnostics, report output, and the `trails warden` result schema.
- a10ffa4: Add a Warden guide manifest projection and expose it through `trails warden guide` in markdown, agent-json, and manifest formats.
- 7085f01: Add a Warden topo-aware rule that requires public MCP/HTTP surface-eligible trails to declare output schemas.
- 8ddf5ff: Extend `runWarden` into the shared Warden orchestration entrypoint with effective config resolution, depth/fail thresholds, rule facets, and multi-topo report metadata.

  Adapt the built-in `trails warden` wrapper to consume the readonly Warden report diagnostics contract without weakening its output schema.

- f5b6112: Add an advisory Warden rule that prefers static resource helpers over dynamic context resource lookups when the resource definition is already in scope.

### Patch Changes

- c3fc5c3: Move previously root-exported helper contracts out of `src/internal/*` to stable core module homes, document their public boundary, and guard the public barrel against future internal re-exports.
- e898cc4: Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
- 3395234: Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- d40430d: Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/logtape` for LogTape forwarding.
- de30d6c: Introduce `topo.compile` as the canonical trail for writing `.trails` lockfile
  and surface artifacts, remove the `survey --generate` mode, and update drift
  guidance to point at the compile command.
- 331e3a9: Relocate the topo-store public API from `@ontrails/core` to `@ontrails/topographer` per ADR-0042. Generic `trails-db` helpers (`openReadTrailsDb`, `openWriteTrailsDb`, `ensureSubsystemSchema`, `deriveTrailsDbPath`, `deriveTrailsDir`) stay in core because tracing and other subsystems share them.

  Breaking pre-1.0 beta change. Update consumer imports:

  ```diff
  - import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot, createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/core';
  + import { topoStore, createTopoStore, createMockTopoStore, createTopoSnapshot, listTopoSnapshots, pinTopoSnapshot, unpinTopoSnapshot } from '@ontrails/topographer';
  + import { createStoredTopoSnapshot, getStoredTopoExport, countTopoSnapshots, countPinnedSnapshots, countPrunableSnapshots, pruneUnpinnedSnapshots } from '@ontrails/topographer/backend-support';
  ```

  The same root move applies to types `ReadOnlyTopoStore`, `MockTopoStoreSeed`, `TopoSnapshot`, `TopoStoreRef`, `TopoStoreExportRecord`, `TopoStoreResourceRecord`, `TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `CreateTopoSnapshotInput`, and `ListTopoSnapshotsOptions`. The direct DB helper type `StoredTopoExport` moves to `@ontrails/topographer/backend-support`.

  Core newly exports `activationSourceKey`, `projectActivationSourceDeclaration`, `activationSourceDeclarationSignature`, and the `ActivationSourceProjection` type — these were already used internally and are now part of the public surface so `@ontrails/topographer` (the only consumer that needs them) can import them through normal package channels.

- 4399fdb: Renamed `@ontrails/schema` to `@ontrails/topographer`. Mechanical rename only — no API changes. Update import sites from `@ontrails/schema` to `@ontrails/topographer`. See ADR-0042 for the durable graph substrate doctrine.
- 2dd9cda: Promote ADR-0043 (Layer Evolution) from draft to accepted, amend it on 2026-05-04 to remove the briefly proposed `Middleware` split, and publish the Layer Evolution Migration Guide at `docs/migration/layer-evolution.md`.

  Documentation-only change capturing the post-implementation state of the layer-evolution work shipped across TRL-471 through TRL-476: typed `Layer` primitive with optional `input` schema, three attachment scopes (trail, surface, topo), CLI/MCP/HTTP surface projection of layer inputs, removal of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`, and warden coaching via `no-legacy-layer-imports` (error). The migration guide is the durable countermeasure to the vocabulary churn flagged in ADR-0043's tradeoffs.

- fb10112: Polish Warden guidance projection by preserving labels in plain-text doc links
  and reusing the shared diagnostic schema from the Trails CLI wrapper.
- bfabe09: Suppress static resource accessor warnings when a string lookup resolves to a
  resource variable name shadowed inside `blaze`.
- 7a1d4a9: Rename the public resolved graph API from `SurfaceMap` to `TopoGraph`, including
  the derive, hash, diff, and current graph artifact I/O helpers.
- 84f595a: Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
- d2cb9ba: Rename topo-store export artifacts from surface-era names to TopoGraph names. The `topo_exports` table now stores `topo_graph`, `topo_graph_hash`, and `lock_manifest`, and backend-support export records expose `topoGraphJson`, `topoGraphHash`, and `lockManifestJson`.
- 2cc05da: Harden Warden drift checks for lock v3 manifests. Malformed legacy lock files and manifests without the `topo.lock` artifact now report blocked drift with a regenerate instruction instead of throwing or silently passing.
- df9a7d0: Add project-aware public export-map governance for @ontrails workspace docs,
  imports, root barrels, and bin-only package surfaces.
- 30a2c7e: Add the resolver-backed `resolved-import-boundary` Warden rule for cross-package import boundary enforcement.
- 81bffec: Add Warden import-resolution substrate backed by `oxc-resolver`.
- d675a53: Omit `topoNames` from Warden reports when no topo targets were governed, matching the optional report contract.
- Updated dependencies [73622ae]
- Updated dependencies [e991a5b]
- Updated dependencies [25f3c5c]
- Updated dependencies [6300f70]
- Updated dependencies [d172013]
- Updated dependencies [c3fc5c3]
- Updated dependencies [20d7a5c]
- Updated dependencies [be5fb46]
- Updated dependencies [199304e]
- Updated dependencies [e898cc4]
- Updated dependencies [2bf239e]
- Updated dependencies [200bece]
- Updated dependencies [e4beec9]
- Updated dependencies [3395234]
- Updated dependencies [bcdc484]
- Updated dependencies [6300f70]
- Updated dependencies [3f678d4]
- Updated dependencies [ed171d5]
- Updated dependencies [49c2e7d]
- Updated dependencies [de30d6c]
- Updated dependencies [331e3a9]
- Updated dependencies [c40865a]
- Updated dependencies [4399fdb]
- Updated dependencies [4b8d13b]
- Updated dependencies [4b8d13b]
- Updated dependencies [4b8d13b]
- Updated dependencies [fbd42fc]
- Updated dependencies [63d1aef]
- Updated dependencies [6be2e95]
- Updated dependencies [819de09]
- Updated dependencies [be08686]
- Updated dependencies [112b9f2]
- Updated dependencies [893025e]
- Updated dependencies [ed888e2]
- Updated dependencies [2e05e27]
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
- Updated dependencies [b12e19b]
- Updated dependencies [ed7f6f6]
- Updated dependencies [0bad534]
- Updated dependencies [7a1d4a9]
- Updated dependencies [84f595a]
- Updated dependencies [d2cb9ba]
- Updated dependencies [10eae9a]
- Updated dependencies [bbb1ea4]
- Updated dependencies [22c6c06]
- Updated dependencies [df9a7d0]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/cli@1.0.0-beta.16
  - @ontrails/permits@1.0.0-beta.16
  - @ontrails/store@1.0.0-beta.16
  - @ontrails/topographer@1.0.0-beta.16

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
  - @ontrails/permits@1.0.0-beta.15
  - @ontrails/topographer@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/core@1.0.0-beta.14
  - @ontrails/schema@1.0.0-beta.14

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
  - @ontrails/schema@1.0.0-beta.13

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
  - @ontrails/schema@1.0.0-beta.12

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
  - @ontrails/schema@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Cleanup and hardening pass across all packages.

  **core**: Deduplicate `RunOptions` as type alias of `ExecuteTrailOptions`. Replace `TrailContext` index signature with typed `extensions` field for type safety. Deep-merge `extensions` in `executeTrail` context resolution. Remove unused `Trailhead` type and proof-of-concept files from published package.

  **cli**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out via `validate: false`.

  **http**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **mcp**: Remove vestigial `kind` checks from build. Run `validateTopo()` automatically in `trailhead()` with opt-out.

  **warden**: Project-aware rule context preserved in trail wrappers.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10
  - @ontrails/schema@1.0.0-beta.10

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
  - @ontrails/schema@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.8
  - @ontrails/core@1.0.0-beta.8

## 1.0.0-beta.7

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.7
  - @ontrails/core@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Fix Codex review findings on type-utils and cross-declarations.

  **core**: `inputOf()`/`outputOf()` now preserve the exact Zod schema subtype instead of widening to `z.ZodType`.

  **warden**: `cross-declarations` rule now recognizes single-object trail overload, detects any context parameter name (not just `ctx`), matches destructured `cross()` calls, resolves const identifiers in `crosses` arrays, and restricts blaze body extraction to top-level config properties.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.6
  - @ontrails/schema@1.0.0-beta.6

## 1.0.0-beta.5

### Minor Changes

- Type utilities and cross-declarations warden rule.

  **core**: Add `TrailInput<T>`, `TrailOutput<T>` utility types and `inputOf()`, `outputOf()` runtime schema accessors.

  **warden**: Add `cross-declarations` rule — statically analyzes `ctx.cross()` calls against declared `crosses: [...]` arrays. Errors on undeclared calls, warns on unused declarations.

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.5
  - @ontrails/schema@1.0.0-beta.5

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
  - @ontrails/schema@1.0.0-beta.4

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
  - @ontrails/schema@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- Updated dependencies
  - @ontrails/core@1.0.0-beta.2
  - @ontrails/schema@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)
- Updated dependencies
  - @ontrails/core@1.0.0-beta.1
  - @ontrails/schema@1.0.0-beta.1

## 1.0.0-beta.0

### Minor Changes

- Initial v1 beta release of the Trails framework.

  - **@ontrails/core** — Result type, error taxonomy, trail/hike/signal/topo, validateTopo, validateInput/Output, deriveFields, patterns, redaction, branded types, resilience
  - **@ontrails/cli** — CLI trailhead connector, Commander integration, flag derivation
  - **@ontrails/mcp** — MCP trailhead connector, tool generation, annotations, progress bridge
  - **@ontrails/logging** — Structured logging, sinks, formatters, LogTape connector
  - **@ontrails/testing** — testAll, testExamples, testTrail, testHike, testContracts, testDetours, trailhead harnesses
  - **@ontrails/warden** — AST-based code convention rules via oxc-parser, drift detection, CI formatters
  - **@ontrails/schema** — Trailhead map generation, hashing, semantic diffing

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.0
  - @ontrails/schema@1.0.0-beta.0
