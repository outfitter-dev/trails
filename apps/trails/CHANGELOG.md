# trails

## 1.0.0-beta.22

### Patch Changes

- cdee4d0: Emit formatter-clean fresh scaffold files so generated apps pass their own
  `format:check` script before any manual cleanup.
  - @ontrails/commander@1.0.0-beta.22
  - @ontrails/adapter-kit@1.0.0-beta.22
  - @ontrails/cli@1.0.0-beta.22
  - @ontrails/core@1.0.0-beta.22
  - @ontrails/http@1.0.0-beta.22
  - @ontrails/mcp@1.0.0-beta.22
  - @ontrails/observe@1.0.0-beta.22
  - @ontrails/permits@1.0.0-beta.22
  - @ontrails/topographer@1.0.0-beta.22
  - @ontrails/tracing@1.0.0-beta.22
  - @ontrails/warden@1.0.0-beta.22
  - @ontrails/wayfinder@1.0.0-beta.22

## 1.0.0-beta.21

### Minor Changes

- bb5a219: Add the public `create.versions` trail (`trails create versions`). Scaffold dependency version derivation graduates from `scripts/sync-scaffold-versions.ts` into the `create` surface: check mode verifies `apps/trails/src/scaffold-versions.generated.ts` is current, write mode regenerates it, and the root script remains as a thin compatibility wrapper.

### Patch Changes

- 4c0041c: Expose `wayfind.errors` and `wayfind.adapters` as read-only direct tools on the Trails operator MCP surface.
- 4cca012: Add the `wayfind.errors` graph-read trail and expose it through the Trails CLI for local error-fact inspection.
- 708b861: Expose `wayfind.adapters` over adapter-kit fact reports and add it to the Trails operator CLI Wayfinder surface.
- b6579b8: Expose selected Wayfinder graph-read queries through the local `trails wayfind` CLI command group for dogfooding saved topo artifacts.
- 52e15bc: Repair fresh app loading so mirrored workspace modules can resolve first-party workspace packages and their installed package dependencies from the mirror.
- d4ec336: Add a repo-level Wayfinder dogfood smoke command that exercises the local
  Trails CLI against exported operator topo artifacts.
- 0d1472a: Expose release rules config helpers from `@ontrails/trails/release` so
  projects can compose release policy into `trails.config.ts`.
- 8f681ae: Move release rule evaluation into the Trails app package and export the
  release check and public trail contract fact helpers from
  `@ontrails/trails/release`.
- 9e77ae1: Expose release rule evaluation through the `trails release check` command and
  the Trails MCP operator surface, with JSON output available through the shared
  CLI output mode.
- fd676c4: Expose the native Bun release binding from `@ontrails/trails/release` and keep publish and registry scripts as compatibility wrappers.
- 0ccb3e5: Add `release.smoke` as the public Trails release confidence surface for packed artifact and Wayfinder dogfood checks.
- Updated dependencies [99523f2]
- Updated dependencies [5e301d2]
- Updated dependencies [4cca012]
- Updated dependencies [3caa263]
- Updated dependencies [708b861]
- Updated dependencies [5be032c]
  - @ontrails/core@1.0.0-beta.21
  - @ontrails/permits@1.0.0-beta.21
  - @ontrails/topographer@1.0.0-beta.21
  - @ontrails/wayfinder@1.0.0-beta.21
  - @ontrails/adapter-kit@1.0.0-beta.21
  - @ontrails/warden@1.0.0-beta.21
  - @ontrails/commander@1.0.0-beta.21
  - @ontrails/cli@1.0.0-beta.21
  - @ontrails/http@1.0.0-beta.21
  - @ontrails/mcp@1.0.0-beta.21
  - @ontrails/observe@1.0.0-beta.21
  - @ontrails/tracing@1.0.0-beta.21

## 1.0.0-beta.20

### Minor Changes

- 396136a: Add the Trails operator MCP entrypoint with deferred surface facets and cold-context resources.

### Patch Changes

- 851a2a3: Derive trail caller and blaze input types from the authored input schema while keeping one public input contract.
- d89a889: Project selected Wayfinder graph-read trails into the Trails operator MCP surface alongside clearer first-class operator tools.
- f67cd2a: Document Wayfinder as a real graph-read query catalog instead of a shell-only
  package, including MCP exposure guidance, agent skill guidance, and release
  notes for the v0 catalog and its deferred non-goals.
