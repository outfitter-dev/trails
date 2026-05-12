# References: TopoGraph Query + V1 Closeout Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo guidance, Graphite workflow, subagent limits, Linear hygiene, Warden guide, testing, release, and Bun publish conventions.
- `.agents/plans/PLANNING.md` - tracked goal-planning conventions for future `/goal` packets in Trails.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md` - canonical execution plan for this stack.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/GOAL.md` - pasteable goal prompt.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md` - running execution log for the goal.
- `docs/adr/0046-lock-v3-artifact-family.md` - artifact-family doctrine for `.trails/trails.lock`, `.trails/topo.lock`, `.trails/state/`, and related vocabulary.
- `docs/lexicon.md` - target for TopoGraph and retired-vocabulary lexicon updates.
- `docs/tenets.md` - possible target for optional resolved-graph wording cleanup.
- `docs/adr/0021-draft-state-stays-out-of-the-resolved-graph.md` - accepted ADR with stale tenet citation to refresh under `TRL-653`.
- `docs/adr/0035-surface-apis-render-the-graph.md` - accepted ADR with stale tenet citation to refresh under `TRL-653`.
- `docs/adr/0042-core-topographer-boundary-doctrine.md` - accepted ADR with stale tenet citation to refresh under `TRL-653`.

## Untracked / Local-Only Sources

These scratch docs informed the packet, but the goal should be executable from tracked sources above.

- `.scratch/2026-05-12-topograph-query-docs-stack/PLAN.md` - superseded by this tracked packet's `PLAN.md`.
- `.scratch/2026-05-12-topograph-query-docs-stack/goal-prompt.md` - superseded by this tracked packet's `GOAL.md`.
- `.scratch/2026-05-12-topograph-query-docs-stack/execution-retro.md` - copied into this tracked packet's `RETRO.md` and adapted for the new location.
- `.scratch/2026-05-11-lock-v3-topo-graph-plan/execution-retro.md` - background summary for Stack 1's shipped state; key outcomes are summarized in `PLAN.md`.
- `.scratch/2026-05-11-lock-v3-topo-graph-plan/execution-plan.md` - background doctrine/branch-order context for Stack 1; this packet supersedes it for the next stack.
- `.scratch/2026-05-11-lock-v3-topo-graph-plan/README.md` - background map for Stack 1; this packet supersedes it for the next stack.
- `.scratch/2026-05-09-warden-guidance-knip/execution-retro.md` - background for `TRL-690` through `TRL-694`; summarized as Warden/CLI polish follow-ups in `PLAN.md`.

## Copied Or Summarized Sources

- `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md` - adapted from the ignored scratch plan and updated for tracked packet conventions, no-absorb branch repair, local review bias, and canonical report paths under `reports/`.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md` - copied from the scratch execution retro seed and updated for the tracked packet.
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/` - canonical location for local review reports, doctrine verification, and v1 audit outputs created by the goal executor.

## Tracker Records

- `TRL-659` - M4b parent decision/closeout issue; should remain open until this stack merges unless scope is split again.
- `TRL-655` - typed TopoGraph/topo-store query helpers; branch `trl-655-add-typed-topo-store-views-over-topograph-saved-state`.
- `TRL-656` - persisted `topo_surfaces` row honesty; branch `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial`.
- `TRL-657` - complete resolved contract detail view for blind agents; branch `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents`.
- `TRL-653` - docs/API/agent guidance TopoGraph sweep; branch `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph`.
- `TRL-702` - retired vocabulary guard; branch `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces`.
- `TRL-692` - Warden guide manifest category/concern naming; branch `trl-692-clarify-warden-guide-manifest-category-naming-before`.
- `TRL-690` - Warden guidance link rendering and schema reuse; branch `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse`.
- `TRL-691` - generated Warden guide headers and generator tests; branch `trl-691-polish-generated-warden-guide-headers-and-generator-tests`.
- `TRL-693` - CLI value-alias conflict behavior for non-Commander callers; branch `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers`.
- `TRL-694` - static resource accessor warning suppression; branch `trl-694-suppress-static-resource-accessor-warnings-when-string`.
- `TRL-634` - M3 cross-surface parity audit; branch `trl-634-audit-cross-surface-parity-coverage-gaps`.
- `TRL-636` - M5 docs/examples v1 readiness audit; branch `trl-636-audit-docs-and-examples-for-v1-readiness`.
- `TRL-637` - M6 release process and beta-to-1.0 cutover audit; branch `trl-637-audit-release-process-and-beta-to-10-cutover-requirements`.

Tracker updates made during planning:

- `TRL-634` deliverable and acceptance criteria now point at `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md`.
- `TRL-636` deliverable and acceptance criteria now point at `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md`.
- `TRL-637` deliverable and acceptance criteria now point at `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md`.
- `TRL-637` release wording now uses Bun publish flow and repo publish scripts rather than npm publish or changeset publish.

## PRs / Branches

- Stack 1 PRs `#480` through `#487` - must be verified as merged to `main` before execution starts.
- Current planning base at packet creation: `main` at `bbb1ea4ff` (`feat: move workspace index to topo lock (#487)`), per `goal-planning` context primer.
- Existing unrelated branch noted at packet creation: `chore/docs-freshness-taxonomy-vocab` / PR `#479` draft and needs restack. Do not let this alter the TopoGraph stack unless live preflight shows a real dependency.

