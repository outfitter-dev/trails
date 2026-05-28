---
created: "2026-05-23T21:40:48Z"
updated: "2026-05-23T21:40:48Z"
description: "Full execution plan for the 7-branch v1 release-readiness closeout sprint: three audit branches (TRL-767, TRL-766, TRL-756) and four implementation branches (TRL-757, TRL-758, TRL-759, TRL-760). Covers stack order, phase-by-phase work plans, validation ladder, local review lanes, tracker plan, and retro discipline."
impl_status: implemented
linear:
  - TRL-756
  - TRL-757
  - TRL-758
  - TRL-759
  - TRL-760
  - TRL-766
  - TRL-767
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - .agents/plans/2026-05-22-v1-release-readiness-closeout/REFS.md
  - .agents/plans/2026-05-22-v1-release-readiness-closeout/RETRO.md
  - docs/adr/0048-trail-versioning-v3.md
  - docs/releases/stable-cutover.md
  - docs/releases/beta15.md
  - docs/migration/trailhead-to-surface.md
  - docs/migration/connector-to-adapter.md
  - docs/migration/logging-to-observe.md
  - docs/migration/layer-evolution.md
  - docs/migration/topograph-artifact-family.md
  - packages/testing/package.json
---

# Goal Plan: v1-release-readiness-closeout

- **Date:** 2026-05-22
- **Status:** Draft

## Objective

Execute the next v1 release-readiness closeout sprint from current `main`: prove the remaining release gates with three audit PRs, then land four targeted downstream-readiness fixes for testing subpaths, Topographer CLI docs, beta install policy, and beta.15 to beta.18 migration guidance.

This is one end-to-end goal with one Graphite stack. The first three branches are audit/report branches that may file follow-up issues; the last four branches are implementation/docs branches. Keep the stack coherent, review locally first, submit as draft, then move ready and handle remote feedback without merging.

## Completion Condition

The goal is complete only when:

- `TRL-767`, `TRL-766`, and `TRL-756` have committed audit reports with evidence-backed verdicts and any needed follow-up Linear issues filed.
- `TRL-757`, `TRL-758`, `TRL-759`, and `TRL-760` are implemented as one PR per issue in the stack.
- Every included Linear issue has current comments/status/PR links and any scope divergence recorded.
- The Graphite stack is submitted with high-quality PR bodies, marked ready only after local review and CI are clean, and all remote P0/P1/P2 feedback is resolved or explicitly rejected with evidence.
- Local review has run at least three scored passes, stopping only when the latest pass is P3-only or clean.
- The final stack gate passes: `bun run check`, `bun run test`, `bun run build`, `bun run publish:check`, `bun run publish:registry-check`, and `git diff --check`, plus targeted checks listed below.
- No package publish, registry mutation, merge, merge queue label, or `gt absorb` occurs.
- `RETRO.md` is updated as the durable ledger and the final transcript reports proof.

## Non-Goals

