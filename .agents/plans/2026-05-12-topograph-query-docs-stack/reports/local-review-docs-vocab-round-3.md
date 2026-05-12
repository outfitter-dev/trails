# Local Review Round 3: Docs/Vocab/Agent Guidance Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Lane: Docs, lexicon, retired vocabulary guard, and agent guidance for the M4b/V1 stack tip.

## Result

Not clean for P0/P1/P2. I found one P2 in TRL-702: the TopoGraph retired-vocabulary guard is wired into `bun run check`, but it can still be bypassed by whole-file exemptions for active code/test files.

The prior TRL-653 P2 is fixed: active topo-store workflow guidance now says to compile, verify, and commit both `.trails/trails.lock` and `.trails/topo.lock`.

The prior bootstrap-config TRL-702 P2 is partly fixed: `scripts/bootstrap/config.toml` is now line-allowed instead of whole-file excluded. The remaining issue is the same failure mode in other active files.

## Findings

### P2: TopoGraph retired-vocabulary guard still excludes whole active code/test files

Owning branch: TRL-702 (`trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`)

Recommended action: replace the whole-file TopoGraph retired-vocabulary exclusions for active files with exact line-level `allowMatches` or a similarly scoped legacy-context allowance. At minimum, scope the currently legitimate seams in:

- `apps/trails/src/trails/dev-support.ts:263-270`
- `packages/topographer/src/internal/topo-snapshots.ts:321-337`
- `packages/topographer/src/__tests__/topo-store.test.ts:1321-1342`

Keep historical/changelog/ADR/migration directory exclusions as broad historical allowances if desired, but active source and test files should fail loudly when new retired target-state vocabulary is added outside the known migration/reset lines.

Evidence:

- The plan says active docs and guidance must not teach retired names, and it names the legacy reset-file cleanup list as the intentional exemption:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:249`
  - Quote: "Active docs and agent guidance should not teach those names as current target state."
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:295-302`
  - Quote: "Important guard nuance:"
  - Quote: "The legacy reset-file cleanup list in `apps/trails/src/trails/dev-support.ts` is an intentional exemption."
  - Quote: "Exemptions must be explicit and scoped."
  - Quote: "Confirm the new guard is wired into a normal gate."
- The TopoGraph rule still excludes active source/test files by whole path:
  - `scripts/vocab-cutover-map.ts:129-139`
  - Quote: "const topographArtifactFamilyRetiredMentionPaths = ["
  - Quote: "'apps/trails/src/trails/dev-support.ts',"
  - Quote: "'packages/topographer/src/**tests**/topo-store.test.ts',"
  - Quote: "'packages/topographer/src/internal/topo-snapshots.ts',"
- The same rule has line-scoped allowances only for `scripts/bootstrap/config.toml`, proving the engine can model the narrower shape:
  - `scripts/vocab-cutover-map.ts:141-148`
  - Quote: "const legacyBootstrapCleanupMatches = ["
  - Quote: "{ line: 71, path: 'scripts/bootstrap/config.toml' },"
  - Quote: "{ line: 76, path: 'scripts/bootstrap/config.toml' },"
  - `scripts/vocab-cutover-map.ts:296-301`
  - Quote: "allowMatches: legacyBootstrapCleanupMatches,"
- The audit engine treats `excludePaths` as whole-path or directory-prefix exemptions:
  - `scripts/vocab-cutover-audit.ts:32-38`
  - Quote: "globallyExcludedPaths.has(path) ||"
  - Quote: "path === excludedPath || path.startsWith(`${excludedPath}/`)"
- The audit engine only line-scopes entries listed under `allowMatches`:
  - `scripts/vocab-cutover-audit.ts:40-46`
  - Quote: "(allowed) => allowed.path === match.path && allowed.line === match.line"
  - `scripts/vocab-cutover-audit.ts:99-101`
  - Quote: ".filter((match) => !isAllowedMatch(match, rule));"
- Those whole-file excluded active files contain legitimate legacy seams today, which should be line-scoped rather than hiding the rest of each file:
  - `apps/trails/src/trails/dev-support.ts:259-270`
  - Quote: "const RESET_FILES = ["
  - Quote: "Legacy paths (pre-state migration)"
  - Quote: "'.trails/trails.db',"
  - Quote: "'.trails/dev/tracing.db-wal',"
  - `packages/topographer/src/internal/topo-snapshots.ts:321-337`
  - Quote: "if (currentVersion < 12) {"
  - Quote: "renameColumnIfNeeded(db, 'topo_exports', 'surface_map', 'topo_graph');"
  - Quote: "'serialized_lock',"
  - Quote: "'lock_manifest'"
  - `packages/topographer/src/__tests__/topo-store.test.ts:1321-1342`
  - Quote: "db.run(`CREATE TABLE topo_exports ("
  - Quote: "surface_map TEXT NOT NULL,"
  - Quote: "serialized_lock TEXT NOT NULL"
  - Quote: "'lock_manifest',"
  - Quote: "'surface_map',"
  - Quote: "'serialized_lock',"
