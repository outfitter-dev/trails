# trails

## 1.0.0-beta.16

### Major Changes

- abc8c68: Move the brief capability report from the bare `survey` flag surface to the role-anchored `survey.brief` trail.
- 04e2a2e: Move saved contract diffing from the bare `survey` flag surface to the `survey.diff` trail, with optional `against` targets and `breakingOnly` filtering.
- ed171d5: Split `trails survey` detail inspection into role-anchored `survey.trail`, `survey.resource`, and `survey.signal` trails while keeping bare `survey <id>` as an all-kinds lookup. Remove the temporary `survey --openapi` and `topo.show` CLI shapes. CLI command projection now supports executable parent commands with positional arguments alongside child commands.
- de30d6c: Introduce `topo.compile` as the canonical trail for writing `.trails` lockfile
  and surface artifacts, remove the `survey --generate` mode, and update drift
  guidance to point at the compile command.
- 938f005: Cut CLI topo compile and survey diff surfaces over to the lock v3 artifact family. `topo.compile` now reports `topoPath` for `.trails/topo.lock`, survey diff accepts explicit `topo.lock` files and directories containing `topo.lock`, and new scaffolds no longer ignore committed root lock artifacts.
- 10eae9a: Migrate the Trails workspace to the documented `.trails/` layout: committed `.lock` files at the workspace root, ignored `cache/` for rebuildable derived data, ignored `state/` for mutable runtime state, and `.trails/config.local.{ts,js}` for local overrides. The default SQLite path is now `.trails/state/trails.db`. Workspace bootstrap creates only `cache/` and `state/` — the legacy `dev/` and `generated/` subdirectories are no longer created. Dev reset cleans both the new `.trails/state/` paths and legacy `.trails/trails.db*` and `.trails/dev/tracing.db*` paths for one cycle. Scaffold and workspace gitignores reflect the new layout.

  Workspace bootstrap is now owned by a single canonical source in `@ontrails/core`. The package exposes `ensureTrailsWorkspace()`, `WORKSPACE_GITIGNORE_CONTENT`, and `WORKSPACE_GITIGNORE_LINES`. `@ontrails/config` no longer exports its own `ensureWorkspace` (consumers should import from `@ontrails/core`). `trails create` now writes `.trails/.gitignore` during scaffolding so a fresh-scaffolded project's initial commit includes the workspace gitignore (resolves TRL-703).

### Minor Changes

- a18a25d: Update `trails warden` to use the shared `@ontrails/warden` command surface and final Sprint 1 flags.

  The integrated CLI now projects `--ci`, `--pre-push`, `--depth`, `--fail-on`, `--strict`, `--format`, `--lock`, `--drafts`, `--apps`, `--no-lock-mutation`, and the local Warden aliases into the same runner used by the package `warden` bin. The old `lintOnly`, `driftOnly`, and `tier` inputs are replaced by `--depth` and `--lock` semantics.

- 3b5697a: Add the `run` trail family to `apps/trails` for direct trail invocation by ID. `trails run <id> '<inline-json>'` resolves the trail in the current app's topo and executes it through the shared `run()` pipeline from `@ontrails/core`, returning a typed direct-invocation envelope. `run.examples` lists authored examples and `run.example` executes one named example with an actual-vs-expected comparison. Single-app resolution only on this branch; multi-app workspace resolution plus `--app` override land in TRL-406. Not-found maps to `Result.err(NotFoundError)` and CLI exit code 2 via the existing error taxonomy. Self-hosted: the trail family authors happy-path and not-found examples, exercised by `testExamples(app)`.
- fbd42fc: Unify structured CLI input around `--input <path|->` and `--input-json`.
  `--input` reads JSON from a file path or from stdin when the value is `-`;
  `--input-file`, `--stdin`, and the `structuredInputFieldByTrail` routing
  option are removed. Structured payloads now merge directly into each trail's
  typed input object, so `trails run` callers provide the inner trail payload
  under the run trail's `input` field.
