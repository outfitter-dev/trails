---
created: 2026-05-25T14:30:47Z
updated: 2026-05-25T14:30:48Z
description: Durable execution ledger for the scaffold forward-compat seed session. Records final outcome (four draft PRs #589-#592, CI green, Linear in review), branch/PR/issue ledger, planning discoveries, deferred follow-ups, tracker mutations, execution log, local review log (three lanes 5/5), verification log, remote CI log, and final state.
impl_status: implemented
linear:
  - TRL-796
  - TRL-797
  - TRL-798
  - TRL-799
  - TRL-801
  - TRL-803
  - TRL-794
  - TRL-782
  - TRL-783
references:
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/PLAN.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/GOAL.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-1-scaffold-shape.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-2-helper-tooling.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-3-docs-adr.md
---

# Execution Retro: scaffold forward-compat seed

Date started: 2026-05-24
Date finalized: 2026-05-24
Status: Draft PRs submitted; CI green; Linear in review
Plan: `.agents/plans/2026-05-24-scaffold-forward-compat-seed/PLAN.md`
Goal: `.agents/plans/2026-05-24-scaffold-forward-compat-seed/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally
be the last meaningful file touched before local completion, draft submission,
ready-for-review, remote review closeout, merge readiness, archive, or final
handoff. Meaningful review-flow changes require a new retro entry.

## Execution Summary

- Objective: four-PR scaffold-forward stack for TRL-796 exact beta pins,
  TRL-798 scaffold provenance breadcrumb, TRL-797 internal bump/check helper,
  and TRL-799 draft scaffold forward-compatibility ADR.
- Final outcome: four draft PRs submitted with green CI, clean merge state,
  high-quality PR bodies, local review clean, and Linear updated.
- Final branch / stack tip:
  `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system`.
- Final PR range: #589-#592, all draft/open, merge state clean, CI Gate green.
- Final tracker state: TRL-796, TRL-798, TRL-797, and TRL-799 moved to
  `In Review` with PR/check/local-review comments.
- Final verification state: local checks passed, full `bun run check` passed,
  and GitHub CI is green across all four PRs.
- Remaining risks / P3s: optional temp-project `bun test` remains blocked by
  current published beta skew for `@ontrails/testing/established`; local source
  exposes the subpath and the generated app install/typecheck smoke passed.
- Archive state: active packet; not ready to archive until the stack merges or
  Matt asks.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TRL-796 | `trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel` | #589 | draft/open; CI green; merge state clean | Exact generated `@ontrails/*` beta pin; stable-cutover prerequisite docs; patch changeset. |
| 2 | TRL-798 | `trl-798-stamp-scaffold-provenance-into-generated-projects-minimal` | #590 | draft/open; CI green; merge state clean | Minimal `.trails/scaffold.json` breadcrumb stacked above TRL-796; patch changeset. |
| 3 | TRL-797 | `trl-797-internal-helper-for-clean-ontrails-version-bumps-in-scaffold` | #591 | draft/open; CI green; merge state clean | Internal helper/check path so exact scaffold pins stay easy to bump. |
| 4 | TRL-799 | `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system` | #592 | draft/open; CI green; merge state clean | Draft ADR grounded in the implemented breadcrumb/helper shape. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| Worktree synced to latest merged baseline. | `git switch --detach origin/main` moved from `52e4e8f7d` to `2df73cc30`; `git log --oneline -8` shows #581-#588 and #582-#587 merged. | Plan from current merged main. | The previous scaffold/Warden stacks are no longer blockers. |
| Current worktree is detached. | `git status --short --branch` reports `## HEAD (no branch)`; context-prime reports Graphite cannot operate without a branch checked out. | Goal executor must create/check out a real Graphite branch before source-control operations. | `gt ls/status` may fail during preflight until branch exists. |
| TRL-796 is the first scaffold-forward rung. | Linear TRL-796: High priority, release-prep, exact pin over `@beta` decided by Matt; `versions.ts:26` still emits caret. | Put TRL-796 first. | Removes stable-cutover footgun before any future version work. |
| TRL-798 composes with TRL-796. | Linear TRL-798 touches same scaffold output and is the smallest enabling step for future upgrade tooling. | Stack TRL-798 above TRL-796. | One coherent scaffold-output review without expanding into full upgrade tooling. |
| Matt wants a larger crank slice. | Matt pushed back that if we are going to crank for a while, we should tack on more to get further along. | Expand from TRL-796/798 to TRL-796/798/797/799. | Keeps momentum while staying inside one scaffold-forward concept family. |
| TRL-797 belongs in this widened slice. | TRL-797 depends on exact pins and can reuse existing scaffold-version tooling. | Stack TRL-797 after TRL-798. | Converts exact pins from future hand-edit debt into a checkable operator path. |
| TRL-799 belongs after implementation shape exists. | TRL-799 should describe the real breadcrumb/helper shape, not speculation. | Stack TRL-799 after TRL-797. | Captures doctrine while deferring the full upgrade-path system. |
| TRL-801 is redundant after TRL-796 decision. | Linear TRL-801 asks to decide package range; TRL-796 already records Matt's exact-pin decision and implementation acceptance criteria. | Treat TRL-801 as covered/superseded, not in-goal execution. | Tracker comment added so this is not silent duplicate backlog. |
| TRL-803 is a separate bootstrap lane. | TRL-803 is about hook tooling in worktrees, not generated app scaffold package/provenance output. | Do not mix into scaffold-forward stack. | Avoids review and failure-mode sprawl. |

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| TRL-801 | Package range decision issue is covered by TRL-796. | Needs status/closure judgment later, not implementation. | <https://linear.app/outfitter/issue/TRL-801/decide-scaffold-package-range-for-beta-releases> |
| TRL-803 | Bootstrap must install hook tooling in worktrees. | Different lane and different failure mode. | <https://linear.app/outfitter/issue/TRL-803/bootstrap-must-install-hook-tooling-worktrees-hit-empty-node-modules> |
| TRL-794 | Warden partial diagnostics remain useful. | Separate Warden coaching lane, not scaffold-forward work. | <https://linear.app/outfitter/issue/TRL-794> |
| TRL-782 / TRL-783 | Type-safety work remains useful. | Separate type-safety lane; should not ride scaffold PRs. | pending exact links |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-24 14:35 EDT | Linear TRL-796/797/798/799/801/803 | Read issue state during planning; no status changes made. | Linear fetch/search in planning session. |
| 2026-05-24 14:39 EDT | Linear TRL-801 | Added planning comment recommending TRL-801 be treated as superseded/covered by TRL-796. | Linear comment `18461dd2-1947-4bd7-9017-3ae65358f1da`. |
| 2026-05-24 16:01 EDT | Linear TRL-796 | Moved to `In Review` and added PR/check/local-review comment. | PR #589; Linear comment `cf557a9d-34a1-45ca-b8de-39e5a53d51ba`. |
| 2026-05-24 16:01 EDT | Linear TRL-798 | Moved to `In Review` and added PR/check/local-review comment. | PR #590; Linear comment `984f5ddf-a8dd-489f-b44f-d49dbde850d6`. |
| 2026-05-24 16:01 EDT | Linear TRL-797 | Moved to `In Review` and added PR/check/local-review comment. | PR #591; Linear comment `7049d1e3-5a9e-4195-90ee-0ec7c920673a`. |
| 2026-05-24 16:02 EDT | Linear TRL-799 | Moved to `In Review` and added PR/check/local-review comment. | PR #592; Linear comment `66f9d88c-f47e-400b-856f-bbb72b2f1074`. |

## Execution Log

```text
2026-05-24 14:35 EDT - planning/preflight
- Changed: synced Lewis worktree to origin/main at 2df73cc30; created this packet.
- Verified: git status/log, Linear issue bodies, scaffold source/test anchors, stable-cutover docs.
- Result: initially selected TRL-796 -> TRL-798 as next executable stack.
- Next: widen if Matt wants a longer crank slice.
- Blockers: none; detached worktree means executor must create/check out a branch before Graphite operations.

2026-05-24 14:39 EDT - tracker hygiene
- Changed: commented on TRL-801 that TRL-796 now carries the exact-pin decision and implementation path.
- Verified: Linear comment created as 18461dd2-1947-4bd7-9017-3ae65358f1da.
- Result: TRL-801 is no longer a silent duplicate in the planning surface.
- Next: execution should treat TRL-801 as related/superseded unless Matt says otherwise.
- Blockers: none.

2026-05-24 14:50 EDT - slice expansion
- Changed: expanded packet from two PRs to four PRs: TRL-796 -> TRL-798 -> TRL-797 -> TRL-799.
- Verified: issue dependencies, source anchors, and validation ladder still keep the slice inside scaffold-forward compatibility.
- Result: larger overnight-friendly stack without mixing in bootstrap hooks, Warden partial diagnostics, or type-safety work.
- Next: goal executor should create the TRL-796 branch and implement bottom-up.
- Blockers: none.

2026-05-24 15:33 EDT - execution branch attach
- Changed: created/tracked the bottom Graphite branch from the current main commit.
- Verified: `git status --short --branch` reports `## trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel` with only this packet untracked; `gt log --stack --reverse` shows the branch stacked on `main` at `2df73cc30`.
- Result: Graphite operations are now unblocked in the worktree.
- Next: commit the packet on the bottom branch, then create the remaining local stack branches.
- Blockers: none.

2026-05-24 15:33 EDT - TRL-796 implementation
- Changed: generated scaffold `@ontrails/*` package range now equals the `@ontrails/trails` package version exactly; create tests assert every generated `@ontrails/*` dependency/devDependency is exact and not caret-prefixed; stable-cutover prerequisites now include scaffold pin checking; added a patch changeset for `@ontrails/trails`.
- Verified: `bun test apps/trails/src/__tests__/create.test.ts` passed 17 tests / 342 assertions; `bun run scaffold-versions:check` passed.
- Result: TRL-796 code/docs/test slice is ready to commit on the bottom branch.
- Next: commit TRL-796, restack descendants, then implement TRL-798 provenance.
- Blockers: none.

2026-05-24 15:34 EDT - TRL-798 implementation
- Changed: generated scaffolds now include `.trails/scaffold.json` with `schemaVersion`, `scaffoldVersion`, `template`, and `generatedAt`; create tests assert the breadcrumb for default, `verify: false`, entity, and empty scaffolds plus dry-run planned operations; getting-started documents the breadcrumb as informational current-beta provenance; added a patch changeset for `@ontrails/trails`.
- Verified: `bun test apps/trails/src/__tests__/create.test.ts` passed 17 tests / 368 assertions; `bun --cwd apps/trails test` passed 349 tests / 1402 assertions.
- Result: TRL-798 code/docs/test slice is ready to commit above TRL-796.
- Next: commit TRL-798, restack descendants, then implement TRL-797 helper/check.
- Blockers: none.

2026-05-24 15:35 EDT - TRL-797 implementation
- Changed: extended `scripts/sync-scaffold-versions.ts` so both sync and check modes validate that generated `@ontrails/*` pins match `@ontrails/trails` exactly; release docs now call `bun run scaffold-versions:sync` after Changesets versioning; added focused script tests for exact, caret, and missing-export cases.
- Verified: `bun test scripts/__tests__/sync-scaffold-versions.test.ts` passed 3 tests / 3 assertions; `bun run scaffold-versions:check` passed.
- Result: TRL-797 internal helper/check slice is ready to commit above TRL-798.
- Next: commit TRL-797, restack, then draft TRL-799 ADR.
- Blockers: none.
- Changeset: not added; this branch changes internal repo scripts/tests and release docs, not publishable package contents.

2026-05-24 15:36 EDT - TRL-799 implementation
- Changed: added draft ADR `docs/adr/drafts/20260524-scaffold-forward-compatibility.md`; regenerated draft ADR README and decision map. The draft locks in exact generated `@ontrails/*` pins, minimal `.trails/scaffold.json` provenance, and the internal scaffold-version helper, while deferring readers, diffs, migrations, template hashes, and public `trails upgrade`.
- Verified: `bun scripts/adr.ts map && bun scripts/adr.ts check` passed with 0 errors / 0 warnings.
- Result: TRL-799 draft ADR slice is ready to commit at the stack tip.
- Next: commit TRL-799, then run stack validation and local review lanes.
- Blockers: none.
- Changeset: not added; draft ADR and generated ADR indexes only.

2026-05-24 15:40 EDT - validation gate cleanup
- Changed: fixed two pre-existing generated/docs-gate blockers found by `bun run check`: converted stale Wayfinding draft links to an ignored scratch proto into plain path text, and regenerated AGENTS / skill Warden guide rule counts from 57 to 58.
- Verified: `bun scripts/check-markdown-links.ts` passed after the Wayfinding link cleanup; `bun run warden:agents:check && bun run warden:skills:check` passed after Warden guide sync.
- Result: docs-link and Warden generated-guide blockers are cleared at the stack tip.
- Next: fix the remaining `bun run check` failure from Knip duplicate exports on the owning branches.
- Blockers: `bun run check` still fails at `dead-code` because exact pins made `trailsPackageVersion` and `ontrailsPackageRange` duplicate exports in `apps/trails/src/versions.ts`.

2026-05-24 15:53 EDT - validation closeout and local review
- Changed: fixed the Knip duplicate-export failure bottom-up by keeping `trailsPackageVersion` for CLI `--version` while deriving `ontrailsPackageRange` directly from package metadata instead of aliasing it. Restacked TRL-798/797/799 and added three local review lane reports.
- Verified: `bun test apps/trails/src/__tests__/create.test.ts` passed 17 tests / 349 assertions; `bun run dead-code` passed; `bun run scaffold-versions:check` passed; `bun run check` passed on the stack tip.
- Smoke: temp scaffold at `/tmp/trails-scaffold-forward-smoke.s7qKGw/docs-smoke` emitted exact `1.0.0-beta.18` pins and `.trails/scaffold.json`; `bun install` and `bun run typecheck` passed. `bun test` in that temp app failed because published `@ontrails/testing@1.0.0-beta.18` does not expose `@ontrails/testing/established`; local source does expose the subpath, so this is recorded as registry-state skew pending the next beta publication, not a scaffold implementation failure.
- Review: local lanes scored 5/5, 5/5, and 5/5 with no P0/P1/P2 findings.
- Result: local implementation and review are clean for draft submission.
- Next: submit draft PR stack and update Linear with PR/check state.
- Blockers: no local blockers.

2026-05-24 16:02 EDT - draft submission and tracker closeout
- Changed: submitted the four-PR draft Graphite stack, edited all PR titles/bodies with scope, validation, risk, and closure lines, and updated Linear status/comments for TRL-796/798/797/799.
- Verified: `gh pr view` reports #589-#592 draft/open, merge state clean, and no non-green checks; Linear comments created as cf557a9d-34a1-45ca-b8de-39e5a53d51ba, 984f5ddf-a8dd-489f-b44f-d49dbde850d6, 7049d1e3-5a9e-4195-90ee-0ec7c920673a, and 66f9d88c-f47e-400b-856f-bbb72b2f1074.
- Result: goal stack is submitted as draft, CI-green, locally reviewed, and tracker-current.
- Next: run final small checks after this RETRO update, commit/submit the RETRO closeout, then hand off without merge/publish/queue changes.
- Blockers: none.
```

## Local Review Log

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| 2026-05-24 15:53 EDT | scaffold package/provenance shape | `.agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-1-scaffold-shape.md` | clean; no P0/P1/P2 | Score 5/5. P3 registry-smoke caveat recorded for current published beta. |
| 2026-05-24 15:53 EDT | bump-helper/tooling and generated-output coverage | `.agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-2-helper-tooling.md` | clean; no P0/P1/P2 | Score 5/5. |
| 2026-05-24 15:53 EDT | release/docs/ADR doctrine fit | `.agents/plans/2026-05-24-scaffold-forward-compat-seed/local-review-lane-3-docs-adr.md` | clean; no P0/P1/P2 | Score 5/5. |

## Verification Log

| Check | Scope | Result | Evidence / Notes |
| --- | --- | --- | --- |
| `git status --short --branch` | planning | pass | detached clean at current main. |
| `git log --oneline -8` | planning | pass | latest commit `2df73cc30 fix(trails): allow fieldwork lint markers (#587)`. |
| Linear fetch/search | planning | pass | TRL-796, 797, 798, 799, 801, 803, 782, 783, 794, 800 checked as needed. |
| Packet markdown/retro checks | planning | pending | Run after widened packet edits. |
| `git status --short --branch` | execution branch attach | pass | branch `trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel`; packet untracked before packet commit. |
| `gt log --stack --reverse` | execution branch attach | pass | branch stacked directly on `main` at `2df73cc30`. |
| `bun test apps/trails/src/__tests__/create.test.ts` | TRL-796 | pass | 17 tests / 342 assertions. |
| `bun run scaffold-versions:check` | TRL-796 | pass | existing scaffold version drift check still passes after exact pin change. |
| `bun test apps/trails/src/__tests__/create.test.ts` | TRL-798 | pass | 17 tests / 368 assertions. |
| `bun --cwd apps/trails test` | TRL-798 | pass | 349 tests / 1402 assertions. |
| `bun test scripts/__tests__/sync-scaffold-versions.test.ts` | TRL-797 | pass | 4 tests / 4 assertions. |
| `bun run scaffold-versions:check` | TRL-797 | pass | validates generated third-party scaffold versions plus exact `@ontrails/*` pins. |
| `bun scripts/adr.ts map && bun scripts/adr.ts check` | TRL-799 | pass | draft ADR indexes regenerated; checker reports 0 errors / 0 warnings. |
| `bun run format:check` | stack tip | fail then pass | failed on committed formatting in `apps/trails/src/__tests__/create.test.ts`; fixed on TRL-798 and reran successfully. |
| `bun run typecheck` | stack tip | pass | 22 packages successful. |
| `bun scripts/check-markdown-links.ts` | stack tip | pass | cleared stale ignored-scratch Wayfinding draft links. |
| `bun run warden:agents:check && bun run warden:skills:check` | stack tip | pass | regenerated AGENTS and skill Warden guide counts to 58. |
| `bun run check` | stack tip | fail | after docs/Warden cleanup, remaining failure is Knip duplicate exports for `trailsPackageVersion` and `ontrailsPackageRange` in `apps/trails/src/versions.ts`. |
| `bun test apps/trails/src/__tests__/create.test.ts` | stack tip after duplicate-export fix | pass | 17 tests / 349 assertions. |
| `bun run dead-code` | stack tip after duplicate-export fix | pass | Knip duplicate-export failure resolved. |
| `bun run scaffold-versions:check` | stack tip after duplicate-export fix | pass | exact `@ontrails/*` pin check still passes. |
| `bun run check` | stack tip after duplicate-export fix | pass | full repo check passed; Warden reports 0 errors / 26 warnings. |
| temp scaffold smoke | stack tip | partial | exact pins and `.trails/scaffold.json` verified; install and typecheck passed; temp app test blocked by current published beta missing `@ontrails/testing/established`. |
| `gh pr view` status checks | draft PRs #589-#592 | pass | all four PRs draft/open, merge state clean, and no non-green checks. |

## Remote Review / CI Log

| Time | PR | CI State | Review State | Scores / Signals | Unresolved P0/P1/P2 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-24 16:02 EDT | #589 | green; merge state clean | draft, no remote review requested yet | CI Gate plus Build/Lint/Dead Code/Typecheck/Test/Governance/Changeset all green | none | keep draft with local review clean. |
| 2026-05-24 16:02 EDT | #590 | green; merge state clean | draft, no remote review requested yet | CI Gate plus Build/Lint/Dead Code/Typecheck/Test/Governance/Changeset all green | none | keep draft with local review clean. |
| 2026-05-24 16:02 EDT | #591 | green; merge state clean | draft, no remote review requested yet | CI Gate plus Build/Lint/Dead Code/Typecheck/Test/Governance/Changeset all green | none | keep draft with local review clean. |
| 2026-05-24 16:02 EDT | #592 | green; merge state clean | draft, no remote review requested yet | CI Gate plus Build/Lint/Dead Code/Typecheck/Test/Governance/Changeset all green | none | keep draft with local review clean. |

## Review Feedback Resolutions

| Source | Score / Signal | Severity | Finding | Prompt To Fix | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Local review lane 1 | 5/5 | P3 | Published beta smoke `bun test` fails because current registry package lacks `@ontrails/testing/established`. | Record as registry-state caveat, do not change scaffold implementation. | Deferred to next beta publish / registry freshness; not a P0/P1/P2. | Report file and temp smoke output recorded above. |
| Local review lane 2 | 5/5 | none | No P0/P1/P2 findings. | n/a | No changes needed. | `local-review-lane-2-helper-tooling.md`. |
| Local review lane 3 | 5/5 | none | No P0/P1/P2 findings. | n/a | No changes needed. | `local-review-lane-3-docs-adr.md`. |

## Forbidden Actions Audit

| Action / Constraint | Status | Evidence |
| --- | --- | --- |
| No merge without explicit user approval | respected | PRs remain draft/open; no merge commands run. |
| No package publish / registry mutation unless authorized | respected | Only read-only smoke/install/check commands; no publish or registry mutation. |
| No merge queue label unless authorized | respected | No queue label mutation. |
| No source-control writes by subagents | respected | No subagents performed git/gt writes. |
| No unrelated destructive changes | respected | Changes stayed in scaffold/version helper/docs/ADR packet lanes; docs-gate cleanup was required by `bun run check`. |

## Final State

- Goal completion condition: met for draft-stack handoff; all four draft PRs
  exist, CI is green, Linear is current, local review is clean, checks pass, and
  scope constraints held.
- Graphite / branch state: current stack tip is
  `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system`;
  bottom-to-top PRs are #589, #590, #591, #592.
- PR state: #589-#592 are draft/open with clean GitHub merge state and green
  status checks.
- Source-control host lag: none observed for GitHub checks; Graphite stack is
  submitted as draft.
- Tracker state: TRL-796, TRL-798, TRL-797, and TRL-799 are `In Review` with
  PR/check/local-review comments; TRL-801 remains superseded by TRL-796 comment.
- Local review state: three local lanes scored 5/5 with no P0/P1/P2 findings.
- Remote review state: not requested yet because PRs remain draft by goal
  instruction; CI is green and ready for the next ready-for-review loop.
- Remote review scores: none yet.
- Verification: `bun test apps/trails/src/__tests__/create.test.ts`,
  `bun --cwd apps/trails test`,
  `bun test scripts/__tests__/sync-scaffold-versions.test.ts`,
  `bun run scaffold-versions:check`,
  `bun scripts/adr.ts map && bun scripts/adr.ts check`,
  `bun scripts/check-markdown-links.ts`,
  `bun run warden:agents:check && bun run warden:skills:check`,
  `bun run format:check`, `git diff --check`, and `bun run check` passed before
  this final RETRO touch; final small checks will be rerun after commit.
- Skipped checks: no required local checks skipped. Optional temp scaffold
  `bun test` did not pass because of current published-beta subpath skew; install
  and typecheck passed.
- Remaining P3s / risks: published `@ontrails/testing@1.0.0-beta.18` is stale
  relative to local source for `@ontrails/testing/established`; next beta publish
  should clear the optional smoke caveat.
- Follow-up issues created: none; existing TRL-801/803/794/782/783 remain
  tracked outside this goal.
- Forbidden actions confirmation: no merge, no publish/registry mutation, no
  merge queue label, no out-of-scope upgrade/diff/migration/public CLI work.
- Packet archive readiness: not ready to archive until the stack merges or Matt
  asks; packet remains active on the stack.
- Final transcript proof: final response should name PRs #589-#592, green CI,
  Linear in-review comments, final checks, and remaining P3 registry caveat.

Do not mark complete until the goal completion condition has been proven, this
section is filled or explicitly marked blocked, and the final transcript names
the updated retro state.