- The false-clean behavior is observable:
  - Command: `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json`
  - Output: `"fileCount": 0`, `"matches": []`, `"total": 0`
  - Command: `rg -n "SurfaceMap|_surface\.json|surface_map|serialized_lock|\.trails/config/local|\.trails/trails\.db|\.trails/dev/|\.trails/generated/" apps/trails/src/trails/dev-support.ts packages/topographer/src/internal/topo-snapshots.ts packages/topographer/src/__tests__/topo-store.test.ts`
  - Output includes `apps/trails/src/trails/dev-support.ts:265`, `packages/topographer/src/internal/topo-snapshots.ts:325`, and `packages/topographer/src/__tests__/topo-store.test.ts:1323`.
- The guard is wired into `bun run check`, so this bypass affects the normal gate:
  - `package.json:16-18`
  - Quote: `"vocab:audit": "bun scripts/vocab-cutover-audit.ts",`
  - `package.json:38`
  - Quote: `"check": "bun run lint && bun run lint:ast-grep && bun run vocab:audit && bun run format:check ..."`

Why this matters:

Round 2 correctly confirmed that `scripts/bootstrap/config.toml` was no longer a whole-file exemption. But the predicate for this review is broader: the guard must not be bypassable by whole-file active-code exemptions. Today a new `.trails/trails.db`, `surface_map`, or `serialized_lock` use added anywhere else in those active files would be skipped before matching. That leaves `bun run check` with a clean signal even though the retired-vocabulary rule did not inspect the full active surface.

## Resolved Checks

### Resolved: active topo-store workflow commits the full artifact family

Previous severity: P2
Owning branch: TRL-653 (`trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`)
Current status: fixed

Evidence:

- ADR-0046 requires the two committed artifacts:
  - `docs/adr/0046-lock-v3-artifact-family.md:35-40`
  - Quote: "Lock v3 is a committed artifact family:"
  - Quote: "- `.trails/trails.lock` is the compact manifest."
  - Quote: "- `.trails/topo.lock` is the serialized `TopoGraph` content artifact."
  - Quote: "Both files are generated, committed, framework-owned `.lock` artifacts."
- The active topo-store guide now matches ADR-0046:
  - `docs/topo-store.md:92-103`
  - Quote: "Compile the current topo to `.trails/topo.lock` and `.trails/trails.lock`."
  - Quote: "Check that the `.trails/trails.lock` / `.trails/topo.lock` artifact family"
  - Quote: "Fails if either committed artifact has drifted."
  - `docs/topo-store.md:112-117`
  - Quote: "2. Compile: `trails topo compile`"
  - Quote: "3. Commit `.trails/trails.lock` and `.trails/topo.lock`"
  - Quote: "4. In CI, verify: `trails topo verify`"
- Targeted current-doc search confirms the active instructions name both files:
  - Command: targeted `rg` search for commit-only `.trails/trails.lock` guidance and for lines naming both committed lock artifacts across active Markdown docs.
  - Output: `docs/topo-store.md:94`, `docs/topo-store.md:102`, `docs/topo-store.md:116`, and `packages/topographer/README.md:13`; no active current-facing "commit only `.trails/trails.lock`" instruction was found.

### Resolved: bootstrap config is now line-allowed, not whole-file excluded

Previous severity: P2
Owning branch: TRL-702 (`trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`)
Current status: fixed for `scripts/bootstrap/config.toml`

Evidence:

- The rule has exact line allowances for bootstrap cleanup:
  - `scripts/vocab-cutover-map.ts:141-148`
  - Quote: "{ line: 71, path: 'scripts/bootstrap/config.toml' },"
  - Quote: "{ line: 76, path: 'scripts/bootstrap/config.toml' },"
- The actual bootstrap seam is limited to cleanup file entries:
  - `scripts/bootstrap/config.toml:68-77`
  - Quote: "[cleanup]"
  - Quote: "files = ["
  - Quote: "\".trails/trails.db\","
  - Quote: "\".trails/dev/tracing.db-wal\","

## Doctrine/Docs Evidence

Active docs and agent guidance are aligned with ADR-0046 at P2+ except for the guard implementation issue above.