- 63d1aef: Add `--quiet` / `-q` flag to strip the `inner-trail-result` envelope from `trails run` stdout. On success, stdout becomes the inner value JSON only (no `{ kind, trailId, value }` wrapper). Composes with `--json` / `--jsonl` (those control format; `--quiet` controls envelope vs unwrapped). Wired as a global CLI flag via `outputModePreset()` so all commands surface it; the run-trail-specific unwrap logic lives in `apps/trails/src/cli.ts` next to the existing collision-recovery wrapper.
- 5a3c245: Add `run.example` for named example execution. It loads a named example, executes the inner trail with the example's input, and compares actual vs expected per the example's contract (`expected` deep-equal, `expectedMatch` partial-match, or `error` class match). Returns a structured `RunExampleComparison` envelope with input/expected/actual/match/diff. The CLI surface helper prints an OK summary on match (exit 0), or a diff and `ValidationError` on mismatch (exit 1). Unknown example names produce `NotFoundError` (exit 2) with the available examples listed.
- 93e9d44: Add `run.examples` for listing a trail's examples without executing. The split run family gives examples listing its own typed input and structured `RunExamplesListing` output (`{ kind: 'examples-listing', trailId, examples }`) instead of adding an `--examples` mode flag to `run`. The CLI surface helper formats text-mode tables (name + truncated input + outcome) and unwraps to a JSON/JSONL array when `--json`/`--jsonl` is set. Trails with no examples emit `No examples defined` (text) or `[]` (JSON). Unknown trail IDs still surface `NotFoundError` (exit code 2).
- 8f5bda0: Wire workspace topo discovery into the `run` trail with collision UX. `run` accepts an optional `app?: string` input that auto-projects as `--app <name>` on the CLI. Resolution flow: `--app` provided → use it; else if the trail ID is unambiguous in the workspace index → use the single owning app; else if colliding → return `Result.err(AmbiguousError)` whose message names the candidates and suggests `--app`. The CLI surface adds a TTY-aware bridge (`tryRecoverFromRunCollision`) that prompts via clack when stdin is a TTY and the trail returned an `AmbiguousError`, then re-executes with the chosen app. Non-TTY contexts surface the error and exit with code 1. Trail logic stays surface-agnostic; TTY detection and prompts live in the CLI bridge.
- c8caa5e: Wire the `--trace` flag for the `trails run` family. Adds `tracePreset()` to `@ontrails/cli` (registered via the `presets` option) and threads `'trace'` through `META_FLAG_CANDIDATES` so the flag is treated as CLI metadata (never routed into trail input). On activation, `apps/trails/src/cli.ts` installs a per-invocation memory sink before `surface()` runs and finalizes it in a `finally` block: the post-execution tree (rendered via `renderTraceTree` from TRL-411) goes to stderr; the result still goes to stdout. With `--trace --json`, regular `trails run <id>` emits a single JSON envelope on stdout that includes `tracing: TraceRecord[]`; `trails run example <id> <exampleName>` keeps its comparison envelope, and `trails run examples <id>` remains a metadata read. `--quiet` keeps the tree on stderr and the unwrapped value on stdout, while `--jsonl` streams items as before. Sink registration is per-invocation so concurrent runs don't bleed records.
- f4b90c9: Add `--watch` for the `trails run` family. File-system events are cheap wake-ups; the rerun gate compares the resolved trail's surface-map entry hash so edits only rerun when the public contract for the watched trail changes. New `watchPreset()` exposes the boolean flag; `'watch'` is added to `META_FLAG_CANDIDATES` so the flag never routes into trail input. The watch loop in `apps/trails/src/run-watch.ts` runs once, then sets up a debounced (`100ms`) `node:fs.watch` filtered to `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` extensions in the trail's source directory. SIGINT closes the watcher cleanly. A short startup warmup window (`150ms`) suppresses the macOS FSEvents replay event that would otherwise produce a phantom rerun on first invocation.
- 2a2e072: Compose `--watch` with the split `run example` command and `--trace` cleanly. Moves the `--trace` session install/finalize bracket inside `runSurfaceOnce` so each watch rerun gets a fresh memory sink and stderr tree (previously the sink was process-scoped and accumulated records across reruns, suppressing the per-rerun tree until SIGINT). Adds integration tests covering the example-comparison rerun loop, trace-record freshness across reruns, and error recovery (a thrown rerun does not exit the watch loop). Documents the TDD-in-terminal workflow in the Direct Invocation ADR draft.
- 85c39c4: Add shell completion infrastructure and trail-ID completion. New `apps/trails/src/completions.ts` exposes `renderCompletionScript('bash' | 'zsh' | 'fish', binName)` and `renderTrailIdCompletions(workspaceRoot, prefix)` (reads the workspace topo via `buildWorkspaceTrailIndex`). Two new trails register on the topo: `completions` (returns the completion script for a chosen shell) and `completions.__complete` (the dynamic suggestion endpoint that the static script delegates to at tab-press time). Per-shell logic lives in a `Record<CompletionShell, ScriptRenderer>` lookup; the dynamic dispatch table is keyed by subcommand so TRL-416 (example-name completion) lands as a new entry.
- 6f5bf81: Add example-name completion to the dynamic suggestion endpoint. When the user tab-completes the example-name argument in `trails run example <trail-id> <prefix>`, the completion returns the named trail's `examples` array (filtered by prefix, sorted). New `renderTrailExampleCompletions(workspaceRoot, trailId, prefix)` helper resolves the trail's owning app via the workspace index, loads the topo with `tryLoadFreshAppLease`, and derives examples via `deriveStructuredTrailExamples`. Recoverable load/lookup failures return typed `RecoverableCompletionError` values from the helper and are suppressed to `[]` only at the internal `completions.__complete` shell boundary so tab completion stays quiet.
- 3d4e921: Add `trails completions install [--shell bash|zsh|fish]` for installing the completion script to the standard per-shell location. This is a CLI bridge command, not a topo trail: it uses `renderCompletionScript`, auto-detects `$SHELL` when `--shell` is omitted, creates parent directories as needed, and writes to:

  - bash → `~/.local/share/bash-completion/completions/trails`
  - zsh → `~/.local/share/zsh/site-functions/_trails` (user must add to `$fpath` if not already)
  - fish → `~/.config/fish/completions/trails.fish`

  Output reports `{ shell, path, created, message }`. Idempotent — second run reports `created: false` and overwrites with the freshest script. Detection failure (missing/unsupported `$SHELL`) returns `Result.err(ValidationError)` with a message naming the supported shells. Test seam allows injecting `homeDir` and `shellEnv` so the trail never mutates global state.

