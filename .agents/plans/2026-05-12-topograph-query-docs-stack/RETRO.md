# Execution Retro: TopoGraph Query + V1 Closeout Stack

Date started: 2026-05-12
Plan: `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md`

Maintain this retro during execution. It should be current before PRs are marked
ready and again before final handoff.

## Planning Discoveries

- The first scratch packet lived under ignored `.scratch/`; this tracked packet
  now owns the source-of-truth plan, goal prompt, refs, and retro.
- The `goal-planning` context primer found no existing `.agents/plans/PLANNING.md`
  and showed `main` at `bbb1ea4ff` (`feat: move workspace index to topo lock
  (#487)`) at packet creation time.
- The context primer produced useful Graphite context, then hit a local
  `jq --argfile` compatibility error while listing open PRs. Re-check live
  PR/Linear state during preflight.
- Prior no-absorb branch repair language was folded into the packet: review from
  the tip, fix on the bottom-most owning branch via `gt checkout`, then restack
  and walk upward.
- Local review is intentionally biased toward at least three passes and must
  continue until the latest pass is P3-only or clean.

## Preflight Local State

- Stack 1 merge verified: 2026-05-12 13:46 EDT; GitHub PRs
  `#480` through `#487` all reported `MERGED`, with `#487` merged at
  `2026-05-12T14:44:15Z` and merge commit
  `bbb1ea4ff47a050094e1100e510e6e6196a21c57`.
- `gt sync` completed: 2026-05-12 13:46 EDT; output `ok synced`.
- Current branch before execution: `main`, with `HEAD` equal to `origin/main`
  at `bbb1ea4ff47a050094e1100e510e6e6196a21c57`.
- Legacy root DB sidecars checked/removed: no staged or untracked
  `.trails/trails.db`, `.trails/trails.db-shm`, `.trails/trails.db-wal`,
  `.trails/state/trails.db`, `.trails/state/trails.db-shm`, or
  `.trails/state/trails.db-wal` were present during preflight, so no DB files
  were removed.
- Legacy `.trails/dev/` and `.trails/generated/` checked/removed: neither
  directory existed during preflight; active local directories were
  `.trails/clark` and `.trails/config`.
- Linear preflight: natural-language Linear research still failed with
  `Tool research not found`, so issue state was checked through direct Linear
  issue lookups. Target branch names matched the packet. M4b issues
  `TRL-655`, `TRL-656`, `TRL-657`, `TRL-653`, and `TRL-702` were `Todo`;
  Warden/CLI follow-ups `TRL-692`, `TRL-690`, `TRL-691`, `TRL-693`, and
  `TRL-694` were `Todo`; audit issues `TRL-634`, `TRL-636`, and `TRL-637`
  were open in `Backlog`; parent `TRL-659` was open in `Todo`.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/` committed on lowest
  branch: yes, on
  `trl-655-add-typed-topo-store-views-over-topograph-saved-state` as
  `chore: add topograph closeout plan packet`.

## Stack

| Order | Issue | Branch | PR | Status |
| --- | --- | --- | --- | --- |
| 1 | `TRL-655` | `trl-655-add-typed-topo-store-views-over-topograph-saved-state` | TBD | Implemented locally |
| 2 | `TRL-656` | `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` | TBD | Implemented locally |
| 3 | `TRL-657` | `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents` | TBD | Implemented locally |
| 4 | `TRL-653` | `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph` | TBD | Implemented locally |
| 5 | `TRL-702` | `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces` | TBD | Implemented locally |
| 6 | `TRL-692` | `trl-692-clarify-warden-guide-manifest-category-naming-before` | TBD | Implemented locally |
| 7 | `TRL-690` | `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse` | TBD | Implemented locally |
| 8 | `TRL-691` | `trl-691-polish-generated-warden-guide-headers-and-generator-tests` | TBD | Implemented locally |
| 9 | `TRL-693` | `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers` | TBD | Implemented locally |
| 10 | `TRL-694` | `trl-694-suppress-static-resource-accessor-warnings-when-string` | TBD | Implemented locally |
| 11 | `TRL-634` | `trl-634-audit-cross-surface-parity-coverage-gaps` | TBD | Not started |
| 12 | `TRL-636` | `trl-636-audit-docs-and-examples-for-v1-readiness` | TBD | Not started |
| 13 | `TRL-637` | `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` | TBD | Not started |

## Tracker Mutations

Record issues, milestones, dependency links, comments, labels, and follow-up
issues created or updated during execution.

| Item | Mutation | Link / Notes |
| --- | --- | --- |
| `TRL-634` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m3-parity-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md`; added note to use TopoGraph/topo-store query APIs from `TRL-655`/`TRL-657`. | Planning alignment |
| `TRL-636` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m5-docs-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md`; added note that this runs after `TRL-653`/`TRL-702`. | Planning alignment |
| `TRL-637` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m6-release-process-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md`; changed release wording from npm publish flow to Bun publish flow and repo scripts. | Planning alignment |

