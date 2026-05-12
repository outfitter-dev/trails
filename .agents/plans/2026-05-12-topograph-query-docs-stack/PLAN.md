# TopoGraph Query + V1 Closeout Stack

Date: 2026-05-12
Status: Ready for goal kickoff

This packet prepares a more ambitious follow-on after the lock v3 / TopoGraph artifact-family implementation stack. It assumes the Stack 1 PRs have been queued for merge and should be verified as landed before work starts.

The stack is now thirteen PRs plus one local-state cleanup step. It closes the M4b TopoGraph query/docs lane, picks up the small post-review Warden/CLI polish issues that are still open, then lands the three remaining v1 Release Prep audits so the project has fresh evidence for the next real implementation wave.

Do not use the Trails skill for this work. It is out of date for the current artifact-family doctrine and has confused earlier runs.

## Source Of Truth

Read these first, in order:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-12-topograph-query-docs-stack/PLAN.md`
4. `.agents/plans/2026-05-12-topograph-query-docs-stack/REFS.md`
5. ADR-0046: `docs/adr/0046-lock-v3-artifact-family.md`
6. Linear issues `TRL-655`, `TRL-656`, `TRL-657`, `TRL-653`, `TRL-702`, `TRL-692`, `TRL-690`, `TRL-691`, `TRL-693`, `TRL-694`, `TRL-634`, `TRL-636`, `TRL-637`, and parent `TRL-659`

This tracked packet is the canonical source for the next goal. It supersedes the ignored scratch packet at `.scratch/2026-05-12-topograph-query-docs-stack/`. Prior scratch retros and planning docs from the Stack 1 TopoGraph work and Warden guidance work are summarized in `REFS.md`; they are useful background, but the executor should not need chat history or ignored scratch docs to execute this plan.

## Recent Linear Adjustments Checked

The live Linear graph still supports the original five-PR M4b Stack 2, but it is not ambitious enough by itself. Recent Linear checks changed the plan in three ways:

- `TRL-653` now includes deferred cleanup from Stack 1 verification: accepted ADRs still quoting the old tenet heading "the resolved graph is the story" must be updated to the current heading "The resolved topo artifact family is the story."
- Required ADR citation targets:
  - `docs/adr/0021-draft-state-stays-out-of-the-resolved-graph.md`
  - `docs/adr/0035-surface-apis-render-the-graph.md`
  - `docs/adr/0042-core-topographer-boundary-doctrine.md`
- `docs/tenets.md` still has some descriptive "resolved graph" prose that Linear calls optional/lower priority; decide during the sweep whether to update for total consistency or leave as generic descriptive language.
- `TRL-702` has been updated to include `.trails/trails.db` and sidecar paths as retired current-target vocabulary. Historical mentions remain allowed; active docs and guidance should teach `.trails/state/trails.db`.
- `TRL-681`, `TRL-682`, `TRL-683`, `TRL-684`, `TRL-685`, `TRL-686`, `TRL-688`, and `TRL-689` are already Done, so they are not candidates for this stack.
- `TRL-690`, `TRL-691`, `TRL-692`, `TRL-693`, and `TRL-694` are open, small, and well-scoped post-review follow-ups from the Warden Guidance + Knip capstone.
- `TRL-634`, `TRL-636`, and `TRL-637` are still open v1 Release Prep audits. They are audit/report branches, not broad implementation branches, and they fit well after the TopoGraph/docs guard has landed.
- `TRL-634`, `TRL-636`, and `TRL-637` have been updated for this tracked packet: their canonical audit reports now live under `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/` instead of ignored `.scratch/v1-release-prep/`.
- `TRL-637` has been updated to say Bun publish flow and repo publish scripts (`bun run publish:check`, `bun run publish:packages`), not npm publish or changeset publish.

Current dependency graph:

```text
Stack 1:
TRL-697 -> TRL-655
TRL-697 -> TRL-656
TRL-698/699/700/701 -> TRL-653

Stack 2:
TRL-655 + TRL-656 -> TRL-657 -> TRL-653 -> TRL-702