- 863d473: Add three attachment scopes for typed layers — trail, surface, topo — with composition order **topo → surface → trail → blaze**. `TrailSpec` and `Trail` gain `layers?: readonly Layer[]` (default `[]`). `topo()` accepts `{ layers: [...] }` as the third options argument; the topo carries those layers and they reach the executor via `ExecuteTrailOptions.topoLayers`. The CLI's `surface()`/`createProgram()`/`deriveCliCommands` already supports a `layers` option; that now flows through `runTrailOnce` as `surfaceLayers`. The executor builds the layer chain `[...topoLayers, ...surfaceLayers, ...trail.layers, ...options.layers]` so topo wraps surface wraps trail wraps blaze (verified by composition-order tests at every level). Survey's `TrailDetailReport` adds `composedLayers: { topo, surface, trail }` so agents can introspect the layer chain per trail. Backward-compatible: every new field is optional with a non-undefined default; existing call sites are unchanged.
- 802fdfc: Rename Warden guide manifest rule grouping from `category` to `concern` so the
  public JSON contract matches the source metadata field.
- f6fdc62: Add structured Warden remediation guidance to rule metadata, diagnostics, report output, and the `trails warden` result schema.
- a10ffa4: Add a Warden guide manifest projection and expose it through `trails warden guide` in markdown, agent-json, and manifest formats.

### Patch Changes

- 73622ae: Thread `ResourceSpec.config` through the built-in auth resource. Resource config schemas that accept `undefined` now receive their parsed default when config values are omitted, and `authResource` can materialize the no-op or JWT adapter from typed config while preserving existing mock and override paths.
- 25f3c5c: Add the dedicated `@ontrails/commander` adapter package and move the Commander runtime out of the `@ontrails/cli/commander` subpath. Extend the repo-local package-source guardrails to cover adapter package source as the Commander runtime moves under `adapters/`.
- f20cb51: Update generated CLI scaffolds and current-facing docs to use the dedicated `@ontrails/commander` adapter package.
- 20d7a5c: Enforce the shared safe error projection policy for public error bodies, diagnostics, serialized payloads, and CLI stderr.
- e898cc4: Add repo-level Knip dead-code detection and remove stale internal exports and unused package dependencies surfaced by the new check.
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