## Local Review Reports

Reports should live under
`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/`.

| Round | Lane | Report | Result |
| --- | --- | --- | --- |
| 1 | Topographer API | `reports/local-review-topographer-round-1.md` | Pending |
| 1 | Persistence honesty | `reports/local-review-persistence-round-1.md` | Pending |
| 1 | Docs/vocab | `reports/local-review-docs-vocab-round-1.md` | Pending |
| 1 | Warden/CLI polish | `reports/local-review-warden-cli-round-1.md` | Pending |
| 1 | V1 audit | `reports/local-review-v1-audit-round-1.md` | Pending |
| 2 | Topographer API | `reports/local-review-topographer-round-2.md` | Pending |
| 2 | Persistence honesty | `reports/local-review-persistence-round-2.md` | Pending |
| 2 | Docs/vocab | `reports/local-review-docs-vocab-round-2.md` | Pending |
| 2 | Warden/CLI polish | `reports/local-review-warden-cli-round-2.md` | Pending |
| 2 | V1 audit | `reports/local-review-v1-audit-round-2.md` | Pending |
| 3 | Topographer API | `reports/local-review-topographer-round-3.md` | Pending |
| 3 | Persistence honesty | `reports/local-review-persistence-round-3.md` | Pending |
| 3 | Docs/vocab | `reports/local-review-docs-vocab-round-3.md` | Pending |
| 3 | Warden/CLI polish | `reports/local-review-warden-cli-round-3.md` | Pending |
| 3 | V1 audit | `reports/local-review-v1-audit-round-3.md` | Pending |
| Doctrine | Post-execution verification | `reports/post-execution-verification.md` | Pending |

If round 3 still finds any P0/P1/P2 issue, add round 4+ rows and continue.

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
|  |  |  |  |

## Execution Log

Record branch creation, implementation checkpoints, restacks, PR submission,
ready waves, and remote review turns here.

- 2026-05-12 13:46 EDT: Completed preflight. Stack 1 was fully merged, `gt sync`
  succeeded, current base was refreshed `main`, legacy DB sidecars were absent,
  and stale `.trails/dev/` / `.trails/generated/` directories were absent.
- 2026-05-12 13:47 EDT: Moved `TRL-655` to `In Progress`, created
  `trl-655-add-typed-topo-store-views-over-topograph-saved-state`, and committed
  the tracked plan packet on the lowest branch.
- 2026-05-12 13:57 EDT: Implemented `TRL-655` typed topo-store views:
  `store.topoGraph.get()`, `store.entries.get/list()`, and
  `store.contours.get/list()` now read saved `TopoGraph` content through typed
  helpers; `store.exports.get()` exposes parsed `lockManifest` and `topoGraph`
  payloads; existing resource/signal read paths share the helper instead of
  parsing `topoGraphJson` inline. Added topographer docs, tests, and a
  `@ontrails/topographer` patch changeset.
- 2026-05-12 14:05 EDT: Moved `TRL-656` to `In Progress`, created
  `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial`, and
  implemented the explicit partial-row posture for `topo_surfaces`. The SQL
  rows are documented and tested as CLI-only operational projections, while
  complete graph detail stays in `TopoGraph` and typed entry views.