## Prior Plans

- `.scratch/2026-05-12-topograph-query-docs-stack/PLAN.md` - superseded by this tracked packet.
- `.scratch/2026-05-11-lock-v3-topo-graph-plan/execution-plan.md` - prior M4b Stack 1 plan; useful historical context only.
- `.scratch/2026-05-09-warden-guidance-knip/stack-plan.md` and related retro - prior Warden/Knip capstone; useful for why `TRL-690` through `TRL-694` exist.
- `.scratch/2026-05-03-stack-deviation-audit/course-correction-2026-05-04/pre-ready-local-review-plan-2026-05-05.md` - prior local-review model reused here: review from tip, fix from bottom-most owning branch upward.
- `.scratch/2026-05-09-observability-public-surface/stack-plan.md` - prior no-absorb review-fix language reused here.

## Validation Commands

- `bun scripts/adr.ts map` - regenerates/validates ADR map when ADR text changes.
- `bun scripts/adr.ts check` - checks ADR map and decision metadata.
- `bun run typecheck` - TypeScript type gate.
- `bun run test` - repo test gate.
- `bun run lint` - repo lint gate.
- `bun run lint:ast-grep` - ast-grep lint gate.
- `bun run build` - repo build gate.
- `bun run format:check` - formatting gate.
- `bun run check` - aggregate repo gate.
- `bun run dead-code` - dead-code/Knip gate.
- `bun run warden:agents:sync` - regenerate agent Warden guide blocks when needed.
- `bun run warden:skills:sync` - regenerate skill Warden guide blocks when needed.
- `bun run warden:agents:check` - verify generated agent Warden guide blocks.
- `bun run warden:skills:check` - verify generated skill Warden guide blocks.
- `bun run publish:check` - Bun-based package publish dry-run/integrity check.
- `git diff --check` - whitespace and patch sanity check.

## Planning Notes

- The `goal-planning` context primer produced useful repo/Graphite context, then hit a local `jq --argfile` compatibility error while listing open PRs. Treat the primer's partial output as advisory and re-check live PR/Linear state during preflight.
- This packet intentionally keeps one thirteen-PR Graphite chain for throughput, with remote readying in three waves to preserve review signal.
- This packet intentionally forbids `gt absorb` for review fixes. Use owning-branch checkout, `git branch --show-current`, `gt modify`, and `gt restack` instead.