- The plan requires current artifact-family vocabulary:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:224-237`
  - Quote: "Required vocabulary:"
  - Quote: "`.trails/trails.lock` means manifest."
  - Quote: "`.trails/topo.lock` means serialized `TopoGraph` content."
  - Quote: "`.trails/state/trails.db` is ignored mutable SQLite state."
- ADR-0046 defines artifact roles and retired names:
  - `docs/adr/0046-lock-v3-artifact-family.md:77-87`
  - Quote: "`topo.lock` is the graph content"
  - Quote: "It contains the serialized `TopoGraph`"
  - Quote: "The manifest's `version: 3` is the manifest schema version"
  - `docs/adr/0046-lock-v3-artifact-family.md:94-125`
  - Quote: "The public topographer API uses `TopoGraph` vocabulary"
  - Quote: "SQL/export names use `topo_graph`"
  - Quote: "The default local SQLite path is `.trails/state/trails.db`."
  - `docs/adr/0046-lock-v3-artifact-family.md:147-160`
  - Quote: "the story is expressed by a manifest plus content artifact"
  - Quote: "The old `SurfaceMap`, `_surface.json`, `surface_map`, `serialized_lock`, `.trails/trails.db`, and `.trails/config/local.*` target-state names should retire"
- The lexicon matches ADR-0046:
  - `docs/lexicon.md:91-156`
  - Quote: "These names are the current durable artifact-family vocabulary established by"
  - Quote: "A TopoGraph contains trail, signal, resource, contour, activation, schema, layer, example, and surface-projection facts."
  - Quote: "`topo_exports.topo_graph` holds the graph content"
  - Quote: "The manifest is the compact `.trails/trails.lock` artifact"
  - Quote: "These names are historical or migration vocabulary, not current target-state language"
  - Quote: "Active guidance should teach the current names."
- The migration guide matches the same roles:
  - `docs/migration/topograph-artifact-family.md:3-12`
  - Quote: "The v1 topo artifact family uses a compact manifest plus an inspectable graph content artifact"
  - Quote: "- `.trails/trails.lock` is the committed lock v3 manifest."
  - Quote: "- `.trails/topo.lock` is the committed serialized `TopoGraph` content artifact."
  - Quote: "- `.trails/state/trails.db` is ignored mutable SQLite state"
  - `docs/migration/topograph-artifact-family.md:26-39`
  - Quote: "| `SurfaceMap` | `TopoGraph` |"
  - Quote: "| `_surface.json` | `.trails/topo.lock` |"
  - Quote: "| `.trails/trails.db` | `.trails/state/trails.db` |"
  - `docs/migration/topograph-artifact-family.md:56-69`
  - Quote: "Consumers that previously parsed `_surface.json` should read `.trails/topo.lock`"
  - Quote: "Use `store.topoGraph`, `store.entries`, `store.trails`, `store.resources`, `store.signals`, and `store.contours`"
- Agent guidance uses current surface vocabulary:
  - `AGENTS.md:50-62`
  - Quote: "`surface`, not transport terminology (the API function and user-facing noun)"
  - Quote: "See `docs/lexicon.md` for the full lexicon."
- Architecture uses current TopoGraph and surface vocabulary:
  - `docs/architecture.md:46-56`
  - Quote: "The trail is the product, not the surface."
  - Quote: "Surfaces are peers."
  - Quote: "The contract is machine-readable at runtime."
  - `docs/architecture.md:108-114`
  - Quote: "| TopoGraph entries and lock metadata | All of the above, canonicalized |"
  - Quote: "The TopoGraph captures inferred information for CI governance."
  - `docs/architecture.md:145-173`
  - Quote: "Surface Adapters (left side)"
  - Quote: "`@ontrails/topographer` | TopoGraphs, semantic diffing, lock manifest and `topo.lock` helpers"
- Round 1 and round 2 status:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-1.md:9-14`
  - Quote: "Round 1 is not clean. I found two P2 issues"
  - Quote: "I found no P0/P1 issues."
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-2.md:9-16`
  - Quote: "Round 2 is P3-only for this lane. I found no P0/P1/P2 issues."
  - Quote: "The two round 1 P2s are resolved"

## Residual P3s / Unknowns

### P3: accepted historical ADRs still contain pre-ADR-0046 single-lock wording

Owning branch: TRL-653, only if accepted ADR reader guardrails are desired.

Evidence remains as round 2 reported:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-2.md:142-168`
- Quote: "Accepted historical ADRs still contain pre-ADR-0046 single-lock wording"
- Quote: "This is not active docs guidance drift."

Recommended action: optional local supersession callouts in ADR-0015 and ADR-0017. Not blocking because ADR-0046 carries the current accepted doctrine.