- Do not cut stable 1.0 or publish any packages.
- Do not mutate npm dist-tags or run `bun run publish:packages`.
- Do not implement `TRL-508` or design `trails migrate` / `@ontrails/trailworks`.
- Do not implement `TRL-765`; keep it as a related future Trail Versioning v1.x audit unless an included audit proves it must block this sprint.
- Do not add aliases for retired `trails topo compile`, `trails topo verify`, or `trails topo check`.
- Do not merge the stack unless Matt explicitly asks after handoff.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-22-v1-release-readiness-closeout/PLAN.md`
4. `.agents/plans/2026-05-22-v1-release-readiness-closeout/REFS.md`
5. Linear issues `TRL-767`, `TRL-766`, `TRL-756`, `TRL-757`, `TRL-758`, `TRL-759`, `TRL-760`
6. `docs/adr/0048-trail-versioning-v3.md`
7. `docs/releases/stable-cutover.md`
8. `docs/releases/beta15.md`
9. `docs/migration/*.md`
10. `/Users/mg/patch/.agents/plans/2026-05-21-patchos-trails-modernization/TRAILS-UPSTREAM-RETRO.md`

Do not make the tracked packet depend on the PatchOS retro remaining available. Use it for evidence, then summarize any load-bearing findings in the migration guide or in this packet's `RETRO.md`.

## Stack Order

Create the local stack bottom-up from `main` after `gt sync`. It is fine to create the full local stack chain up front, but do not push empty branches.

| Order | Issue | Exact branch | Kind | Why here |
| --- | --- | --- | --- | --- |
| 1 | `TRL-767` | `trl-767-audit-pending-force-events-as-a-v1-stable-cutover-gate` | Audit/report | Highest release gate priority; establishes whether pending force debt blocks stable. |
| 2 | `TRL-766` | `trl-766-audit-version-marker-failure-ux-and-bounded-zod-diagnostics` | Audit/report | Adjacent versioning UX gate; can file docs/diagnostic follow-ups before downstream docs. |
| 3 | `TRL-756` | `trl-756-audit-v1-doctrine-and-lexicon-drift-after-versioning-m3` | Audit/report | Broad doctrine sweep before docs and skill guidance changes. |
| 4 | `TRL-757` | `trl-757-split-ontrailstesting-surface-harnesses-behind-subpaths` | Package/API | Main code slice; isolates testing root from optional surface peers. |
| 5 | `TRL-758` | `trl-758-clarify-topographer-artifact-cli-workflow-and-retired-topo` | CLI/docs | Clears command ambiguity after audits and before migration guide. |
| 6 | `TRL-759` | `trl-759-document-beta-channel-install-policy-and-version-bump` | Release docs/policy | Settles beta install/version cadence for the migration guide. |
| 7 | `TRL-760` | `trl-760-add-beta15-to-beta18-downstream-migration-guide` | Migration docs | Caps the stack with downstream operator guidance reflecting all prior branches. |

## Work Plan

### Phase 0: Sync, Prime, And Commit Packet

Intent:

- Start from current `main`, not the post-merge ghost of an older stack.

Actions:

- Run `gt sync --no-interactive`.
- Confirm no open PRs or local branches alter the assumptions.
- Create the branch chain above using Graphite.
- Commit this active packet on the lowest branch (`TRL-767`) before substantive work.

Verification:

- `git status --short --branch`
- `gt log --stack --reverse --no-interactive`
- `gh pr list --state open --json number,title,headRefName,isDraft,url`

Done when:

- Stack exists locally, active packet is committed at the base, no empty branches have been pushed.

### Phase 1: Release-Gate Audits

Intent:

- Convert the three release-gate questions into durable evidence, not vibes.

Actions:

- `TRL-767`: create `reports/trl-767-pending-force-gate.md`.
- `TRL-766`: create `reports/trl-766-marker-diagnostics.md`.
- `TRL-756`: create `reports/trl-756-doctrine-lexicon-drift.md`.
- File focused follow-up Linear issues for real out-of-goal findings.
- If an audit finds a release-blocking P0/P1/P2 that is small and directly fixes the audited surface, add it to the stack only after updating Linear and `RETRO.md`; otherwise file the issue and stop/ask if it changes the stable-cutover path.

Verification:

- Each report includes verdict, evidence, command snippets, source paths, and follow-up issue list.
- `git diff --check`
- Relevant targeted commands from each Linear issue.

Done when:

- All three audit issues have committed reports and Linear comments linking the report/PR.

### Phase 2: Testing Surface Subpaths (`TRL-757`)

Intent:

- Keep root `@ontrails/testing` useful without pulling CLI/MCP/HTTP surface peers into consumers that only want contract testing.

Actions:

- Add explicit subpaths for surface harness/parity APIs, likely `@ontrails/testing/http`, `@ontrails/testing/cli`, `@ontrails/testing/mcp`, and `@ontrails/testing/surface-parity` or equivalent.
- Split public types so root exports do not import `@ontrails/http`, `@ontrails/cli`, or `@ontrails/mcp`.
- Mark surface peers optional via `peerDependenciesMeta`.
- Add a downstream import/type regression fixture.
- Update `docs/api-reference.md`, `docs/testing.md`, `packages/testing/README.md`, and plugin testing guidance.
- Add a changeset for `@ontrails/testing`.

Verification:

- Targeted import regression proves root contract helpers typecheck without surface peers.
- `bun run --cwd packages/testing typecheck` if available, otherwise repo `bun run typecheck`.
- `bun run test`
- `bun run publish:check`

Done when:

- Root import path is surface-peer clean and surface harnesses remain available from explicit subpaths.

### Phase 3: Topographer CLI Workflow (`TRL-758`)

Intent:

- Make the settled artifact workflow unmistakable: top-level `trails compile`, `trails validate`, and `trails diff`; `topo` subcommands are not compile/verify/check aliases.

Actions:

- Sweep public docs and plugin skill references for stale Topographer artifact wording.
- Clarify programmatic `@ontrails/topographer` APIs versus CLI workflow.
- Either add focused CLI diagnostics/tests for retired commands or explicitly document/test current parent-help fallback as intentional.

Verification:

- `bun apps/trails/bin/trails.ts --help`
- `bun apps/trails/bin/trails.ts topo --help`
- Targeted CLI tests if diagnostics change.
- `rg -n "trails topo (compile|verify|check)|topo compile helpers|Surface maps" README.md docs plugin packages apps .agents .claude`

Done when:

- Current-facing guidance no longer teaches retired topo command shapes.

### Phase 4: Beta Channel Policy (`TRL-759`)

Intent:

- Make beta consumption and bump cadence unambiguous while preserving Trails' Bun publish doctrine.

Actions:

- Update install/release docs and plugin/skill guidance to explain explicit `1.0.0-beta.N` pins and/or `@beta`.
- Explain that prerelease mode uses `.changeset/pre.json` tag `beta` by default.
- State whether `latest` intentionally lags during beta, or document the operator rule if it should be advanced.
- Add/update read-only verification for `latest`/`beta` split if useful.

Verification:

- `bun run publish:registry-check`
- `bun run publish:check`
- `rg -n "npm publish|changeset publish|latest|@beta|1\\.0\\.0-beta" docs plugin .agents .claude README.md packages`

Done when:

- Downstream agents know what to install and operators know when to bump/cut the next beta.

### Phase 5: Beta.15 To Beta.18 Migration Guide (`TRL-760`)

Intent:

- Give downstream apps a single operator-facing path from beta.15 to beta.18.

Actions:

- Add and link a migration/release guide from `docs/index.md`.
- Cover install policy, Commander split, MCP include-list safety, public output schemas, contract testing, resource mocks/unmockable posture, error taxonomy, observability packages, Topographer artifact workflow, and when not to adopt trail versioning yet.
- Link existing focused migration guides instead of duplicating all detail.

Verification:

- `bun run docs:links`
- `bun run docs:snippets`
- `bun run format:check`
- `git diff --check`

Done when:

- A downstream app can follow the guide without reconstructing beta.15 to beta.18 from scattered notes.

### Phase 6: Local Review, Submit, Ready, Remote Review

Intent:

- Preserve the recent goal-execution success pattern: review locally before GitHub, then handle remote feedback seriously.

Actions:

- Run at least three local review passes from the stack tip. Use subagents if available, but subagents must not run source-control write commands.
- Require each pass to provide overall `n/5`, prose summary, P0-P3 findings, evidence, and prompt-to-fix text.
- Fix all P0/P1/P2 findings on the lowest owning branch, restack, and walk upward.
- Submit draft stack only after local P0/P1/P2 is clean.
- Use high-quality PR bodies: context, changes, verification, risks, `Closes TRL-###`.
- Mark ready only after CI/local review are clean.
- After ready, wait about 15 minutes, then run up to four post-ready remote-review turns. Resolve all P0/P1/P2 review comments and concrete lower-score review-bot feedback from the bottom of the stack upward. Do not merge.

Verification:

- `bun run check`
- `bun run test`
- `bun run build`
- `bun run publish:check`
- `bun run publish:registry-check`
- `git diff --check`
- GitHub CI/check summaries, unresolved thread queries, and review-bot summary scores captured in `RETRO.md`.

Done when:

- Stack is ready for Matt, with current `RETRO.md`, clean P0/P1/P2 state, and no forbidden actions.

## Tracker Plan

In-goal issues:

- `TRL-767`, `TRL-766`, `TRL-756`, `TRL-757`, `TRL-758`, `TRL-759`, `TRL-760`

Tracker mutations already made during planning:

- Moved `TRL-756`, `TRL-766`, and `TRL-767` into `v1 Release Prep` and kept them in Todo.
- Moved `TRL-757`, `TRL-758`, `TRL-759`, and `TRL-760` from Backlog to Todo.

Follow-up policy:

- Audit-discovered out-of-goal work belongs first in `RETRO.md`, then in focused Linear follow-up issues.
- `TRL-765` remains related but out of this goal unless the audits prove it is a stable-cutover blocker.

Dependencies/blockers:

- No hard Linear blocker links are required at planning time. Stack order encodes execution order; add Linear dependencies only if an audit proves a hard dependency.

## Source-Control Plan

- Branching model: Graphite.
- Commit packet on the bottom branch, `trl-767-audit-pending-force-events-as-a-v1-stable-cutover-gate`.
- Use exact Linear branch names from the stack table.
- Do not push empty branches.
- Main agent owns all `git` and `gt` writes.
- Subagents can read, edit files, run checks, and write reports; they must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt restack`, `gt submit`, merge commands, or PR mutation commands.
- Do not use `gt absorb`; make fixes on owning branches with `gt modify`, then restack.
- Submit draft PRs as a stack after local review passes.
- Do not add merge queue labels.
- Do not merge.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after tracker changes, branch creation, each audit report, each meaningful implementation slice, local review, remote review, CI, PR-body changes, and final handoff.
- For stacked work, touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state, tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted audit/CLI/docs commands listed in each phase.
- Package/module: `bun run --cwd packages/testing typecheck` if available; package tests where available.
- Docs: `bun run docs:links`, `bun run docs:snippets`, `bun run docs:api-examples`.
- Repo: `bun run check`, `bun run test`, `bun run build`, `bun run publish:check`, `bun run publish:registry-check`, `git diff --check`.
- Warden/plugin/generated guide checks if touched: `bun run warden:agents:check`, `bun run warden:skills:check`, `bun run plugin:metadata:check`, `bun run plugin:installed-skill:check`.

## Local Review

Run at least three scored local review passes from the stack tip:

- Lane 1: audit evidence, release-gate verdicts, follow-up issue quality.
- Lane 2: `@ontrails/testing` package boundary, exports, peer deps, changeset, downstream type regression.
- Lane 3: Topographer CLI guidance, beta install policy, migration guide completeness, docs/plugin drift.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3 with file/line evidence where applicable
- Prompt To Fix With AI: concise fix prompt for each actionable finding

Fix all P0/P1/P2 findings before remote submission or final handoff. Documentation correctness is P2 by default. Record review scores, summaries, findings, fixes, and remaining P3s in `RETRO.md`.

For remote code-review bots/agents, also record summary scores, prose summaries, prompt-to-fix blocks, and whether any score below 5/5 reflects current unresolved debt, stale feedback, or an explicitly rejected recommendation.

## Progress Reporting

After each execution turn, report:

- Current checkpoint
- What changed
- What was verified
- Command/output summary
- What remains
- Blocker status
- Next checkpoint

## Stop / Pause Rules

Stop and ask if:

- The plan appears stale against `main`, Linear, or open PR state.
- A public API, artifact layout, or stable-cutover doctrine decision must change beyond this packet.
- Audit findings imply stable cutover is blocked by work larger than a small in-stack fix.
- Verification fails for unrelated reasons after a focused retry.
- Secrets, credentials, production systems, npm publish, registry mutation, or irreversible actions are needed.
- More than four post-ready remote-review turns have elapsed and P2+ feedback remains unresolved.
- Graphite reports a real conflict/failure; do not spin on Graphite mergeability lag alone when GitHub/Graphite otherwise indicate ready.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are copied, summarized, moved, or avoided.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
