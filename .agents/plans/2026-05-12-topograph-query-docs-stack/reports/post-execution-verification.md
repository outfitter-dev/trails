# Post-Execution Doctrine Verification

Date: 2026-05-12
Stack tip reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`
Scope: M4b TopoGraph Query + V1 Closeout stack doctrine gate before remote ready.

## Verdict

Pass for the doctrine gate. I found no P0/P1/P2 doctrine mismatches remaining in the current code/docs against ADR-0046 and the tracked stack plan.

The active artifacts align on the lock v3 artifact-family doctrine:

- `.trails/trails.lock` is the compact v3 manifest.
- `.trails/topo.lock` is serialized `TopoGraph` content.
- `.trails/state/trails.db`, `.trails/cache/`, and `.trails/config.local.{ts,js}` are ignored local/runtime state.
- Stored export names use `topo_graph` and `lock_manifest`.
- Retired vocabulary is either historical/migration context or exact line-scoped cleanup/migration seam.
- The generated Warden guide public contract uses `concern`, not `category`, and generated headers say `Guide input command`.

Unknowns:

- I did not check remote PR state, CI state, GitHub review threads, or live Linear parentage in this pass.
- Physical `.trails/trails.lock` and `.trails/topo.lock` files are absent locally. That is not a doctrine failure by itself because this branch does not claim to commit current workspace lock artifacts, and the M3 audit explicitly records discovery fallback because no workspace `.trails/topo.lock` was present at audit time.
- I did not run the full ordinary CI matrix; this pass intentionally targeted the doctrine predicates distinct from CI and bot review.

## Checks Run

- `git status --short --branch`: confirmed the current branch as `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`; only this report path was untracked at start of this pass.
- `/usr/bin/find .trails -maxdepth 3 -print | sort`: found `.trails/.gitignore`, `.trails/clark/*`, and `.trails/config`; no `.trails/trails.lock`, `.trails/topo.lock`, `.trails/state/`, `.trails/cache/`, `.trails/dev/`, or `.trails/generated/`.
- `git ls-files .trails`: tracked `.trails` files are `.trails/.gitignore` and Clark docs only; no tracked lock artifacts.
- `git status --short .trails/trails.lock .trails/topo.lock .trails/state/trails.db ...`: no output.
- `bun scripts/adr.ts check`: passed with `0 errors, 0 warnings`.
- `bun run warden:agents:check`: passed.
- `bun run warden:skills:check`: passed.
- `bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys, has("category"), has("concern")'`: first rule keys include `concern`; `has("category")` returned `false`; `has("concern")` returned `true`.
- `bun apps/trails/bin/trails.ts warden guide --agent-json | jq '.kind, (.rules[0] | keys), (.rules[0] | has("category")), (.rules[0] | has("concern"))'`: kind was `trails-warden-agent-guide`; first rule keys include `concern`; `category` false; `concern` true.
- `bun scripts/vocab-cutover-audit.ts --rule topograph-artifact-family-retired-term --json`: returned `fileCount: 0`, `matches: []`, `total: 0`.
- `bun run vocab:audit`: passed for the entire repo target set.
- `git diff --check`: passed.

## Predicate 1 - Workspace Layout

Status: Pass, with local physical-artifact absence noted.

Evidence:

- ADR-0046 defines committed root `.lock` artifacts and ignored local state: `docs/adr/0046-lock-v3-artifact-family.md:112-127` says `.trails/trails.lock` and `.trails/topo.lock` are committed root `.lock` artifacts, `.trails/cache/` is ignored rebuildable cache, `.trails/state/` is ignored mutable runtime state, `.trails/config.local.ts` / `.trails/config.local.js` are ignored local overrides, and default SQLite is `.trails/state/trails.db`.
- The tracked plan repeats the same vocabulary: `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:224-236` defines `.trails/trails.lock`, `.trails/topo.lock`, `.trails/config.local.{ts,js}`, `.trails/state/trails.db`, `.trails/state/`, and `.trails/cache/`.
- The active topo-store guide teaches the current layout: `docs/topo-store.md:13-27` shows `cache/`, `state/trails.db`, `topo.lock`, and `trails.lock`, and says `state/trails.db` is not git-tracked while `topo.lock` and `trails.lock` are committed.
- The migration guide says the same: `docs/migration/topograph-artifact-family.md:3-12` defines manifest, content artifact, ignored state, ignored cache, and ignored local config.
- The current `.trails/.gitignore` ignores local config, `cache/`, and `state/`: `.trails/.gitignore:1-9`.
- Local physical state is currently sparse: `/usr/bin/find .trails -maxdepth 3 -print | sort` showed no `.trails/trails.lock`, `.trails/topo.lock`, `.trails/state/`, or `.trails/cache/`; `git ls-files .trails` showed only `.trails/.gitignore` and Clark docs.
- The M3 audit already handles this absence as discovery fallback, not as a committed-artifact claim: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:35-40` says the workspace index probe used discovery because no workspace `.trails/topo.lock` was present.

Conclusion: current docs/code align with ADR-0046. Physical lock-file absence is not a doctrine failure unless a branch claims to commit regenerated lock artifacts; this stack does not.

## Predicate 2 - Lock/Topo Artifact Shape

Status: Pass.

Evidence:

- ADR-0046 separates responsibilities: `docs/adr/0046-lock-v3-artifact-family.md:35-40` says `.trails/trails.lock` is compact manifest and `.trails/topo.lock` is serialized `TopoGraph`; `docs/adr/0046-lock-v3-artifact-family.md:48-56` says the manifest has version/scope/artifact paths/hashes/summary and does not contain graph entries; `docs/adr/0046-lock-v3-artifact-family.md:77-90` says `topo.lock` contains serialized `TopoGraph` with `generatedAt` and `topoGraphSchemaVersion`.
- Topographer types enforce the split: `packages/topographer/src/types.ts:146-155` defines `TopoGraph` with `topoGraphSchemaVersion`, activation graph/sources, `generatedAt`, `entries`, and optional `workspace`; `packages/topographer/src/types.ts:259-266` defines strict lock manifest fields as `artifacts`, `scope`, `summary`, and `version: 3`.
- I/O helpers write and read separate files: `packages/topographer/src/io.ts:22-24` defines `trails.lock` and `topo.lock`; `packages/topographer/src/io.ts:111-131` writes/reads `TopoGraph` at `topo.lock`; `packages/topographer/src/io.ts:143-163` writes/reads lock manifest at `trails.lock`.
- Stored exports use current names: `packages/topographer/src/internal/topo-store.ts:1537-1551` inserts `topo_graph`, `topo_graph_hash`, and `lock_manifest`; `packages/topographer/src/internal/topo-store.ts:1554-1574` reads those columns back.
- The SQLite schema uses the same names: `packages/topographer/src/internal/topo-snapshots.ts:101-106` creates `topo_exports` with `topo_graph`, `topo_graph_hash`, and `lock_manifest`.
- Legacy DB-column names are only migration seams: `packages/topographer/src/internal/topo-snapshots.ts:321-337` renames `surface_map` to `topo_graph`, `surface_hash` to `topo_graph_hash`, and `serialized_lock` to `lock_manifest`.
- Active reference docs match: `docs/topo-store-reference.md:191-205` documents `topo_exports.topo_graph`, `topo_graph_hash`, and `lock_manifest`; `docs/topo-store-reference.md:378-390` says `store.topoGraph.get(ref?)` reads canonical saved graph content without parsing `topoGraphJson`.

Conclusion: no old `SurfaceMap` / root DB target-state leakage remains in current implementation surfaces. Legacy names are confined to migration paths and line-scoped migration/test seams.

## Predicate 3 - Lexicon And Retired Vocabulary

Status: Pass.

Evidence:

- `AGENTS.md:50-62` states active lexicon: `trail`, `blaze`, `topo`, `cross`, `surface`, `resource`, and `layer`.
- `docs/lexicon.md:91-118` defines the TopoGraph artifact-family terms: `TopoGraph`, `topoGraph`, `topo_graph`, and `lock_manifest`.
- `docs/lexicon.md:120-156` defines `.trails/state/`, `.trails/cache/`, `.trails/config.local.{ts,js}`, and a retired vocabulary table mapping `SurfaceMap`, `_surface.json`, `surface_map`, `serialized_lock`, `.trails/config/local`, `.trails/trails.db*`, `.trails/dev/`, and `.trails/generated/` to current terms.
- `docs/migration/topograph-artifact-family.md:26-39` carries retired vocabulary in explicit migration context, with current replacements.
- `scripts/vocab-cutover-map.ts:147-182` line-scopes active cleanup/migration matches in `apps/trails/src/trails/dev-support.ts`, `packages/topographer/src/internal/topo-snapshots.ts`, and `packages/topographer/src/__tests__/topo-store.test.ts`.
- `scripts/vocab-cutover-map.ts:330-335` wires `allowMatches: topographArtifactFamilyRetiredMatches` and `excludePaths: topographArtifactFamilyRetiredMentionPaths` into `topograph-artifact-family-retired-term`.
- `scripts/vocab-cutover-audit.ts:32-46` treats `excludePaths` as whole-path/directory skips and `allowMatches` as exact path+line skips; `scripts/vocab-cutover-audit.ts:99-101` filters allowed matches after finding line-level matches.
- The latest targeted guard check returned no non-allowed matches, and `bun run vocab:audit` passed for the whole target set.
- The round 4 docs/vocab report confirms the earlier round 3 P2 no longer reproduces: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-4.md:7-17` and `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-4.md:24-58`.

Conclusion: active guidance uses current vocabulary. Retired vocabulary remains only in historical/migration contexts or exact line-scoped cleanup/migration seams.

## Predicate 4 - Generated Warden Guide Source Of Truth

Status: Pass.

Evidence:

- The generated AGENTS block has the expected source-of-truth header: `AGENTS.md:83-91` includes generated markers, says it is generated from the live `@ontrails/warden` rule manifest, says `Guide input command`, and reports `Rule count: 49`.
- The agent generator emits that header: `scripts/sync-agents-warden-guide.ts:24-34`.
- The agent generator groups by `concern`: `scripts/sync-agents-warden-guide.ts:36-44` groups on `rule.concern`.
- The skill generator also groups by `concern`: `scripts/sync-skill-warden-guide.ts:33-41`, and its header uses `Guide input command`: `scripts/sync-skill-warden-guide.ts:43-55`.
- Generator tests assert the header and fixture shape: `scripts/__tests__/sync-agents-warden-guide.test.ts:38-50` and `scripts/__tests__/sync-skill-warden-guide.test.ts:12-31`.
- The manifest type exposes `concern`: `packages/warden/src/guide.ts:25-37`.
- The manifest builder sources `concern` from metadata: `packages/warden/src/guide.ts:79-111`.
- Agent JSON projection keeps `concern`: `packages/warden/src/guide.ts:197-218`.
- The Warden metadata type names this a queryable concern dimension: `packages/warden/src/rules/types.ts:42-53` and `packages/warden/src/rules/types.ts:97-108`.
- The app wrapper output schema expects `concern`: `apps/trails/src/trails/warden-guide.ts:29-59`.
- Warden guide tests reject stale `category`: `packages/warden/src/__tests__/guide.test.ts:22-30`, `packages/warden/src/__tests__/guide.test.ts:34-45`, and `packages/warden/src/__tests__/guide.test.ts:47-70`.
- `bun run warden:agents:check` and `bun run warden:skills:check` both passed. Manifest and agent-json smoke checks returned `category=false`, `concern=true`.

Conclusion: generated Warden blocks/checks align with the live manifest contract and header wording. The remaining internal identifiers named `CATEGORY_LABELS` / `renderCategorySections` are non-output implementation names and not a doctrine mismatch.

## Predicate 5 - Audit Methodology

Status: Pass.

Evidence:

- The plan scopes TRL-634/636/637 as audit/report branches and requires Bun publish language for TRL-637: `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md:37-40`.
- The retro records the audit outputs and focused follow-ups: `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md:211-231` maps M3 to TRL-704/705/706, M5 to TRL-707/708/709/710, and M6 to TRL-711/712/713/714.
- M3 is evidence-backed and does not overclaim execution parity: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:29-40` records live probes; `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:96-166` marks projection status separately from execution parity; `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md:186-215` files follow-ups instead of claiming implementation is complete.
- M5 is evidence-backed and explicit about current blockers: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md:97-162` records the generated-project install failure; `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md:164-182` records narrow snippet coverage; `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md:184-211` records link gaps; `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md:286-293` files TRL-707 through TRL-710.
- M6 uses Bun publish language and clearly separates read-only registry probes from publishing: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md:14-21`, `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md:36-56`, and `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md:89-91`.
- M6 does not claim stable cutover is complete: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md:23-32` lists concrete stable gaps, and `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md:268-348` maps those gaps to TRL-713 and TRL-714 plus stable-runbook/doctrine follow-ups.
- The V1 audit local review confirms the report set is clean for P0/P1/P2 while preserving P3/unknowns: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-3.md:7-24`.

Conclusion: M3/M5/M6 are audit reports, not hidden implementation claims. They file concrete follow-ups where implementation remains.

## Predicate 6 - Latest Local Review Status

Status: Pass.

Evidence:

- Topographer round 3 is P3-only: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-3.md:7-22`.
- Persistence round 3 is clean for P0/P1/P2: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-3.md:7-28`.
- Warden/CLI round 3 is P3-only: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-warden-cli-round-3.md:9-21`.
- V1 audit round 3 is clean for P0/P1/P2: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-3.md:7-24`.
- Docs/vocab round 3 reported a P2: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-3.md:7-27`.
- Docs/vocab round 4 resolves that P2 and is clean for P0/P1/P2: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-4.md:7-20`.
- The RETRO correctly says local review must continue until the latest pass is P3-only or clean: `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md:19-23`.
- The RETRO records docs/vocab round 3 as a stale P2 and round 4 as the clean latest docs/vocab pass: `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md:102-121`.
- The RETRO execution log records the same sequence: three full rounds, then a focused round 4 docs/vocab verification that returned clean for P0/P1/P2.

Conclusion: the latest actual local review status is P3-only/clean, and the RETRO now matches that sequence.

## Findings

| Severity | Owning branch | Finding | Recommended action |
| --- | --- | --- | --- |
| P3 | `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse` | The app `warden.guide` trail still carries local Zod copies of Warden guide/guidance schema shape while the package owns the manifest TypeScript shape. This is passing behavior, not a doctrine mismatch. Evidence: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-warden-cli-round-3.md:15-21` and `apps/trails/src/trails/warden-guide.ts:15-59`. | Optional post-stack cleanup: export/reuse package-owned Warden guide schemas or add a direct app output-schema parse test for `buildWardenGuideManifest()`. |
| P3 | `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph` | The compact API reference omits several exported topo-store record types, while the deeper topo-store reference documents them. This is docs polish, not an implementation/schema/test blocker. Evidence: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-3.md:16-23` and `docs/topo-store-reference.md:378-404`. | Optional docs polish: add the exported topo-store record types to compact `docs/api-reference.md`. |
| P3 / Unknown | V1 audit tail / tracker mapping | Live Linear parentage for TRL-704 through TRL-714 was not re-read in the latest V1 audit round. Local artifacts are internally consistent. Evidence: `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-3.md:11-24`. | If remote-ready gating needs tracker proof, run a read-only Linear readback before final handoff. |

No P0/P1/P2 doctrine mismatches remain.

## Final Classification

Doctrine classification: Remote-ready from the local doctrine-verification perspective, subject to ordinary remote CI/review gates and the explicit unknowns above.

Blocking doctrine issues: none.

Residuals: P3-only bookkeeping/docs/schema-polish items.