Expanded tail:
TRL-692 -> TRL-690 -> TRL-691
TRL-693, TRL-694 independent
TRL-634 -> TRL-636 -> TRL-637
```

`TRL-659` remains the M4b parent and should stay open until this closeout stack is merged, unless Matt chooses to split follow-up work again.

No new Linear issue is needed for the old root `.trails/trails.db` files. `TRL-700` and `TRL-703` already delivered the workspace hard-cut and canonical bootstrap. The right handling here is:

- remove untracked legacy root DB sidecars from the local worktree during preflight;
- make sure `TRL-653` docs teach `.trails/state/trails.db`;
- make sure `TRL-702` catches active references that present `.trails/trails.db` as current target state.

## Preflight

Before creating branches:

1. Verify PRs `#480` through `#487` have merged to `main`.
2. Run `gt sync`.
3. Check out current `main`.
4. Confirm no generated `.trails/trails.db*` or `.trails/state/trails.db*` files are staged. These are local state and must not land.
5. Clean the legacy root DB sidecars if they are untracked:

   ```bash
   git status --short .trails/trails.db .trails/trails.db-shm .trails/trails.db-wal
   rm -f .trails/trails.db .trails/trails.db-shm .trails/trails.db-wal
   ```

   Only remove those exact legacy root sidecar paths. Do not delete `.trails/state/`, `.trails/topo.lock`, `.trails/trails.lock`, `.trails/clark/`, or any tracked `.trails/` content.

6. Verify stale workspace directories from the pre-M4b layout are not lingering:

   ```bash
   /usr/bin/find .trails -maxdepth 2 -type d -print | sort
   ```

   After the M4b workspace migration, active local layout should not include `.trails/dev/` or `.trails/generated/`. If those directories are empty and untracked, remove them. If they contain local data, document what is there before deleting anything.

7. Start or refresh `.agents/plans/2026-05-12-topograph-query-docs-stack/RETRO.md` before the first implementation commit.

If Stack 1 has not fully landed, stop and report the exact unmerged PRs instead of building this stack on stale local state.

## Recommended Stack

Build the whole stack locally before pushing. It is fine to create the local branch chain up front, but do not submit or push empty branches. Each branch should have real commits, local verification, and a high-quality PR body before it goes remote.

| Order | Issue | Branch | Role |
| --- | --- | --- | --- |
| 1 | `TRL-655` | `trl-655-add-typed-topo-store-views-over-topograph-saved-state` | Add typed accessors over saved TopoGraph/topo-store state. |
| 2 | `TRL-656` | `trl-656-make-persisted-surface-rows-complete-or-explicitly-partial` | Lock the persisted surface-row posture. |
| 3 | `TRL-657` | `trl-657-add-complete-resolved-contract-detail-view-for-blind-agents` | Add the blind-agent resolved contract detail view. |
| 4 | `TRL-653` | `trl-653-sweep-docs-api-references-and-agent-guidance-for-topograph` | Sweep docs, API refs, agent guidance, migration notes, and late ADR citations. |
| 5 | `TRL-702` | `trl-702-add-retired-vocabulary-guard-for-active-topograph-surfaces` | Add the retired vocabulary guard after the sweep has removed active drift. |
| 6 | `TRL-692` | `trl-692-clarify-warden-guide-manifest-category-naming-before` | Clarify Warden guide manifest field naming before consumers treat it as stable. |
| 7 | `TRL-690` | `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse` | Polish Warden guidance link rendering and reduce schema drift. |
| 8 | `TRL-691` | `trl-691-polish-generated-warden-guide-headers-and-generator-tests` | Polish generated guide headers and generator coverage. |
| 9 | `TRL-693` | `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers` | Tighten value-alias conflict behavior for non-Commander callers. |
| 10 | `TRL-694` | `trl-694-suppress-static-resource-accessor-warnings-when-string` | Fix the narrow static resource accessor warning false-positive. |
| 11 | `TRL-634` | `trl-634-audit-cross-surface-parity-coverage-gaps` | Produce the M3 cross-surface parity audit and file follow-ups. |
| 12 | `TRL-636` | `trl-636-audit-docs-and-examples-for-v1-readiness` | Produce the M5 docs/examples v1 readiness audit and file follow-ups. |
| 13 | `TRL-637` | `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` | Produce the M6 release-process / beta-to-1.0 cutover audit and file follow-ups. |