- 3395234: Move store adapter-binding helpers to `@ontrails/store/adapter-support` and topographer direct database/admin helpers to `@ontrails/topographer/backend-support`, keeping root exports focused on contract-level APIs.
- d40430d: Remove the retired `@ontrails/logging` workspace from the prerelease package set. Use `@ontrails/observe` for log and trace sink contracts and `@ontrails/logtape` for LogTape forwarding.
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
- dbd17db: Remove the unused legacy `@ontrails/logging` dependency from the Trails CLI app package.
- 2dd9cda: Promote ADR-0043 (Layer Evolution) from draft to accepted, amend it on 2026-05-04 to remove the briefly proposed `Middleware` split, and publish the Layer Evolution Migration Guide at `docs/migration/layer-evolution.md`.

  Documentation-only change capturing the post-implementation state of the layer-evolution work shipped across TRL-471 through TRL-476: typed `Layer` primitive with optional `input` schema, three attachment scopes (trail, surface, topo), CLI/MCP/HTTP surface projection of layer inputs, removal of `authLayer`, `autoIterateLayer`, and `dateShortcutsLayer`, and warden coaching via `no-legacy-layer-imports` (error). The migration guide is the durable countermeasure to the vocabulary churn flagged in ADR-0043's tradeoffs.

- ed7f6f6: Expand topo-store and survey trail detail records with resolved TopoGraph contract facts for blind-agent review.
- fb10112: Polish Warden guidance projection by preserving labels in plain-text doc links
  and reusing the shared diagnostic schema from the Trails CLI wrapper.
- 7a1d4a9: Rename the public resolved graph API from `SurfaceMap` to `TopoGraph`, including
  the derive, hash, diff, and current graph artifact I/O helpers.
- 84f595a: Add lock v3 manifest and `topo.lock` I/O. `trails.lock` now reads as a compact v3 manifest that points at the serialized TopoGraph artifact, and legacy v2/hash-only lock inputs fail with a regenerate instruction.
- d2cb9ba: Rename topo-store export artifacts from surface-era names to TopoGraph names. The `topo_exports` table now stores `topo_graph`, `topo_graph_hash`, and `lock_manifest`, and backend-support export records expose `topoGraphJson`, `topoGraphHash`, and `lockManifestJson`.
- 8ddf5ff: Extend `runWarden` into the shared Warden orchestration entrypoint with effective config resolution, depth/fail thresholds, rule facets, and multi-topo report metadata.

  Adapt the built-in `trails warden` wrapper to consume the readonly Warden report diagnostics contract without weakening its output schema.

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
- Updated dependencies [a8997ed]
- Updated dependencies [fe03945]
- Updated dependencies [2bf239e]
- Updated dependencies [200bece]
- Updated dependencies [e4beec9]
- Updated dependencies [3395234]
- Updated dependencies [d40430d]
- Updated dependencies [bcdc484]
- Updated dependencies [3f678d4]
- Updated dependencies [ed171d5]
- Updated dependencies [49c2e7d]
- Updated dependencies [de30d6c]
- Updated dependencies [331e3a9]
- Updated dependencies [c40865a]
- Updated dependencies [4399fdb]
- Updated dependencies [578e674]
- Updated dependencies [4b8d13b]
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
- Updated dependencies [ad553a6]
- Updated dependencies [2dd9cda]
- Updated dependencies [b12e19b]
- Updated dependencies [ed7f6f6]
- Updated dependencies [fb10112]
- Updated dependencies [802fdfc]
- Updated dependencies [0bad534]
- Updated dependencies [bfabe09]
- Updated dependencies [7a1d4a9]
- Updated dependencies [84f595a]
- Updated dependencies [d2cb9ba]
- Updated dependencies [2cc05da]
- Updated dependencies [10eae9a]
- Updated dependencies [bbb1ea4]
- Updated dependencies [22c6c06]
- Updated dependencies [767eb41]
- Updated dependencies [82019a7]
- Updated dependencies [f6fdc62]
- Updated dependencies [a10ffa4]
- Updated dependencies [df9a7d0]
- Updated dependencies [7085f01]
- Updated dependencies [30a2c7e]
- Updated dependencies [81bffec]
- Updated dependencies [8ddf5ff]
- Updated dependencies [f5b6112]
- Updated dependencies [d675a53]
  - @ontrails/core@1.0.0-beta.16
  - @ontrails/cli@1.0.0-beta.16
  - @ontrails/permits@1.0.0-beta.16
  - @ontrails/commander@1.0.0-beta.16
  - @ontrails/warden@1.0.0-beta.16
  - @ontrails/observe@1.0.0-beta.16
  - @ontrails/tracing@1.0.0-beta.16
  - @ontrails/topographer@1.0.0-beta.16