- 2026-05-12 14:30 EDT: Moved `TRL-657` to `In Progress`, created
  `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`, and
  implemented resolved contract detail for blind-agent review.
  `topoStore.trails.get()` now includes saved `TopoGraph` schema, layer,
  contour, activation, governance, and surface-projection facts; `survey.trail`
  exposes the same contract-facing shape through its output schema; docs and
  changesets were updated for the public package behavior.
- 2026-05-12 14:55 EDT: Moved `TRL-653` to `In Progress`, created
  `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`, and
  completed the TopoGraph docs/API/agent-guidance sweep. Added lexicon entries
  for current artifact-family vocabulary, a migration guide for retired
  SurfaceMap/root-state names, a tracked archive note for ignored v1 plans, and
  updated stale tenet citations plus draft wayfinding substrate wording.
- 2026-05-12 15:10 EDT: Moved `TRL-702` to `In Progress`, created
  `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`, and
  added the TopoGraph artifact-family retired-vocabulary guard to the repo vocab
  audit. The normal `bun run check` gate now runs `bun run vocab:audit`, with
  explicit exemptions for history, migration notes, accepted ADR context, and
  legacy cleanup seams.
- 2026-05-12 15:30 EDT: Moved `TRL-692` to `In Progress`, created
  `trl-692-clarify-warden-guide-manifest-category-naming-before`, and renamed
  the Warden guide manifest grouping field from `category` to `concern` so it
  matches the source `WardenRuleMetadata.concern` taxonomy. Updated package/app
  schemas, generator grouping helpers, generated skill guide references, and
  branch-local changeset metadata.
- 2026-05-12 15:50 EDT: Moved `TRL-690` to `In Progress`, created
  `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse`, and
  polished Warden guidance projection. Plain-text Warden reports now render
  labeled docs as `Label (path-or-url)` while keeping label-only docs intact,
  and the Trails app Warden wrapper reuses the package `diagnosticSchema`
  instead of duplicating the guidance schema.
- 2026-05-12 16:00 EDT: Moved `TRL-691` to `In Progress`, created
  `trl-691-polish-generated-warden-guide-headers-and-generator-tests`, renamed
  generated guide header metadata from `Source command` to
  `Guide input command`, refreshed AGENTS and skill guide generated blocks, and
  added generator tests for the end-only orphaned marker case plus stable
  fixture-based rendering assertions.
- 2026-05-12 16:12 EDT: Moved `TRL-693` to `In Progress`, created
  `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers`, and
  tightened `applyCliFlagValueAliases()` for non-Commander callers. When an
  active value alias is present without caller-supplied key tracking, any parsed
  canonical key is treated as ambiguous and rejected instead of guessing whether
  it was only a defaulted value.
- 2026-05-12 16:22 EDT: Moved `TRL-694` to `In Progress`, created
  `trl-694-suppress-static-resource-accessor-warnings-when-string`, and fixed
  the `static-resource-accessor-preference` shadowing edge. String-literal
  resource lookups now carry the declared resource names shadowed at the lookup
  site so an ID-resolved warning is suppressed when its suggested static helper
  name is locally rebound inside `blaze`.

## Verification Log

| Check | Result | Notes |
| --- | --- | --- |
| `bun scripts/adr.ts map` | Pending |  |
| `bun scripts/adr.ts check` | Pending |  |
| `bun run typecheck` | Pending |  |
| `bun run test` | Pending |  |
| `bun run lint` | Pending |  |
| `bun run lint:ast-grep` | Pending |  |
| `bun run build` | Pending |  |
| `bun run format:check` | Pending |  |
| `bun run check` | Pending |  |
| `bun run dead-code` | Pending |  |
| `git diff --check` | Pending |  |

Branch `TRL-655` focused checks:

- `bun test packages/topographer/src/__tests__/topo-store-read.test.ts` -
  passed, 8 tests / 41 expects.
- `bun run typecheck` - passed.
- `bun run format:check` - passed.
- `bun run lint` - passed.
- `git diff --check` - passed.

Branch `TRL-656` focused checks:

