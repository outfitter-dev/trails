# Local Review Round 2: Docs/Vocab Lane

Date: 2026-05-12
Branch reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: TRL-653 dual-lock docs, TRL-702 retired-vocabulary guard narrowing, and active docs/vocab consistency with ADR-0046.

## Summary

Round 2 is P3-only for this lane. I found no P0/P1/P2 issues.

The two round 1 P2s are resolved:

- TRL-653 now tells users to commit both `.trails/trails.lock` and `.trails/topo.lock`.
- TRL-702 no longer excludes the whole `scripts/bootstrap/config.toml` file; it allows only the known legacy bootstrap cleanup lines.

The active repo vocab audit is clean. The only residual notes are non-blocking: accepted historical ADR text still contains old single-lock lifecycle wording, and the vocab audit roots still omit `.agents/` planning artifacts, which is acceptable for this stack because the current `.agents` hits are source packet/reports or superseded planning archives rather than active product docs.

## Resolved Round 1 P2 Checks

### Resolved: Pre-deployment workflow now commits the full artifact family

Previous severity: P2
Owning branch: TRL-653 (`trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`)
Current status: resolved

Evidence:

- ADR-0046 requires both committed lock artifacts:
  - `docs/adr/0046-lock-v3-artifact-family.md:35-40`
  - Quote: "Lock v3 is a committed artifact family:"
  - Quote: "- `.trails/trails.lock` is the compact manifest."
  - Quote: "- `.trails/topo.lock` is the serialized `TopoGraph` content artifact."
  - Quote: "Both files are generated, committed, framework-owned `.lock` artifacts."
- The active topo-store workflow now matches that requirement:
  - `docs/topo-store.md:114-117`
  - Quote: "1. Make topology changes"
  - Quote: "2. Compile: `trails topo compile`"
  - Quote: "3. Commit `.trails/trails.lock` and `.trails/topo.lock`"
  - Quote: "4. In CI, verify: `trails topo verify`"
- The verify prose also names both artifacts:
  - `docs/topo-store.md:102-103`
  - Quote: "Check that the `.trails/trails.lock` / `.trails/topo.lock` artifact family"
  - Quote: "matches your current topo. Fails if either committed artifact has drifted."

Recommended action:

No blocking action. This round 1 P2 is fixed.

Validation:

- Targeted search for current-facing "Commit `.trails/trails.lock`" guidance found the fixed `docs/topo-store.md:116` line and the historical round 1 report quote only.
- Active retired-term sweep found no non-allowed current docs teaching the old root lock/state layout.

### Resolved: Bootstrap config exemption is now line-scoped

Previous severity: P2
Owning branch: TRL-702 (`trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`)
Current status: resolved

Evidence:

- The plan requires explicit, scoped exemptions:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:295-300`
  - Quote: "Important guard nuance:"
  - Quote: "Treat `.trails/trails.db` as retired current-target vocabulary."
  - Quote: "The legacy reset-file cleanup list in `apps/trails/src/trails/dev-support.ts` is an intentional exemption."
  - Quote: "Exemptions must be explicit and scoped."
- The rule no longer includes `scripts/bootstrap/config.toml` in its path exclusion list:
  - `scripts/vocab-cutover-map.ts:129-139`
  - Quote: "const topographArtifactFamilyRetiredMentionPaths = ["
  - Quote: "'apps/trails/src/trails/dev-support.ts',"
  - Quote: "'packages/topographer/src/internal/topo-snapshots.ts',"
- The bootstrap legacy cleanup entries are allowed by exact path and line:
  - `scripts/vocab-cutover-map.ts:141-148`
  - Quote: "const legacyBootstrapCleanupMatches = ["
  - Quote: "{ line: 71, path: 'scripts/bootstrap/config.toml' },"
  - Quote: "{ line: 76, path: 'scripts/bootstrap/config.toml' },"
- The audit engine filters allowed matches by exact path and line:
  - `scripts/vocab-cutover-audit.ts:40-46`
  - Quote: "const isAllowedMatch = ("
  - Quote: "(allowed) => allowed.path === match.path && allowed.line === match.line"
- The only retired targets in the bootstrap config are the explicit cleanup file entries:
  - `scripts/bootstrap/config.toml:68-77`
  - Quote: "[cleanup]"
  - Quote: "files = ["
  - Quote: "\".trails/trails.db\","
  - Quote: "\".trails/dev/tracing.db-wal\","

Recommended action:

No blocking action. This round 1 P2 is fixed. The line allowlist should fail loudly if the cleanup section moves without updating the allowlist, which is the right failure mode for this narrow exception.

Validation:

- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json` returned `fileCount: 0`, `total: 0`, and no matches after allowed-line filtering.
- `bun scripts/vocab-cutover-audit.ts --list-rules` shows `scripts/bootstrap/config.toml:71` through `scripts/bootstrap/config.toml:76` under `allows`, not under `excludes`.

## Active Docs/Vocab Check

Status: clean at P2+.

Evidence:

- `docs/lexicon.md` defines the current artifact-family vocabulary:
  - `docs/lexicon.md:91-118`
  - Quote: "These names are the current durable artifact-family vocabulary established by"
  - Quote: "The exported TypeScript type family for the serialized, inspectable graph"
  - Quote: "The SQL/storage spelling for serialized TopoGraph content."
  - Quote: "The SQL/storage spelling for the stored lock manifest export."
- `docs/lexicon.md` marks the old terms as retired vocabulary:
  - `docs/lexicon.md:136-156`
  - Quote: "These names are historical or migration vocabulary, not current target-state"
  - Quote: "| `SurfaceMap` | `TopoGraph` |"
  - Quote: "| `.trails/trails.db` | `.trails/state/trails.db` |"
  - Quote: "Active guidance should teach the current names."
