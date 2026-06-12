# @ontrails/warden

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