This ordering should close M4b if Stack 1 has landed and this stack merges cleanly, then give v1 Release Prep fresh M3/M5/M6 evidence. It also clears the remaining small Governance Maturity post-review follow-ups that are already defined.

## PR 1: TRL-655 Typed Topo-Store Views

Expected targets:

- `packages/topographer/src/internal/topo-store-read.ts`
- `packages/topographer/src/topo-store.ts`
- `packages/topographer/src/index.ts`
- `packages/topographer/src/__tests__/topo-store-read.test.ts`
- Potentially `docs/topo-store-reference.md` or TSDoc if the API shape needs brief explanation.

Implementation guidance:

- Treat `TopoGraph` / `.trails/topo.lock` / `topo_graph` as the canonical vocabulary.
- Keep typed views as accessors over canonical saved state. They must not become a second graph truth.
- Prefer extending the existing `topoStore.trails`, `topoStore.resources`, `topoStore.signals`, `topoStore.exports`, and snapshot access pattern over adding an unrelated API family.
- Remove or quarantine raw `JSON.parse(stored.topoGraphJson)` duplication behind typed helpers.
- Cover contours, surfaces, layer attachments, activation metadata, field overrides, examples, schemas, and empty/missing cases where that data already exists in the stored TopoGraph.
- If public `@ontrails/topographer` package contents change, include a branch-local changeset unless the PR is explicitly and truthfully `release:none`.

Verification floor:

```bash
bun test packages/topographer/src/__tests__/topo-store-read.test.ts
bun run typecheck
bun run format:check
```

## PR 2: TRL-656 Persisted Surface-Row Honesty

Expected targets:

- `packages/topographer/src/internal/topo-store.ts`
- `packages/topographer/src/internal/topo-store-read.ts`
- `packages/topographer/src/__tests__/topo-store.test.ts`
- `packages/topographer/src/__tests__/topo-store-read.test.ts`
- `docs/topo-store-reference.md`
- `docs/adr/0015-topo-store.md` only if the existing ADR text actively misleads the new posture.

Recommended decision:

Persisted `topo_surfaces` rows should be documented and tested as an operational query projection, not the canonical complete surface graph. The complete resolved surface detail lives in `TopoGraph`. This matches the current implementation comment in `normalizeSurfaceRows()`, avoids premature SQL schema expansion, and keeps the artifact doctrine honest.

Implementation guidance:

- Make the partial-row posture explicit in code comments/TSDoc and docs.
- Tests should prove consumers can distinguish the row projection from full TopoGraph detail.
- Do not imply SQL rows are complete unless the branch actually makes them complete across CLI/MCP/HTTP/WebSocket.
- If the executor discovers a cheap, clean complete-row implementation, that is allowed, but it must be tested across shipped surfaces and reflected in docs. Default to explicit partial projection.

Verification floor:

```bash
bun test packages/topographer/src/__tests__/topo-store.test.ts
bun test packages/topographer/src/__tests__/topo-store-read.test.ts
bun run typecheck
bun run format:check
```

## PR 3: TRL-657 Blind-Agent Contract Detail

Expected targets:

- `packages/topographer/src/internal/topo-store-read.ts`
- `packages/topographer/src/topo-store.ts`
- `packages/topographer/src/__tests__/topo-store-read.test.ts`
- `apps/trails/src/trails/survey.ts`
- `apps/trails/src/trails/topo-output-schemas.ts`
- `apps/trails/src/__tests__/survey.test.ts`
- `docs/api-reference.md` or `docs/topo-store-reference.md` if public behavior changes.

Implementation guidance:

- Build on TRL-655 and TRL-656. This view should not parse raw `topo.lock` JSON directly.
- Prefer extending the existing trail detail path (`topoStore.trails.get(...)` and `survey.trail`) if it can naturally become the complete resolved contract detail view.
- Include trail id/kind, surfaces and projection metadata, input/output schemas, examples, intent, crosses, resources, activation sources/edges/context, contour/reference metadata, field overrides/layer context, and governance metadata needed by Warden or agent review.
- Missing trail behavior must be explicit and tested.
- CLI/MCP-facing output schemas must match actual returned shape.
- Add a changeset if this expands public `@ontrails/topographer` or app package behavior in a publishable way.