## 1.0.0-beta.15

### Patch Changes

- 2003fa5: Prepare the Trails CLI for beta.15 release publishing: derive the CLI version from package metadata, scaffold publishable package ranges, add HTTP surface generation, include the scaffold toolchain dependencies, and avoid generating unsupported Warden flags.
- Updated dependencies [4ad6b25]
  - @ontrails/core@1.0.0-beta.15
  - @ontrails/cli@1.0.0-beta.15
  - @ontrails/tracing@1.0.0-beta.15
  - @ontrails/warden@1.0.0-beta.15
  - @ontrails/observe@1.0.0-beta.15
  - @ontrails/topographer@1.0.0-beta.15

## 1.0.0-beta.14

### Minor Changes

- 69057e9: Add hierarchical CLI command trees and structured input, enforce established-only topo exports across trailheads, move developer topo and tracker state onto shared `trails.db` with pins and maintenance flows, and ship schema-derived stores through `@ontrails/store` and its Drizzle runtime.

### Patch Changes

- Updated dependencies [69057e9]
  - @ontrails/cli@1.0.0-beta.14
  - @ontrails/core@1.0.0-beta.14
  - @ontrails/logging@1.0.0-beta.14
  - @ontrails/schema@1.0.0-beta.14
  - @ontrails/tracker@1.0.0-beta.14
  - @ontrails/warden@1.0.0-beta.14

## 1.0.0-beta.13

### Patch Changes

- Updated dependencies [6944147]
- Updated dependencies
  - @ontrails/core@1.0.0-beta.13
  - @ontrails/cli@1.0.0-beta.13
  - @ontrails/schema@1.0.0-beta.13
  - @ontrails/warden@1.0.0-beta.13
  - @ontrails/logging@1.0.0-beta.13

## 1.0.0-beta.12

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.12
  - @ontrails/cli@1.0.0-beta.12
  - @ontrails/logging@1.0.0-beta.12
  - @ontrails/schema@1.0.0-beta.12
  - @ontrails/warden@1.0.0-beta.12

## 1.0.0-beta.11

### Patch Changes

- Add services as a first-class primitive.

  Services make infrastructure dependencies declarative, injectable, and governable. Define a service with `provision()`, declare it on a trail with `provisions: [db]`, and access it with `db.from(ctx)` or `ctx.provision()`.

  **Core:** `provision()` factory, `ServiceSpec<T>`, `ServiceContext`, singleton resolution in `executeTrail`, in-flight creation dedup, `isService` guard, `findDuplicateServiceId`, topo service discovery and validation, `services` field on trail specs.

  **Testing:** Auto-resolution of `mock` factories in `testAll`, `testExamples`, `testContracts`, and `testCrosses`. Explicit `services` overrides with correct precedence (`explicit > ctx.extensions > auto-mock`). Service mock propagation through crossing graphs.

  **Warden:** `service-declarations` rule validates `db.from(ctx)` and `ctx.provision()` usage matches declared `provisions: [...]`. `service-exists` rule validates declared service IDs resolve in project context. Scope-aware AST walking skips nested function boundaries.

  **Trailheads:** Service overrides thread through `run` and `trailhead` on CLI, MCP, and HTTP.

  **Introspection:** Survey and trailhead map outputs include service graph. Topo exposes `.services`, `.getService()`, `.hasService()`, `.listServices()`, `.serviceIds()`, `.serviceCount`.

  **Docs:** ADR-009 accepted. Unified services guide, updated vocabulary, getting-started, architecture, and package READMEs.