- Updated dependencies [851a2a3]
- Updated dependencies [eee1307]
- Updated dependencies [9bec01c]
- Updated dependencies [accb9ec]
- Updated dependencies [8bc0708]
- Updated dependencies [6901776]
- Updated dependencies [f67cd2a]
- Updated dependencies [c65c465]
- Updated dependencies [38f62f8]
- Updated dependencies [b248d4a]
- Updated dependencies [5364df1]
- Updated dependencies [2067441]
- Updated dependencies [6c3296c]
  - @ontrails/core@1.0.0-beta.20
  - @ontrails/warden@1.0.0-beta.20
  - @ontrails/topographer@1.0.0-beta.20
  - @ontrails/adapter-kit@1.0.0-beta.20
  - @ontrails/mcp@1.0.0-beta.20
  - @ontrails/wayfinder@1.0.0-beta.20
  - @ontrails/commander@1.0.0-beta.20
  - @ontrails/cli@1.0.0-beta.20
  - @ontrails/http@1.0.0-beta.20
  - @ontrails/observe@1.0.0-beta.20
  - @ontrails/permits@1.0.0-beta.20
  - @ontrails/tracing@1.0.0-beta.20

## 1.0.0-beta.19

### Major Changes

- 1eb5bdc: Rename first-class trail composition from the `cross` API family to the `compose` family across core contracts, testing helpers, topo projections, Warden rules, CLI scaffolds, and docs. `composes`, `ctx.compose`, `composeInput`, and `Compose*` type names are now the public authoring vocabulary; topo persistence migrates legacy composition rows and graph keys forward.
- 120caf5: Promote topo artifact commands to `trails compile` and `trails validate`.

### Patch Changes

- e41c382: Document beta-channel install guidance in package and adapter README install snippets so consumers use explicit `@beta` (or pinned `1.0.0-beta.N`) tags instead of accidental `latest` resolution during the prerelease line. Adds the policy doc at `docs/releases/beta-channel-policy.md`, prints both `latest` and `beta` dist-tags in `bun run publish:registry-check`, and aligns plugin/skill install snippets.
- 14714b8: Add a beta.15 to beta.19 downstream migration guide (`docs/releases/beta15-to-beta19.md`) that ties together package install, CLI/MCP/HTTP surface decisions, public output schemas, contract testing, resource mocks / `unmockable`, error taxonomy, observability, Topographer artifact workflow, layer evolution, the `cross`→`compose` composition rename, trail-versioning runtime adoption, and adapter authoring. Linked from `docs/index.md` Release Notes and cross-references the focused migration guides under `docs/migration/`.
- 91328d3: Make `trails create` reruns reconcile existing scaffold files instead of overwriting present files and then failing on existing surfaces.
- 6471b73: Preserve the original `create.scaffold` Result boundary when `trails create` cannot scaffold a project.
- 51aac45: Add `entity.list` and `entity.delete` trails to the generated entity starter so fresh scaffolds model complete CRUD coverage.
- 5efa32c: Generate project-level `AGENTS.md` and `CLAUDE.md` guidance so new Trails apps
  start with canonical agent instructions.
- 88c0316: Generate a contextual `README.md` for new Trails projects with first-run
  commands, selected surfaces, starter notes, and agent guidance pointers.
- 99154d4: Generate `tsconfig.tests.json` in new Trails projects so root test files are
  covered by editor TypeScript tooling without changing build output.
- 492f71c: Move CLI, MCP, HTTP, established-surface, and surface-parity helpers behind explicit subpaths so root contract testing imports no longer require optional surface peers. The Trails CLI scaffolder now emits `import { testAllEstablished } from '@ontrails/testing/established'` for generated verification.
- 4bc8a99: Clarify the Topographer artifact workflow around top-level `trails compile`, `trails validate`, and `trails diff` commands, including explicit diagnostics for retired `trails topo compile`, `trails topo verify`, and `trails topo check` attempts.
- 16cb740: Run examples and contract checks across live trail version entries, and project version-entry example coverage into topo and survey reports.
- 92e709b: Declare explicit permit scopes on mutating built-in CLI trails and scaffolded entity starter trails.

  Preserve the resolved CLI permit on result callbacks so run-collision recovery can re-execute protected trails without losing authorization context.

- 1f48342: Preserve original Result error boundaries in CLI trails by returning existing Result failures directly instead of re-wrapping their errors.
- c14aa3a: Report structured entry and graph force audit details from `trails doctor`.
- 2df73cc: Configure scaffolded Trails projects to allow `TODO :::` fieldwork markers while keeping standard `TODO:` warning comments blocked.
- 7f50fe2: Add version lifecycle CLI trails for revising, deprecating, archiving, and diagnosing trail version entries.
- 653d1fc: Add a top-level `trails diff` command and extend TopoGraph diffs with version, marker, lifecycle status, support set, and force-event audit details.
- 2e76288: Add graph-only force event projection for forced compile break acceptance and block unforced breaking topo changes.
- 52e4e8f: Add the `@ontrails/trails` CLI package and core framework command scripts to newly scaffolded projects.
- 58be821: Generated projects now pin `@ontrails/*` packages to the exact scaffolded
  package version instead of emitting caret prerelease ranges.
- da7cbcb: Generated projects now include a minimal `.trails/scaffold.json` provenance
  breadcrumb recording the scaffold schema version, package version, starter
  template, and generation timestamp.