### P3: `.agents/` is still not in the automated vocab audit roots

Owning branch: TRL-702, only if `.agents/` becomes a durable active guidance surface rather than source packets, reports, notes, or superseded archives.

Evidence:

- The plan included `.agents` in the manual sweep:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:216-218`
  - Quote: "- `.agents/**/*.md`"
  - Quote: "- `.agents/plans/v1/*` where stale plans need an explicit superseded marker."
- The automated audit roots omit `.agents/`:
  - `scripts/vocab-cutover-map.ts:14-22`
  - Quote: "export const auditRoots = ["
  - Quote: "'AGENTS.md',"
  - Quote: "'README.md',"
  - Quote: "'scripts/',"

Recommended action: optional future root addition if `.agents/` becomes active tracked guidance. Not blocking for this stack, because current `.agents` hits are this source packet/reports, audit reports, or superseded planning material.

Unknowns:

- I did not run aggregate `bun run check` because it includes `format:check`, which builds the private Oxlint plugin path and may write build outputs. This review was constrained to writing exactly one report file.
- I did not run `bun run format:check` for the same reason.
- I did not use the Trails skill.

## Commands Run

- `rg -n "local-review-docs-vocab|2026-05-12-topograph-query-docs-stack|ADR-0046|topograph" /Users/mg/.codex/memories/MEMORY.md`
- `rg --files .agents/plans/2026-05-12-topograph-query-docs-stack docs scripts | sort | rg "(PLAN.md|local-review-docs-vocab-round-[12]\\.md|0046-lock-v3-artifact-family.md|lexicon.md|topograph-artifact-family.md|topo-store.md|architecture.md|vocab-cutover-(audit|map)\\.ts)$"`
- `wc -l .agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md docs/adr/0046-lock-v3-artifact-family.md docs/lexicon.md docs/migration/topograph-artifact-family.md docs/topo-store.md docs/architecture.md AGENTS.md scripts/vocab-cutover-audit.ts scripts/vocab-cutover-map.ts .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-1.md .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-2.md`
- `nl -ba` reads of all required artifacts listed by this review prompt, plus `scripts/bootstrap/config.toml`, `apps/trails/src/trails/dev-support.ts`, `packages/topographer/src/internal/topo-snapshots.ts`, and `packages/topographer/src/__tests__/topo-store.test.ts`
- `qmd search "TopoGraph artifact family trails.lock topo.lock"`
- `qmd search "SurfaceMap _surface.json .trails/trails.db retired vocabulary"`
- `bun scripts/vocab-cutover-audit.ts --list-rules`
- `bun scripts/vocab-cutover-audit.ts --list-rules | rg -n "topograph-artifact-family-retired-term|apps/trails/src/trails/dev-support\\.ts|packages/topographer/src/internal/topo-snapshots\\.ts|scripts/bootstrap/config\\.toml:[0-9]+"`
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json`
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term`
- `bun scripts/vocab-cutover-audit.ts --rule connector-term --rule surface-term`
- `bun run vocab:audit`
- `rg -n "SurfaceMap|_surface\\.json|surface_map|serialized_lock|\\.trails/config/local|\\.trails/trails\\.db|\\.trails/dev/|\\.trails/generated/" apps/trails/src/trails/dev-support.ts packages/topographer/src/internal/topo-snapshots.ts packages/topographer/src/__tests__/topo-store.test.ts`
- `rg -n "SurfaceMap|_surface\\.json|surface_map|serialized_lock|\\.trails/config/local|\\.trails/trails\\.db|\\.trails/dev/|\\.trails/generated/|[Tt]railhead|root-state|root state" AGENTS.md README.md docs packages apps plugin scripts -g "*.md" -g "*.ts" -g "*.toml" -g "!**/CHANGELOG.md" -g "!docs/adr/**" -g "!docs/migration/**" -g "!docs/releases/**" -g "!scripts/vocab-cutover-*"`
- targeted `rg` search for commit-only `.trails/trails.lock` guidance and for lines naming both committed lock artifacts across active Markdown docs
- `rg -n "topo.lock|trails.lock|TopoGraph|topo_graph|lock_manifest|\\.trails/state/trails\\.db|\\.trails/cache|config\\.local" docs/lexicon.md docs/migration/topograph-artifact-family.md docs/topo-store.md docs/architecture.md AGENTS.md`
- `rg -n "vocab:audit|\\\"check\\\"" package.json`
- `/usr/bin/git branch --show-current`
- `/usr/bin/git status --short`
- `/usr/bin/git diff --check -- .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-3.md`
- `/usr/bin/git status --short -- .agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-3.md`

No source-control write commands were run.