- `bun test packages/topographer/src/__tests__/topo-store.test.ts
  packages/topographer/src/__tests__/topo-store-read.test.ts` - passed,
  29 tests / 169 expects.
- `bun run typecheck` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-657` focused checks:

- `bun test packages/topographer/src/__tests__/topo-store-read.test.ts` -
  passed, 9 tests / 45 expects.
- `bun test apps/trails/src/__tests__/survey.test.ts` - passed, 41 tests /
  136 expects.
- `bun run typecheck` - passed after aligning `CurrentTrailDetail` with
  `TrailDetailReport` and exporting the TopoGraph activation edge/source types
  used by the survey report.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-653` focused checks:

- `bun scripts/adr.ts map` - passed and refreshed ADR decision maps.
- `bun scripts/adr.ts check` - passed with 0 errors / 0 warnings.
- `bun scripts/vocab-cutover-audit.ts --rule connector-term` - passed.
- Manual active stale-term sweep excluding historical/migration/retired-vocabulary
  files - clean.
- `bun run typecheck` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-702` focused checks:

- `bun scripts/vocab-cutover-audit.ts --list-rules` - passed and showed the new
  `topograph-artifact-family-retired-term` rule.
- `bun scripts/vocab-cutover-audit.ts --rule
  topograph-artifact-family-retired-term` - passed after keeping guard
  documentation free of banned retired literals.
- `bun scripts/vocab-cutover-audit.ts` - passed after adding
  `docs/adr/0044-trail-versioning.md` to reviewed ADR mention paths.
- `bun run lint:ast-grep` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-692` focused checks:

- `bun test packages/warden` - passed, 886 tests / 2180 expects.
- `bun test apps/trails/src/__tests__/warden.test.ts` - passed, 15 tests /
  87 expects.
- `bun run typecheck` - passed.
- `bun run warden:skills:sync` - refreshed generated skill Warden references
  after the agent instruction wording changed from category to concern.
- `bun run warden:agents:check` - passed.
- `bun run warden:skills:check` - passed after sync.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-690` focused checks:

- `bun test packages/warden/src/__tests__/cli.test.ts` - passed, 39 tests /
  95 expects.
- `bun test apps/trails/src/__tests__/warden.test.ts` - passed, 16 tests /
  88 expects.
- `bun test packages/warden` - passed, 887 tests / 2181 expects.
- `bun run typecheck` - passed.
- `bun run format:check` - initially failed on app Warden wrapper/test wrapping;
  fixed with targeted Ultracite formatting and reran successfully.
- `git diff --check` - passed.

Branch `TRL-691` focused checks:

- `bun test scripts/__tests__/sync-agents-warden-guide.test.ts
  scripts/__tests__/sync-skill-warden-guide.test.ts` - passed, 8 tests /
  24 expects.
- `bun run warden:agents:sync` - refreshed generated AGENTS Warden block.
- `bun run warden:skills:sync` - refreshed generated skill Warden references.
- `bun run warden:agents:check` - passed.
- `bun run warden:skills:check` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-693` focused checks:

- `bun test packages/cli` - passed, 221 tests / 561 expects.
- `bun test adapters/commander` - passed, 43 tests / 84 expects.
- `bun run typecheck` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-694` focused checks:

- `bun test
  packages/warden/src/__tests__/static-resource-accessor-preference.test.ts` -
  passed, 15 tests / 28 expects.
- `bun run lint` - passed.
- `bun run format:check` - passed.
- `git diff --check` - passed.

## Review Feedback

Record P0/P1/P2 feedback, owning branches, fixes, replies, and unresolved P3s.

| Source | Branch | Severity | Finding | Resolution |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Final State

Do not mark complete until:

- all thirteen PRs have been built and submitted;
- local review is P3-only or clean;
- post-execution doctrine verification is complete;
- CI is green before ready;
- ready waves have completed;
- P2+ remote feedback is resolved or reported after the allowed review turns;
- no merge queue label was added;
- nothing was merged;
- the final transcript contains branch/PR status, checks run, skipped checks,
  remaining P3s/risks, and blocker status.