- fc00aeb: Add adapter target conformance metadata and scaffold extracted HTTP adapters through `trails create adapter`.
- 1c975c3: Define the Warden fix-metadata contract (`WardenFix`, `WardenFixCapability`, `WardenFixClass`, `WardenFixSafety`, `WardenFixEdit`) with optional `fix` metadata on diagnostics and rule metadata, projected through the guide, manifest, markdown, and agent guidance. Export `wardenFixClasses`/`wardenFixSafeties` value arrays and surface the rule `fix` capability in the `warden.guide` trail output schema. Dormant until a rule declares it.
- d5d518e: Add `warden --fix` to apply safe source fixes. The executor applies only `safety: 'safe'` edits last-to-first, re-reading and rewriting affected files, while review-required, edit-less, and topo diagnostics stay reported but unapplied. The report surfaces applied, changed-file, and skipped counts.

  Expose `fix` through the Trails app wrapper and mark the `warden` trail as write intent with explicit public access because `fix: true` mutates source files while the local governance command remains directly runnable.

- 678cb1c: Expose the shared adapter readiness engine through Warden's opt-in
  `--adapter-check` diagnostics and the local `trails adapter check` authoring
  workflow.
- 619cb15: Add a Warden rule (`no-destructured-compose`) that coaches trail blazes to call `ctx.compose(...)` directly instead of destructuring `compose` from the context.

  Keep the generated `create` trail on the direct `ctx.compose(...)` shape so framework-authored trails follow the same composition guidance.

- Updated dependencies [bb81ffe]
- Updated dependencies [e41c382]
- Updated dependencies [ed5926b]
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
- Updated dependencies [f0f7e2f]
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
- Updated dependencies [64fb15a]
- Updated dependencies [653d1fc]
- Updated dependencies [431b04c]
- Updated dependencies [2e76288]
- Updated dependencies [5d88104]
- Updated dependencies [f04a9ef]
- Updated dependencies [fc00aeb]
- Updated dependencies [1c975c3]
- Updated dependencies [48d5ff4]
- Updated dependencies [d5d518e]
- Updated dependencies [216bf10]
- Updated dependencies [ab1c77c]
- Updated dependencies [8ca5b85]
- Updated dependencies [4f43874]
- Updated dependencies [678cb1c]
- Updated dependencies [5874fd6]
- Updated dependencies [619cb15]
- Updated dependencies [4642268]
- Updated dependencies [9bab0cf]
- Updated dependencies [3ceeba8]
- Updated dependencies [beafd03]
- Updated dependencies [7b173e0]
- Updated dependencies [6e50e7b]
- Updated dependencies [48edf8d]
- Updated dependencies [12ffa3b]
- Updated dependencies [2f262f7]
- Updated dependencies [58b01f2]
  - @ontrails/adapter-kit@1.0.0-beta.19
  - @ontrails/core@1.0.0-beta.19
  - @ontrails/cli@1.0.0-beta.19
  - @ontrails/commander@1.0.0-beta.19
  - @ontrails/http@1.0.0-beta.19
  - @ontrails/mcp@1.0.0-beta.19
  - @ontrails/topographer@1.0.0-beta.19
  - @ontrails/warden@1.0.0-beta.19
  - @ontrails/observe@1.0.0-beta.19
  - @ontrails/tracing@1.0.0-beta.19
  - @ontrails/permits@1.0.0-beta.19

## 1.0.0-beta.18

### Patch Changes

- Updated dependencies [c0b2948]
- Updated dependencies [fc3219c]
- Updated dependencies [bc2d327]
- Updated dependencies [bf44972]
- Updated dependencies [57c8672]
- Updated dependencies [510ea50]
- Updated dependencies [e0ae995]
  - @ontrails/http@1.0.0-beta.18
  - @ontrails/observe@1.0.0-beta.18
  - @ontrails/tracing@1.0.0-beta.18
  - @ontrails/commander@1.0.0-beta.18
  - @ontrails/cli@1.0.0-beta.18
  - @ontrails/core@1.0.0-beta.18
  - @ontrails/mcp@1.0.0-beta.18
  - @ontrails/permits@1.0.0-beta.18
  - @ontrails/topographer@1.0.0-beta.18
  - @ontrails/warden@1.0.0-beta.18

## 1.0.0-beta.17

### Patch Changes

- 41276d2: Expose a shipped surface projection inventory through survey output and trail detail reports.
- Updated dependencies [3dc8254]
- Updated dependencies [61497c5]
  - @ontrails/core@1.0.0-beta.17
  - @ontrails/cli@1.0.0-beta.17
  - @ontrails/commander@1.0.0-beta.17
  - @ontrails/http@1.0.0-beta.17
  - @ontrails/mcp@1.0.0-beta.17
  - @ontrails/observe@1.0.0-beta.17
  - @ontrails/permits@1.0.0-beta.17
  - @ontrails/topographer@1.0.0-beta.17
  - @ontrails/tracing@1.0.0-beta.17
  - @ontrails/warden@1.0.0-beta.17

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