- The migration note teaches the current manifest/content/state/cache/config layout:
  - `docs/migration/topograph-artifact-family.md:3-12`
  - Quote: "The v1 topo artifact family uses a compact manifest plus an inspectable graph"
  - Quote: "- `.trails/trails.lock` is the committed lock v3 manifest."
  - Quote: "- `.trails/topo.lock` is the committed serialized `TopoGraph` content artifact."
  - Quote: "- `.trails/state/trails.db` is ignored mutable SQLite state for snapshots,"
- The active topo-store reference now avoids the earlier persistence overclaim:
  - `docs/topo-store-reference.md:171-177`
  - Quote: "This table is an operational query projection, not the canonical complete"
  - Quote: "In the current v1 posture it records CLI-derived rows only:"
  - Quote: "Today its surface-related facts are the authored `surfaces` list and"
  - Quote: "complete multi-surface projection rows remain future work."

Recommended action:

No blocking action. Active docs/vocab match ADR-0046 for this lane.

Validation:

- `bun run vocab:audit` passed for the repo target set.
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term` passed.
- `bun scripts/vocab-cutover-audit.ts --rule connector-term --rule surface-term` passed.
- Exact active-doc search across `README.md`, `AGENTS.md`, `apps/`, `docs/`, `packages/`, `plugin/`, and `scripts/`, excluding changelogs/ADRs/migrations/releases, returned only the intentional retired vocabulary table in `docs/lexicon.md`.

## P3 Residual Notes

### P3: Accepted historical ADRs still contain pre-ADR-0046 single-lock wording

Owning branch: TRL-653, if the team wants extra reader guardrails in accepted historical ADR text.

Evidence:

- `docs/adr/0015-topo-store.md:289-294`
  - Quote: "The lockfile (`.trails/trails.lock`) becomes a deterministic text export of the current topo state:"
  - Quote: "trails topo compile         # Write .trails/trails.lock from the current topo"
  - Quote: "trails topo verify          # CI: fail if .trails/trails.lock is stale"
- `docs/adr/0017-serialized-topo-graph.md:110-123`
  - Quote: "trails topo compile          # write .trails/trails.lock from current topo"
  - Quote: "The lockfile is:"
  - Quote: "Checked in to source control. A PR that changes trail contracts produces a lockfile diff."
- ADR-0046 already supersedes the old single-lock story:
  - `docs/adr/0046-lock-v3-artifact-family.md:147-149`
  - Quote: "ADR-0017 is partially superseded."
  - Quote: "the story is expressed by a manifest plus content artifact instead of one"
  - Quote: "all-purpose lockfile."

Why this is P3:

These are accepted ADR history, ADR-0046 has an explicit supersession note, and the retired-vocabulary rule intentionally exempts reviewed ADR history. This is not active docs guidance drift.

Recommended action:

Optional: add short local supersession callouts in ADR-0015 and ADR-0017 command/lifecycle sections pointing readers to ADR-0046 for the current two-artifact lifecycle.

### P3: The vocab audit target set does not include `.agents/` planning artifacts

Owning branch: TRL-702, only if future `.agents/` files become active agent guidance rather than source packets/reports/planning archives.

Evidence:

- The plan included `.agents` material in the TRL-653 manual sweep:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:217-218`
  - Quote: "- `.agents/**/*.md`"
  - Quote: "- `.agents/plans/v1/*` where stale plans need an explicit superseded marker."
- The automated vocab audit roots do not include `.agents/`:
  - `scripts/vocab-cutover-map.ts:14-22`
  - Quote: "export const auditRoots = ["
  - Quote: "'AGENTS.md',"
  - Quote: "'scripts/',"
- The tracked v1 planning file that does contain retired terms is visibly marked superseded:
  - `.agents/plans/v1/PLAN.md:3-8`
  - Quote: "> **Superseded planning archive (2026-05-12):** this packet predates the"
  - Quote: "> TopoGraph artifact-family cutover. Do not use its `SurfaceMap`,"
  - Quote: "> `docs/adr/0046-lock-v3-artifact-family.md` for current artifact doctrine."

Why this is P3:

The active product/docs target set is covered by `bun run vocab:audit`, and the current `.agents` retired-term hits are either the tracked goal packet/reports or visibly superseded planning archives. I do not see an active `.agents` guidance file teaching retired target-state names as current.

Recommended action:

If `.agents/` becomes a durable tracked guidance surface rather than local notes/plans/reports, add a scoped `.agents` audit root with explicit exclusions for source packets, reports, and superseded archives.

## Validation Run

- `/usr/bin/git branch --show-current` -> `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
- `/usr/bin/git status --short` before this report showed only unrelated untracked round 2 reports from other lanes:
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-2.md`
  - `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-2.md`
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json` -> passed with `fileCount: 0`, `total: 0`.
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term` -> passed.
- `bun scripts/vocab-cutover-audit.ts --rule connector-term --rule surface-term` -> passed.
- `bun run vocab:audit` -> passed.
- `bun run lint:ast-grep` -> passed.
- `/usr/bin/git diff --check` -> passed before writing this report.
- `qmd search "TopoGraph artifact family trails.lock topo.lock commit"` -> no results from the local qmd index.
- `qmd search "SurfaceMap _surface.json .trails/trails.db retired vocabulary"` -> no results from the local qmd index.

Checks intentionally not run:

- `bun scripts/adr.ts map`: skipped because it writes generated ADR map output and this review is allowed to write only the requested report file.
- `bun run format:check`: skipped because the script builds the private Oxlint plugin before checking and may write build outputs; this review is allowed to write only the requested report file.