Verification floor:

```bash
bun test packages/topographer/src/__tests__/topo-store-read.test.ts
bun test apps/trails/src/__tests__/survey.test.ts
bun run typecheck
bun run format:check
```

## PR 4: TRL-653 Docs/API/Agent Guidance Sweep

Expected targets:

- `docs/lexicon.md`
- `docs/api-reference.md`
- `docs/topo-store.md`
- `docs/topo-store-reference.md`
- `docs/migration/` new or updated migration note for the artifact-family retirement.
- `packages/topographer/README.md` and other package READMEs if they mention the retired vocabulary.
- `.claude/**/*.md`
- `.agents/**/*.md`
- `.agents/plans/v1/*` where stale plans need an explicit superseded marker.
- `docs/adr/0021-draft-state-stays-out-of-the-resolved-graph.md`
- `docs/adr/0035-surface-apis-render-the-graph.md`
- `docs/adr/0042-core-topographer-boundary-doctrine.md`
- `docs/tenets.md` only if the descriptive "resolved graph" uses are better updated for consistency.

Required vocabulary:

- `.trails/trails.lock` means manifest.
- `.trails/topo.lock` means serialized `TopoGraph` content.
- `TopoGraph` is the exported type family.
- `topoGraph` is JS field naming.
- `topo_graph` is SQL/storage naming.
- `lock_manifest` is stored manifest export naming when that export is stored.
- `.trails/config.local.ts` is ignored local override.
- `.trails/config.local.js` is ignored local override.
- `.trails/state/trails.db` is ignored mutable SQLite state.
- `.trails/state/` is ignored mutable runtime state.
- `.trails/cache/` is ignored rebuildable cache state.

Retired target-state vocabulary:

- `SurfaceMap`
- `_surface.json`
- `surface_map`
- `serialized_lock`
- `.trails/config/local`
- `.trails/trails.db`
- `.trails/dev/`
- `.trails/generated/`

Historical release notes, old migrations, accepted ADR history, and superseded scratch plans can mention retired vocabulary when clearly historical. The one-cycle legacy reset list in `apps/trails/src/trails/dev-support.ts` may mention old state paths as cleanup targets. Active docs and agent guidance should not teach those names as current target state.

Lexicon requirement:

- Add or update `docs/lexicon.md` entries for `TopoGraph`, `topoGraph`, `topo_graph`, `lock_manifest`, `.trails/state/`, `.trails/cache/`, and `.trails/config.local.{ts,js}`.
- Add a discoverable `Retired vocabulary` subsection with replacements and cross-references for `SurfaceMap`, `_surface.json`, `surface_map`, `serialized_lock`, `.trails/config/local`, `.trails/trails.db`, `.trails/dev/`, and `.trails/generated/`.
- Keep historical terms clearly marked as historical so future agents do not relearn the migration from scratch.