- Updated dependencies
  - @ontrails/core@1.0.0-beta.11
  - @ontrails/warden@1.0.0-beta.11
  - @ontrails/cli@1.0.0-beta.11
  - @ontrails/schema@1.0.0-beta.11
  - @ontrails/logging@1.0.0-beta.11

## 1.0.0-beta.10

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.10
  - @ontrails/cli@1.0.0-beta.10
  - @ontrails/warden@1.0.0-beta.10
  - @ontrails/logging@1.0.0-beta.10
  - @ontrails/schema@1.0.0-beta.10

## 1.0.0-beta.9

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.9
  - @ontrails/cli@1.0.0-beta.9
  - @ontrails/schema@1.0.0-beta.9
  - @ontrails/warden@1.0.0-beta.9
  - @ontrails/logging@1.0.0-beta.9

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.8
  - @ontrails/cli@1.0.0-beta.8
  - @ontrails/core@1.0.0-beta.8
  - @ontrails/logging@1.0.0-beta.8
  - @ontrails/warden@1.0.0-beta.8

## 1.0.0-beta.7

### Minor Changes

- HTTP trailhead and OpenAPI generation.

  **http**: New `@ontrails/http` package — Hono-based HTTP connector. `trailhead()` derives routes from trail IDs, maps intent to HTTP verbs (read→GET, write→POST, destroy→DELETE), and maps error taxonomy to status codes. Returns the Hono instance.

  **schema**: Add `generateOpenApiSpec(topo)` — generates a complete OpenAPI 3.1 spec from the topo. Each trail becomes an operation with path, method, schemas, and error responses derived from the contract.

  **trails**: `trails survey --openapi` outputs the OpenAPI spec for any Trails app.

### Patch Changes

- Updated dependencies
  - @ontrails/schema@1.0.0-beta.7
  - @ontrails/warden@1.0.0-beta.7
  - @ontrails/cli@1.0.0-beta.7
  - @ontrails/core@1.0.0-beta.7
  - @ontrails/logging@1.0.0-beta.7

## 1.0.0-beta.6

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.6
  - @ontrails/warden@1.0.0-beta.6
  - @ontrails/cli@1.0.0-beta.6
  - @ontrails/logging@1.0.0-beta.6
  - @ontrails/schema@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.5
  - @ontrails/warden@1.0.0-beta.5
  - @ontrails/logging@1.0.0-beta.5
  - @ontrails/schema@1.0.0-beta.5
  - @ontrails/cli@1.0.0-beta.5

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
  - @ontrails/warden@1.0.0-beta.4
  - @ontrails/schema@1.0.0-beta.4
  - @ontrails/logging@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.3
  - @ontrails/cli@1.0.0-beta.3
  - @ontrails/warden@1.0.0-beta.3
  - @ontrails/logging@1.0.0-beta.3
  - @ontrails/schema@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- Fix workspace dependency resolution in published packages. Now using bun publish
  which correctly replaces workspace:^ with actual version numbers.
- Updated dependencies
  - @ontrails/core@1.0.0-beta.2
  - @ontrails/cli@1.0.0-beta.2
  - @ontrails/logging@1.0.0-beta.2
  - @ontrails/warden@1.0.0-beta.2
  - @ontrails/schema@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Fix two blocking bugs from real-world migration:
  - Published packages now resolve correctly (workspace:^ instead of workspace:\*)
  - Error forwarding works across different success types (Err no longer carries phantom T)
- Updated dependencies
  - @ontrails/core@1.0.0-beta.1
  - @ontrails/cli@1.0.0-beta.1
  - @ontrails/logging@1.0.0-beta.1
  - @ontrails/warden@1.0.0-beta.1
  - @ontrails/schema@1.0.0-beta.1

## 0.1.1-beta.0

### Patch Changes

- Updated dependencies
  - @ontrails/core@1.0.0-beta.0
  - @ontrails/cli@1.0.0-beta.0
  - @ontrails/logging@1.0.0-beta.0
  - @ontrails/warden@1.0.0-beta.0
  - @ontrails/schema@1.0.0-beta.0
