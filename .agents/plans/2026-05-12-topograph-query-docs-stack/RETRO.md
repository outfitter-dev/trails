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
| 1 | `TRL-655` | `trl-655-add-typed-topo-store-views-over-topograph-saved-state` | [#488](https://github.com/outfitter-dev/trails/pull/488) | Ready; CI green; review clean |
| 2 | `TRL-656` | `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` | [#489](https://github.com/outfitter-dev/trails/pull/489) | Ready; CI green; review clean |
| 3 | `TRL-657` | `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents` | [#490](https://github.com/outfitter-dev/trails/pull/490) | Ready; CI green; review clean |
| 4 | `TRL-653` | `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph` | [#491](https://github.com/outfitter-dev/trails/pull/491) | Ready; CI green; review clean |
| 5 | `TRL-702` | `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces` | [#492](https://github.com/outfitter-dev/trails/pull/492) | Ready; CI green; review clean |
| 6 | `TRL-692` | `trl-692-clarify-warden-guide-manifest-category-naming-before` | [#493](https://github.com/outfitter-dev/trails/pull/493) | Ready; CI green; review clean after changeset fix |
| 7 | `TRL-690` | `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse` | [#494](https://github.com/outfitter-dev/trails/pull/494) | Ready; CI green; review neutral/clean |
| 8 | `TRL-691` | `trl-691-polish-generated-warden-guide-headers-and-generator-tests` | [#495](https://github.com/outfitter-dev/trails/pull/495) | Ready; CI green; review clean |
| 9 | `TRL-693` | `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers` | [#496](https://github.com/outfitter-dev/trails/pull/496) | Ready; CI green; review clean |
| 10 | `TRL-694` | `trl-694-suppress-static-resource-accessor-warnings-when-string` | [#497](https://github.com/outfitter-dev/trails/pull/497) | Ready; CI green; review neutral/clean |
| 11 | `TRL-634` | `trl-634-audit-cross-surface-parity-coverage-gaps` | [#498](https://github.com/outfitter-dev/trails/pull/498) | Ready; CI green; review clean |
| 12 | `TRL-636` | `trl-636-audit-docs-and-examples-for-v1-readiness` | [#499](https://github.com/outfitter-dev/trails/pull/499) | Ready; CI green; review clean after audit wording fix |
| 13 | `TRL-637` | `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` | [#500](https://github.com/outfitter-dev/trails/pull/500) | Ready; CI green; review clean after runbook fix |

## Tracker Mutations

Record issues, milestones, dependency links, comments, labels, and follow-up
issues created or updated during execution.

| Item | Mutation | Link / Notes |
| --- | --- | --- |
| `TRL-634` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m3-parity-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md`; added note to use TopoGraph/topo-store query APIs from `TRL-655`/`TRL-657`. | Planning alignment |
| `TRL-636` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m5-docs-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md`; added note that this runs after `TRL-653`/`TRL-702`. | Planning alignment |
| `TRL-637` | Updated deliverable and acceptance criteria from ignored `.scratch/v1-release-prep/m6-release-process-audit.md` to tracked `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md`; changed release wording from npm publish flow to Bun publish flow and repo scripts. | Planning alignment |
| `TRL-634` | Moved to `In Progress` when the audit branch started. | [TRL-634](https://linear.app/outfitter/issue/TRL-634/audit-cross-surface-parity-coverage-gaps) |
| `TRL-704` | Created M3 follow-up for a first-party HTTP harness and `testAllEstablished()` HTTP projection validation. | [TRL-704](https://linear.app/outfitter/issue/TRL-704/add-http-surface-harness-and-include-it-in-testallestablished) |
| `TRL-705` | Created M3 follow-up for example-driven CLI/MCP/HTTP parity execution and CI gate. | [TRL-705](https://linear.app/outfitter/issue/TRL-705/add-example-driven-climcphttp-parity-runner-and-ci-gate) |
| `TRL-706` | Created M3 follow-up for a complete shipped-surface projection inventory consumable by blind parity audits. | [TRL-706](https://linear.app/outfitter/issue/TRL-706/expose-complete-shipped-surface-projection-inventory-for-blind-parity) |
| `TRL-636` | Moved to `In Progress` when the docs audit branch started. | [TRL-636](https://linear.app/outfitter/issue/TRL-636/audit-docs-and-examples-for-v1-readiness) |
| `TRL-707` | Created M5 follow-up for the fresh generated-project install blocker caused by missing `@ontrails/commander` on npm. | [TRL-707](https://linear.app/outfitter/issue/TRL-707/fix-fresh-start-install-blocker-for-generated-cli-projects) |
| `TRL-708` | Created M5 follow-up to expand README TypeScript snippet verification beyond `packages/tracing/README.md`. | [TRL-708](https://linear.app/outfitter/issue/TRL-708/expand-readme-typescript-snippet-verification-beyond-tracing) |
| `TRL-709` | Created M5 follow-up for a code-fence-aware relative Markdown link integrity check. | [TRL-709](https://linear.app/outfitter/issue/TRL-709/add-markdown-link-integrity-check-for-docs-and-readmes) |
| `TRL-710` | Created M5 follow-up for a public API `@example` coverage inventory/gate. | [TRL-710](https://linear.app/outfitter/issue/TRL-710/create-public-api-example-coverage-inventory-and-gate) |
| `TRL-636` | Moved to `In Review` when PR #499 was marked ready. | [TRL-636](https://linear.app/outfitter/issue/TRL-636/audit-docs-and-examples-for-v1-readiness) |
| `TRL-637` | Moved to `In Progress` when the release audit branch started. | [TRL-637](https://linear.app/outfitter/issue/TRL-637/audit-release-process-and-beta-to-10-cutover-requirements) |
| `TRL-711` | Created M6 follow-up to codify the beta-to-1.0 release runbook. | [TRL-711](https://linear.app/outfitter/issue/TRL-711/codify-the-beta-to-10-release-runbook) |
| `TRL-712` | Created M6 follow-up to author the stable 1.x release doctrine ADR. | [TRL-712](https://linear.app/outfitter/issue/TRL-712/author-stable-release-doctrine-adr-for-the-1x-line) |
| `TRL-713` | Created M6 follow-up to repair stale Changesets references before stable cutover. | [TRL-713](https://linear.app/outfitter/issue/TRL-713/repair-stale-changesets-references-before-stable-cutover) |
| `TRL-714` | Created M6 follow-up to add registry availability and dist-tag release preflights. | [TRL-714](https://linear.app/outfitter/issue/TRL-714/add-registry-availability-and-dist-tag-release-preflights) |
| `TRL-634` | Moved to `In Review` when PR #498 was marked ready. | [TRL-634](https://linear.app/outfitter/issue/TRL-634/audit-cross-surface-parity-coverage-gaps) |
| `TRL-637` | Moved to `In Review` when PR #500 was marked ready. | [TRL-637](https://linear.app/outfitter/issue/TRL-637/audit-release-process-and-beta-to-10-cutover-requirements) |
| Stack issues | Confirmed all thirteen stack issues are `In Review` after ready waves; no issue was moved to `Done`. | `TRL-655`, `TRL-656`, `TRL-657`, `TRL-653`, `TRL-702`, `TRL-692`, `TRL-690`, `TRL-691`, `TRL-693`, `TRL-694`, `TRL-634`, `TRL-636`, `TRL-637` |

## Local Review Reports

Reports should live under
`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/`.

| Round | Lane | Report | Result |
| --- | --- | --- | --- |
| 1 | Topographer API | `reports/local-review-topographer-round-1.md` | P2 fixed on `TRL-657`; P3 carried |
| 1 | Persistence honesty | `reports/local-review-persistence-round-1.md` | P2 fixed on `TRL-656` |
| 1 | Docs/vocab | `reports/local-review-docs-vocab-round-1.md` | P2 fixed on `TRL-653`/`TRL-702`; P3 carried |
| 1 | Warden/CLI polish | `reports/local-review-warden-cli-round-1.md` | Clean |
| 1 | V1 audit | `reports/local-review-v1-audit-round-1.md` | P2 fixed on `TRL-634`; P3 tracked |
| 2 | Topographer API | `reports/local-review-topographer-round-2.md` | P2 fixed on `TRL-657`; P3 carried |
| 2 | Persistence honesty | `reports/local-review-persistence-round-2.md` | Clean |
| 2 | Docs/vocab | `reports/local-review-docs-vocab-round-2.md` | P3-only |
| 2 | Warden/CLI polish | `reports/local-review-warden-cli-round-2.md` | Clean |
| 2 | V1 audit | `reports/local-review-v1-audit-round-2.md` | P2 fixed on `TRL-634` |
| 3 | Topographer API | `reports/local-review-topographer-round-3.md` | P3-only |
| 3 | Persistence honesty | `reports/local-review-persistence-round-3.md` | Clean |
| 3 | Docs/vocab | `reports/local-review-docs-vocab-round-3.md` | P2 reported from stale evidence; superseded by round 4 |
| 3 | Warden/CLI polish | `reports/local-review-warden-cli-round-3.md` | Clean |
| 3 | V1 audit | `reports/local-review-v1-audit-round-3.md` | Clean |
| 4 | Docs/vocab | `reports/local-review-docs-vocab-round-4.md` | Clean |
| Doctrine | Post-execution verification | `reports/post-execution-verification.md` | Clean/P3-only after `TRL-702` fix |

If round 3 still finds any P0/P1/P2 issue, add round 4+ rows and continue.

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| M3 parity | `@ontrails/testing` exports CLI and MCP harnesses, but no HTTP harness, and `testAllEstablished()` validates only CLI/MCP projection builds. | Audit-only branch; implementation belongs in focused follow-up. | [TRL-704](https://linear.app/outfitter/issue/TRL-704/add-http-surface-harness-and-include-it-in-testallestablished) |
| M3 parity | No current runner executes the same trail example across CLI, MCP, and HTTP and compares normalized Result/error semantics. | Audit-only branch; implementation belongs in focused follow-up. | [TRL-705](https://linear.app/outfitter/issue/TRL-705/add-example-driven-climcphttp-parity-runner-and-ci-gate) |
| M3 parity | Blind agents cannot query a complete shipped-surface projection inventory from one artifact-backed view; the audit had to combine topo-store reads with surface-package derivation. | Needs a small design choice about app-level helper versus durable schema expansion. | [TRL-706](https://linear.app/outfitter/issue/TRL-706/expose-complete-shipped-surface-projection-inventory-for-blind-parity) |
| M5 docs | Fresh generated projects that include the CLI surface currently fail `bun install` because `@ontrails/commander@^1.0.0-beta.15` returns npm 404. | Audit-only branch; implementation/publishing fix belongs in follow-up. | [TRL-707](https://linear.app/outfitter/issue/TRL-707/fix-fresh-start-install-blocker-for-generated-cli-projects) |
| M5 docs | README TypeScript snippet verification covers only `packages/tracing/README.md` despite 21 consumer-facing package/app/adapter READMEs. | Audit-only branch; checker expansion belongs in follow-up. | [TRL-708](https://linear.app/outfitter/issue/TRL-708/expand-readme-typescript-snippet-verification-beyond-tracing) |
| M5 docs | Ad hoc relative-link scan found broken docs/ADR links and one false positive from a code fence, proving the need for a proper Markdown-aware checker. | Audit-only branch; checker plus fixes belong in follow-up. | [TRL-709](https://linear.app/outfitter/issue/TRL-709/add-markdown-link-integrity-check-for-docs-and-readmes) |
| M5 docs | Public API `@example` coverage is sparse and ungated, especially across shipped surface package entrypoints. | Needs M1 public-export inventory before a clean coverage gate. | [TRL-710](https://linear.app/outfitter/issue/TRL-710/create-public-api-example-coverage-inventory-and-gate) |
| M6 release | Stable cutover lacks a durable runbook with preconditions, command order, post-publish verification, and partial-publish handling. | Audit-only branch; durable release docs belong in follow-up. | [TRL-711](https://linear.app/outfitter/issue/TRL-711/codify-the-beta-to-10-release-runbook) |
| M6 release | Stable 1.x release doctrine is not captured in an ADR. | Needs a focused doctrine PR instead of being buried in an audit report. | [TRL-712](https://linear.app/outfitter/issue/TRL-712/author-stable-release-doctrine-adr-for-the-1x-line) |
| M6 release | `bunx changeset status --verbose` fails because `.changeset/logtape-observe-target.md` references retired `@ontrails/logging`. | Audit-only branch; release-state repair belongs in follow-up. | [TRL-713](https://linear.app/outfitter/issue/TRL-713/repair-stale-changesets-references-before-stable-cutover) |
| M6 release | `bun run publish:check` passes while registry probes show several non-private packages missing or inaccessible at `1.0.0-beta.15`. | Needs a release preflight/gate that complements local packability. | [TRL-714](https://linear.app/outfitter/issue/TRL-714/add-registry-availability-and-dist-tag-release-preflights) |

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
- 2026-05-12: Moved `TRL-634` to `In Progress`, created
  `trl-634-audit-cross-surface-parity-coverage-gaps`, produced
  `reports/m3-parity-audit.md`, and filed follow-ups `TRL-704`, `TRL-705`, and
  `TRL-706`. The audit found 37 trails across `@ontrails/trails` and
  `trails-demo`: 34 public surface-eligible trails project on CLI/MCP/HTTP, 2
  are intentionally internal (`create.scaffold`, `add.verify`), 1 public
  activation consumer (`entity.notify-updated`) is excluded from callable
  surfaces by activation-source filtering, and WebSocket remains
  planned/not shipped.
- 2026-05-12: Moved `TRL-636` to `In Progress`, created
  `trl-636-audit-docs-and-examples-for-v1-readiness`, produced
  `reports/m5-docs-audit.md`, and filed follow-ups `TRL-707`, `TRL-708`,
  `TRL-709`, and `TRL-710`. The audit found one hard fresh-start blocker
  (`@ontrails/commander` missing from npm) plus README snippet, link-integrity,
  and `@example` coverage gaps.
- 2026-05-12: Moved `TRL-637` to `In Progress`, created
  `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`,
  produced `reports/m6-release-process-audit.md`, and filed follow-ups
  `TRL-711`, `TRL-712`, `TRL-713`, and `TRL-714`. The audit confirmed the Bun
  publish script and prerelease dist-tag behavior, then found stable-runbook,
  stable-doctrine, stale Changesets, and registry preflight gaps.
- 2026-05-12: Completed three local review rounds from the stack tip. Round 1
  P2 findings were fixed on owning branches `TRL-656`, `TRL-657`, `TRL-653`,
  `TRL-702`, and `TRL-634`; round 2 P2 findings were fixed on `TRL-657` and
  `TRL-634`; round 3 returned clean/P3-only in four lanes, while docs/vocab
  reported a stale P2 against `TRL-702`.
- 2026-05-12: Ran a focused round 4 docs/vocab verification from the live stack
  tip. It confirmed `TRL-702` already uses exact line-scoped
  `topographArtifactFamilyRetiredMatches` for active cleanup/migration seams
  and returned clean for P0/P1/P2.
- 2026-05-12: Ran the distinct post-execution doctrine verification pass. It
  returned clean for P0/P1/P2, with only P3 internal generator variable naming,
  compact API-reference polish, optional Linear readback, and absent physical
  lock artifacts noted as residual context.

## Verification Log

| Check | Result | Notes |
| --- | --- | --- |
| `bun scripts/adr.ts map` | Passed | Refreshed ADR maps; no persisted diff remained. |
| `bun scripts/adr.ts check` | Passed | 0 errors, 0 warnings. |
| `bun run typecheck` | Passed | 21 successful tasks. |
| `bun run test` | Passed | 36 successful tasks after the `TRL-657` guide schema fixture repair. |
| `bun run lint` | Passed | 22 successful tasks. |
| `bun run lint:ast-grep` | Passed | ast-grep scan completed cleanly. |
| `bun run build` | Passed | 21 successful tasks. |
| `bun run format:check` | Passed | Ultracite check clean. |
| `bun run check` | Passed | Aggregate gate passed; Warden report remained PASS with known warnings. |
| `bun run dead-code` | Passed | knip completed cleanly. |
| `bun run warden:agents:sync && bun run warden:skills:sync && bun run warden:agents:check && bun run warden:skills:check` | Passed | Generated Warden guidance stayed synced. |
| `bun run publish:check` | Passed | All non-private package pack checks passed. |
| `git diff --check` | Passed | Whitespace check clean. |

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

Branch `TRL-634` focused checks:

- `bun run check` - passed. Warden reported existing warnings only and still
  returned `PASS`; no P0/P1/P2 branch findings.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-636` focused checks:

- `bun run docs:snippets` - passed; current checker reports
  `packages/tracing/README.md` only, which is captured as follow-up `TRL-708`.
- `bun run check` - passed. Warden reported existing warnings only and still
  returned `PASS`; no P0/P1/P2 branch findings.
- `bun run format:check` - passed.
- `git diff --check` - passed.

Branch `TRL-637` focused checks:

- `bun run publish:check` - passed for every non-private packable workspace.
- `bunx changeset status --verbose` - failed because
  `.changeset/logtape-observe-target.md` references retired
  `@ontrails/logging`; captured as release-process follow-up `TRL-713`, not a
  branch implementation failure.
- Read-only registry probe with `npm view <package> version --json` found
  missing or inaccessible package versions for `@ontrails/commander`,
  `@ontrails/observe`, `@ontrails/topographer`, and `@ontrails/wayfinder`;
  captured as follow-up `TRL-714`.
- `bun run check` - passed. Warden reported existing warnings only and still
  returned `PASS`; no P0/P1/P2 branch implementation findings.
- `bun run format:check` - passed.
- `git diff --check` - passed.

## Review Feedback

Record P0/P1/P2 feedback, owning branches, fixes, replies, and unresolved P3s.

| Source | Branch | Severity | Finding | Resolution |
| --- | --- | --- | --- | --- |
| Greptile PR #488 | `TRL-655` | P2 | Topo-store write-intent filtering, signal usage map allocation, and mock `.get` snapshot behavior diverged from the intended query contract. | Fixed in `032b2fd51e46`; replied to and resolved the review thread. |
| Greptile PR #490 | `TRL-657` | P2 | Resolved trail detail mixed graph-wide activation context with per-trail records and rederived `TopoGraph` unnecessarily. | Fixed in `49ea3979d043`; new focused store/survey coverage passed. |
| Greptile PR #491 | `TRL-653` | P2 | `decision-map.json` had a misleading ADR-0046 inbound context from `docs/topo-store-reference.md`. | Fixed in `34be13aaf331`; added explicit ADR-0046 link and regenerated the map, then replied/resolved the thread. |
| Greptile PR #492 | `TRL-702` | P2 | Retired-vocabulary exclusions duplicated historical paths. | Fixed in `8444ff95dff3`; replied to and resolved the review thread. |
| Greptile PR #493 | `TRL-692` | P2 | Warden guide `category` to `concern` contract rename was represented as a patch bump instead of a minor release bump. | Fixed in `4e85a96b7d7e`; changeset now marks `@ontrails/trails` and `@ontrails/warden` as minor, then replied to the review thread. |
| Greptile PR #499 | `TRL-636` | P2 | M5 audit severity wording did not match the high-priority TRL-707 blocker, and `RETRO.md` missed the `TRL-636` In Review transition. | Fixed in `8e0afca06247`; replied to and resolved both review threads. |
| Greptile PR #500 | `TRL-637` | P2 | Release runbook used hardcoded `/usr/bin/git` paths. | Fixed in `b497680720d8`; replied to and resolved the review thread. |

## Final State

- All thirteen PRs have been built, submitted, and marked ready in the planned
  waves.
- Local review completed with the latest pass clean or P3-only; post-execution
  doctrine verification is clean/P3-only.
- Core CI is green on every PR. Graphite `mergeability_check` remains pending
  on stack descendants because the stack has not been merged.
- P2+ remote feedback has been fixed and replied to; final review-thread scrape
  showed no unresolved threads.
- No merge queue label was added.
- Nothing was merged.
- Remaining P3s/risks: compact API docs omit some exported topo-store record
  types; Warden guide internals still use local `category` variable names while
  the public contract is `concern`; physical `.trails/trails.lock` and
  `.trails/topo.lock` were not present in the local workspace snapshot.