Verification floor:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun scripts/vocab-cutover-audit.ts --rule connector-term
bun run format:check
git diff --check
```

Also run a manual stale-term sweep across active docs and guidance. Use `qmd` for local documentation search where useful, and use targeted `rg` for exact token checks.

## PR 5: TRL-702 Retired Vocabulary Guard

Expected targets:

- `scripts/vocab-cutover-map.ts`
- `scripts/vocab-cutover-audit.ts` only if the audit engine needs new behavior.
- Possibly `docs/rule-design.md`, `docs/lexicon.md`, or Warden docs if the chosen guard surface is documented there.
- Tests or fixture coverage for the chosen guard.

Recommended enforcement surface:

Extend the existing `scripts/vocab-cutover-audit.ts` / `scripts/vocab-cutover-map.ts` infrastructure with a dedicated TopoGraph artifact-family rule. It already supports scoped roots and explicit path exclusions, which fits the need to catch active drift while exempting historical/superseded material. Use ast-grep or Warden only if source-structure precision is needed beyond exact vocabulary matching.

Guard terms:

- `SurfaceMap`
- `_surface.json`
- `surface_map`
- `serialized_lock`
- `.trails/config/local`
- `.trails/trails.db`
- `.trails/trails.db-shm`
- `.trails/trails.db-wal`
- `.trails/dev/`
- `.trails/generated/`

Important guard nuance:

- Do not overmatch harmless camel-case local names unless the branch intentionally retires them too. The Linear issue names exact retired target-state vocabulary, not every lowercase `surfaceMap` local variable from old tests.
- Treat `.trails/trails.db` as retired current-target vocabulary. Historical docs can mention it when describing migration from the old layout; active docs and guidance should point to `.trails/state/trails.db`.
- Treat `.trails/dev/` and `.trails/generated/` the same way: historical/changelog/migration mentions are fine; active docs or guidance teaching them as current workspace directories should fail. The legacy reset-file cleanup list in `apps/trails/src/trails/dev-support.ts` is an intentional exemption.
- Exemptions must be explicit and scoped. Good exemptions include historical changelogs, migration notes, old accepted ADR decision history, and superseded scratch/planning directories.
- If Warden guide content changes, run `bun run warden:agents:sync`, `bun run warden:skills:sync`, `bun run warden:agents:check`, and `bun run warden:skills:check`.
- Confirm the new guard is wired into a normal gate. If `bun run check` does not already run the relevant vocab audit, this branch should add that wiring so retired vocabulary fails loudly in CI.

Verification floor:

```bash
bun scripts/vocab-cutover-audit.ts --list-rules
bun scripts/vocab-cutover-audit.ts --rule <new-topograph-rule-id>
bun run lint:ast-grep
bun run format:check
git diff --check
```

## PR 6: TRL-692 Warden Guide Manifest Naming

Expected targets:

- `packages/warden/src/guide.ts`
- `packages/warden/src/__tests__/guide.test.ts` or adjacent guide tests
- Generated Warden guide outputs if the chosen field name changes generated artifacts.
- `docs/warden.md`, `AGENTS.md`, or skill/plugin generated guide snapshots only if the manifest field reaches those outputs.

Implementation guidance:

- Decide whether the manifest contract should expose `category`, `concern`, or both with distinct meanings.
- Prefer the doctrinal term if the value is sourced directly from `WardenRuleMetadata.concern`.
- If the field is renamed pre-stable, document the rationale in the PR and update schemas/tests/generated artifacts in the same branch.
- Keep the diff focused on manifest naming. Do not redesign the guide format.

Verification floor:

```bash
bun test packages/warden
bun run warden:agents:check
bun run warden:skills:check
bun run format:check
```

## PR 7: TRL-690 Warden Guidance Link And Schema Polish

Expected targets:

- `packages/warden/src/cli.ts`
- `packages/warden/src/trails/schema.ts`
- `apps/trails/src/trails/warden.ts`
- Warden CLI / trails-app Warden tests.

Implementation guidance:

- Improve plain-text guidance rendering so labeled docs links keep useful labels while preserving copyable paths/URLs.
- Reduce or eliminate duplicated Warden guidance schema definitions between package and app surfaces.
- Preserve existing JSON, markdown, and `trails warden` output contracts unless TRL-692 intentionally changed the manifest naming.

Verification floor:

```bash
bun test packages/warden
bun test apps/trails/src/__tests__/warden.test.ts
bun run typecheck
bun run format:check
```

## PR 8: TRL-691 Generated Warden Guide Header/Test Polish

Expected targets:

- `scripts/sync-agents-warden-guide.ts`
- `scripts/sync-skills-warden-guide.ts`
- `scripts/__tests__/sync-agents-warden-guide.test.ts`
- Generated AGENTS/skill Warden blocks if header wording changes.

Implementation guidance:

- Rename generated header wording away from ambiguous `Source command` if the command feeds a generated artifact rather than directly producing the final Markdown.
- Add coverage for the orphaned end-only marker case.
- Keep rendering assertions stable: prove important metadata and one categorized rule shape without coupling the test to the entire live manifest.

Verification floor:

```bash
bun test scripts/__tests__/sync-agents-warden-guide.test.ts
bun run warden:agents:check
bun run warden:skills:check
bun run format:check
```

## PR 9: TRL-693 CLI Value-Alias Conflict Tightening

Expected targets:

- `packages/cli/src/*`
- `packages/cli/src/__tests__/*`
- `adapters/commander/src/*` only if the caller contract changes.
- Warden CLI alias tests only if Warden alias UX needs regression coverage.

Implementation guidance:

- Decide whether `userSuppliedFlagKeys` becomes required for `applyCliFlagValueAliases()` or whether the fallback should fail loudly for ambiguous alias + canonical input.
- Add a focused non-Commander test for canonical-default plus active alias input.
- Preserve current Commander behavior and Warden alias UX.
- Update TSDoc/comments so future adapter authors understand the conflict-detection contract.

Verification floor:

```bash
bun test packages/cli
bun test adapters/commander
bun run typecheck
bun run format:check
```

## PR 10: TRL-694 Static Resource Accessor Shadowing

Expected targets:

- `packages/warden/src/rules/static-resource-accessor-preference.ts`
- `packages/warden/src/__tests__/static-resource-accessor-preference.test.ts`

Implementation guidance:

- Add a regression test for string-literal `ctx.resource('id')` where the resolved resource variable name is shadowed inside `blaze`.
- Suppress that shadowed string-literal warning without losing valid warnings for unshadowed string lookups.
- Keep existing dynamic ID, string-only declaration, framework-internal, test, and imported-resource behavior intact.

Verification floor:

```bash
bun test packages/warden/src/__tests__/static-resource-accessor-preference.test.ts
bun run lint
bun run format:check
```

## PR 11: TRL-634 Cross-Surface Parity Audit

Expected targets:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m3-parity-audit.md`
- Linear follow-up issues for parity harness/gates/surface divergences discovered by the audit.

Implementation guidance:

- Use the implemented TopoGraph/topo-store query APIs from PRs 1 and 3 as the authoritative trail list after M4b lands. Do not walk source graphs by hand for data that the new query/detail views are supposed to expose.
- Build a trail x surface coverage matrix for CLI, MCP, HTTP, WebSocket, and internal-only exposure.
- Identify happy-path and failure-path parity coverage, intentional divergences, and missing test harness primitives.
- File focused M3 follow-up issues; do not implement the parity harness in this branch.

Verification floor:

```bash
bun run check
bun run format:check
git diff --check
```

## PR 12: TRL-636 Docs And Examples V1 Readiness Audit

Expected targets:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m5-docs-audit.md`
- Linear follow-up issues for docs/examples/snippet gaps discovered by the audit.

Implementation guidance:

- Run this after TRL-653/702 so docs audit results are not polluted by known TopoGraph vocabulary drift.
- Inventory consumer-facing docs, package/app READMEs, migration docs, ADR index/cross-links, and public examples.
- Include a fresh-checkout/getting-started test with exact commands and verbatim failure output if anything breaks.
- Audit `@example` coverage on public exports and README snippet verification.
- File focused M5 follow-up issues; do not rewrite the whole docs corpus in this branch.

Verification floor:

```bash
bun run docs:snippets
bun run check
bun run format:check
git diff --check
```

## PR 13: TRL-637 Release Process / Beta-To-1.0 Audit

Expected targets:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/m6-release-process-audit.md`
- Linear follow-up issues for release runbook, stable doctrine, and CI/publish gate gaps discovered by the audit.

Implementation guidance:

- The repo publishes with Bun tooling. Use `bun run publish:check` and `bun run publish:packages` language; do not introduce `npm publish` or `changeset publish` guidance.
- Inventory `.changeset/pre.json`, lockstep versioning, dist-tag policy, publish scripts, CI gates, and beta-to-stable command order.
- Produce a runbook detailed enough for another engineer to execute without extra design.
- Recommend the stable release doctrine ADR shape but do not run the release.

Verification floor:

```bash
bun run publish:check
bun run check
bun run format:check
git diff --check
```

## Local Review Loop

Before submitting remote PRs, run multiple local review rounds with subagents. Default to at least three local passes for this stack. If the latest pass still finds any P0/P1/P2 issue, fix it and run another pass. Stop the local review loop only when the latest pass is P3-only or clean.

Reviews start from the stack tip so every reviewer sees the cumulative implementation. Reviewers collect evidence, severity, owning branch, and recommended action. The main agent owns source control and repairs findings from the lowest owning branch upward.

Subagents may edit files, run checks, and write reports, but must not run `git` or `gt` write operations.

Suggested lanes:

1. Topographer API lane: verify typed helper API shape, missing cases, raw JSON quarantine, changesets, and tests.
2. Persistence honesty lane: verify `topo_surfaces` posture, TopoGraph canonicality, migration/schema comments, and docs.
3. Docs/vocabulary lane: verify TRL-653 stale ADR citations, active docs/guidance sweep, migration note, and TRL-702 guard/exemptions.
4. Warden/CLI polish lane: verify TRL-690/691/692/693/694 are scoped, tested, and do not reopen already-merged decisions.
5. V1 audit lane: verify TRL-634/636/637 reports are evidence-backed and filed follow-ups are focused, non-duplicative, and correctly linked.

Each lane should write reports into this directory, for example:

- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-topographer-round-1.md`
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-persistence-round-1.md`
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-docs-vocab-round-1.md`
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-warden-cli-round-1.md`
- `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-v1-audit-round-1.md`

Fix every P0/P1/P2 finding before submitting. It is acceptable to leave documented P3 polish for follow-up if it is not blocking v1 correctness.

Owning-branch fix loop:

1. Triage findings into a bottom-up list by lowest owning branch.
2. `gt checkout <owning-branch>`.
3. Run `git branch --show-current` before any `gt modify -c`.
4. Apply the minimal branch-owned fix.
5. Run focused validation for that branch.
6. Commit with `gt modify` using a Conventional Commit message.
7. `gt restack`.
8. Walk upward through affected descendants, resolving conflicts and running targeted checks as needed.

Do not use `gt absorb` for this stack. Do not use `gt modify --into` from another branch. If the tip gate reveals a downstack problem, check out the branch that owns the concept and repair it there.

Post-execution verification:

- After local implementation and before marking the first wave ready, run a doctrine-verification pass distinct from CI and bot review.
- Brief the verifier to check the actual code/docs against ADR-0046 and this plan's stated targets: workspace layout, lock/topo artifact shape, lexicon entries, retired vocabulary, generated guide source of truth, and audit methodology.
- Record the report in `.agents/plans/2026-05-12-topograph-query-docs-stack/reports/post-execution-verification.md`.
- Fix P0/P1/P2 doctrine mismatches before remote ready, even if ordinary tests and review bots are green.

## Full Tip Gate

At the stack tip, run:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run dead-code
git diff --check
```

If Warden rule content or generated agent guide content changes, also run:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

## PR And Remote Review Discipline

- Use Graphite for branch, restack, submit, and PR operations.
- Main agent owns all source-control writes.
- Subagents must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, or merge commands.
- PR titles should use Conventional Commit style.
- PR bodies should include context, changes, tests, risk/rollout notes, and `Closes: TRL-...`.
- Do not add the merge queue label.
- Do not merge.
- Mark PRs ready only after local review, post-execution verification, and CI have no P0/P1/P2 findings.
- Submit and mark ready in waves even though the branches live in one local chain:
  - Wave 1: PRs 1-5 (M4b closeout).
  - Wave 2: PRs 6-10 (Warden/CLI polish).
  - Wave 3: PRs 11-13 (v1 audits).
  This keeps review-bot signal usable without sacrificing the single execution context.
- After marking ready, wait about 15 minutes, then start checking unresolved review threads and bot comments.
- Resolve everything P2 and above from the bottom of the stack upward.
- If one branch needs more than one substantial revision round, keep the rest of the already-verified stack moving where possible instead of letting one late branch stall all remaining review.
- For downstack fixes, check out the branch that owns the concept directly. Before any `gt modify -c`, run `git branch --show-current`.
- Do not use `gt absorb` as a shortcut for review fixes. The required flow is checkout the owning branch, apply the fix there, `gt modify`, `gt restack`, and walk upward through affected descendants with targeted checks.
- If the tip gate fails, identify the owning branch for the failing concept and fix there; do not paper over downstack issues at the tip.
- After at most four post-ready remote review turns, stop and report current status to Matt.

## Linear Hygiene

- Move each issue to In Progress when its branch starts.
- Move each issue to In Review when its PR is marked ready.
- Do not mark issues Done until after merge.
- If implementation diverges from issue scope, leave a Linear comment on the affected issue explaining the divergence and why.
- Once this stack merges, M4b should be ready to close if Stack 1 is already merged and no follow-up was split out.
