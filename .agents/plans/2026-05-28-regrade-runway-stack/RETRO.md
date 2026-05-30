# Execution Retro: Regrade Runway Stack

Date started: 2026-05-28
Date finalized: 2026-05-29; refreshed during third-pass review hygiene on 2026-05-29
Status: executed — 9 planned issues built + 2 inserted hygiene branches, local review loop complete, and Graphite stack submitted. TRL-834/836/829 deferred (not in this stack). Third-pass follow-up fixes are applied, final local verification passed, and the stack is prepared for final resubmit.
Plan: `.agents/plans/2026-05-28-regrade-runway-stack/PLAN.md`
Goal: `.agents/plans/2026-05-28-regrade-runway-stack/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally
be the last meaningful file touched before local completion, draft submission,
ready-for-review, remote review closeout, merge readiness, archive, or final
handoff. Meaningful review-flow changes require a new retro entry.

## Execution Summary

- Objective: build the larger Regrade runway stack from post-tracer seams
  through downstream engine, Warden fix metadata, Warden-backed `term-rewrite`,
  and ADR doctrine.
- Final outcome: Downstream regrade engine + Warden fix-metadata trio (831/832/833) delivered. Two CI-only latent bugs surfaced by the full ladder and fixed: (a) `apps/trails` warden-guide output schema drift after TRL-831 added manifest `fix` metadata (fixed on TRL-831 by exporting `wardenFixClasses`/`wardenFixSafeties` + adding the `fix` field to the app schema); (b) the TRL-846 fixture `dist/` was gitignored repo-wide so it never reached CI (fixed by committing it as `dist-guard/` with a runtime rename to `dist`). A bottom-of-stack `warden-tests-type-hygiene` branch (#619) was inserted to clear ~25 pre-existing `tsconfig.tests.json` baseline errors.
- Final branch / stack tip: `trl-833-implement-warden-fix-for-safe-source-edits` (12 commits over main incl. the vocab-audit base branch and warden test-hygiene branch).
- Final PR range: #632 inserted under #619, then #619–#628 chained main → #632 → #619 → #620(840) → #621(843) → #622(842) → #623(844) → #624(845) → #625(846) → #626(831) → #627(832) → #628(833).
- Final tracker state: Linear NOT updated (deferred per instruction).
- Final verification state: build, full tests, `bun run check`, package publish checks, and focused third-pass checks passed locally after accepted review fixes. `bun run check` now reports 0 Warden errors and the three existing demo signal warnings.
- Remaining risks / P3s: term-rewrite classifier matches raw text incl. comments/strings (now documented + pinned by a test; lexer-aware exclusion deferred to TRL-832/836). No open P0/P1/P2 after second-pass local Regrade and Warden review or third-pass final predicate recheck. Rejected P3 (gratuitous `await`) recorded below with evidence.
- Archive state: not archived; stack in review.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| -1 | (none) | `chore/vocab/audit-allowlist-bootstrap-cleanup` | #632 | submitted/ready, final resubmit prepared | Inserted under the stack on 2026-05-29 to refresh vocab-audit allowlists and hold the local review-loop packet. |
| 0 | (none) | `warden-tests-type-hygiene` | #619 | submitted/ready, final resubmit prepared | Inserted bottom-of-stack: cleared ~25 pre-existing `tsconfig.tests.json` baseline errors across 9 warden test files. Test-only; no changeset. |
| 1 | TRL-840 | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | #620 | submitted/ready, final resubmit prepared | Regrade root barrel narrowed; topographer → devDependencies. Holds packet + this RETRO. |
| 2 | TRL-843 | `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` | #621 | submitted/ready, final resubmit prepared | dead-internal-trail union fix. Changeset: `@ontrails/warden` patch. |
| 3 | TRL-842 | `trl-842-fix-or-document-example-typing-for-transformed-input-schemas` | #622 | submitted/ready, final resubmit prepared | z.input/z.infer typing for transformed-input example. |
| 4 | TRL-844 | `trl-844-support-downstream-root-source-collection-for-regrade` | #623 | submitted/ready, final resubmit prepared | Downstream collect + never-throw walk. Review: scratch → tmpdir(); third pass normalized relative roots. |
| 5 | TRL-845 | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | #624 | submitted/ready, final resubmit prepared | Selection + `RegradeReport`. Review: raw-text matching doc+test; scratch → tmpdir(); third pass renamed synthetic preview mapping. |
| 6 | TRL-846 | `trl-846-add-radio-shaped-downstream-regrade-regression-fixture` | #625 | submitted/ready, final resubmit prepared | Radio fixture. CI-fix: `dist/` gitignored → committed as `dist-guard/` + runtime rename. |
| 7 | TRL-831 | `trl-831-define-the-warden-fix-metadata-contract` | #626 | submitted/ready, final resubmit prepared | Fix-metadata contract + guide projection. CI-fix: app warden-guide schema + `wardenFixClasses/Safeties` exports. Changeset: `@ontrails/warden` minor + `@ontrails/trails` patch. |
| 8 | TRL-832 | `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` | #627 | submitted/ready, final resubmit prepared | term-rewrite metadata on no-legacy-layer-imports (review, no edits). Changeset: `@ontrails/warden` patch. |
| 9 | TRL-833 | `trl-833-implement-warden-fix-for-safe-source-edits` | #628 | submitted/ready, final resubmit prepared | Safe `warden --fix` executor + CLI. Review: doc fix + overlap test; third pass hardened edit offsets, report filtering, drift blocking, app flag projection, app write intent, and explicit public access. Changeset: `@ontrails/warden` minor + `@ontrails/trails` patch. |
| 10 | TRL-834 | `trl-834-draft-warden-fix-metadata-adr` |  | deferred | Warden ADR — not in this stack. |
| 11 | TRL-836 | `trl-836-integrate-warden-backed-term-rewrite-regrades` |  | deferred | Regrade consumes Warden metadata — not in this stack. |
| 12 | TRL-829 | `trl-829-draft-regrade-adr-from-tracer-evidence` |  | deferred | Regrade ADR — not in this stack. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| PR #618 is merged and `main` is synced. | `gt sync`; `git log -1 --oneline`; `gh pr view 618` showed merged at 2026-05-28T23:26:27Z. | Remove the old #618 preflight gate from the active goal. | Stack can start from `main` after preflight. |
| The older broad packet is stale. | `.agents/plans/2026-05-27-regrade-framework-seams-stack/PLAN.md` still gates on #610 and includes now-completed TRL-841 path. | Seed a new packet rather than mutate the stale one. | Executor gets current branch order and live state. |
| Narrow downstream packet is too small for Matt's requested larger stack. | `.agents/plans/2026-05-28-regrade-downstream-stack/PLAN.md` only covers TRL-844/845/846. | Supersede it with this runway stack. | Keeps downstream slice but adds package/Warden/ADR runway. |
| Package-source modes and public CLI are still premature. | Trailblazing Regrade spine and Linear TRL-826/828 descriptions. | Keep TRL-826/828 out of this stack. | Avoids delivery UX before engine/report/Warden integration hardens. |
| Codex `blazer` session stopped correctly. | cmux `blazer` scrollback and downstream RETRO. | Do not reuse it as executor; prefer Claude agent when Matt starts the goal. | Prevents repeating the wrong-worker-lane mistake. |

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| TRL-826 | Package-source modes and local tarball/published target proof. | Needs downstream engine/report first and delivery proof scope. | <https://linear.app/outfitter/issue/TRL-826/prove-regrade-package-source-modes> |
| TRL-828 | Public `trails regrade` and `NeedsReview` CLI routing. | Should follow engine/report/Warden integration, not lead it. | <https://linear.app/outfitter/issue/TRL-828/implement-trails-regrade-and-needsreview-routing> |
| TRL-835 | `trails warden --help` / hook-integrity package mode triage. | Adjacent delivery integrity work, not engine runway. | <https://linear.app/outfitter/issue/TRL-835/triage-trails-warden-help-and-hook-integrity-package-mode> |
| TRL-838 | Integration coverage for packed manifest mismatch checks. | P3 release coverage, not central to Regrade runway. | <https://linear.app/outfitter/issue/TRL-838/add-integration-coverage-for-packed-first-party-dependency-mismatch> |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-28 planning | Linear issues | Read current state only; no tracker writes during packet prep. | Linear fetch/list for TRL-840/843/842/844/845/846/831/832/833/834/836/829. |

## Initial Planning Snapshot

```text
2026-05-28 19:34 EDT - planning seed
- Changed: created .agents/plans/2026-05-28-regrade-runway-stack/.
- Verified: main synced at #618 merge commit; relevant Linear issue state; old broad/narrow Regrade packets; Trailblazing Regrade spine; current packages/regrade and packages/warden shapes.
- Historical result at packet creation: packet seeded, not yet run.
- Superseded next step: wait for Matt to launch the goal with the pasteable prompt.
- Blockers: none for planning; execution intentionally paused.

2026-05-28 19:40 EDT - packet self-check
- Verified: `GOAL.md` pasteable prompt is 3,243 characters; `retro-check.sh` passes in non-final mode; repo status still shows `main...origin/main` with only untracked packet directories.
- Historical result at packet handoff: packet ready; goal not yet run.
```

## Local Review Log

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| 1 (2026-05-29) | 3 parallel read-only Claude Code subagent lanes over the full 10-PR stack: (A) regrade engine + fixture, (B) warden fix-metadata + cross-package, (C) test-hygiene + changesets + ownership. | Inline subagent reports (transcript); summarized in Review Feedback Resolutions below. | Lane scores 4/5, 5/5, 5/5. 0 P0, 0 P1, 1 P2, 5 P3 (1 rejected). All P0–P2 resolved before ready. | Fixes amended on owning branches: P2 doc+test on TRL-845; P3 comment+overlap-test on TRL-833; P3 temp-dir on TRL-844/845; P3 AnyResource comment on #619. Rejected P3 (gratuitous await) recorded with evidence. |
| 2 (2026-05-29) | Regrade, Warden, test hygiene, and Clark contract review lanes over the locally changed stack after inserting the vocab-audit base branch. | `.agents/plans/2026-05-29-regrade-runway-review-loop/RETRO.md`. | Accepted P1/P2 findings fixed on owning branches; second-pass Regrade and Warden lanes reported no P0-P2. | Key fixes: mixed whole-word/partial term rewrite review routing (TRL-845), package-boundary comment/id cleanup (TRL-840/843), safe-fix scanned-file guard + fix output coverage (TRL-833), agent-guide fix metadata (TRL-831/832), and Warden-traceable report validation (TRL-845). |
| 3 (2026-05-29) | Fresh Regrade, Warden, Clark contract, and stack-hygiene lanes after stale subagents were closed. | `.agents/plans/2026-05-29-regrade-runway-review-loop/RETRO.md`. | Accepted P2/P3 findings fixed bottom-up. Greptile could not review because the account-level free trial had ended, so it is not counted as a clean remote-review signal. | Fixes landed on TRL-844, TRL-845, TRL-833, the inserted vocab-audit base branch, and this packet branch. |
| 4 (2026-05-29) | Final predicate-only recheck after accepted fixes. | Inline final subagent report; summarized in `.agents/plans/2026-05-29-regrade-runway-review-loop/RETRO.md`. | No P0-P3 findings. One local final-check warning was then fixed before resubmit. | Confirmed Warden write intent, `@ontrails/trails` changeset coverage, historical packet wording, and clean local stack pending submit. Final `trails warden` warning from the write-intent change was resolved by declaring explicit public access. |

## Verification Log

| Check | Scope | Result | Evidence / Notes |
| --- | --- | --- | --- |
| `gt sync` | planning | pass | Repo synced; current branch moved to `main`. |
| `git status --short --branch` | planning | pass with caveat | `main...origin/main`; only untracked planning dirs. |
| `gt ls` | planning | pass | `main` current; old TRL-841 branch marked merged. |
| `gh pr view 618` | planning | pass | PR #618 merged. |
| Linear issue fetch/list | planning | pass | Current issue states captured in `REFS.md`. |
| `awk` prompt length check | planning | pass | Pasteable prompt in `GOAL.md` is 3,243 characters. |
| `retro-check.sh RETRO.md` | planning | pass | Required retro sections exist; final-mode intentionally not applicable before execution. |

## Remote Review / CI Log

| Time | PR | CI State | Review State | Scores / Signals | Unresolved P0/P1/P2 | Action |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## Review Feedback Resolutions

| Source | Score / Signal | Severity | Finding | Prompt To Fix | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Local review lane A | 4/5 | P2 | `createTermRewriteClass` matches raw text incl. comments/strings; lexer-unaware; undocumented + unpinned. Fixture wording masked it. (TRL-845) | Document raw-text matching; add a test pinning a comment occurrence → rewrite; note deferral to TRL-832/836. | Fixed on TRL-845: extended TSDoc on `createTermRewriteClass` + added `report.test.ts` test "matches raw text: a whole-word term in a comment is rewritten". | `packages/regrade/src/downstream/report.ts` TSDoc; `report.test.ts` new test (regrade suite 28/28). |
| Local review lane B | 5/5 | P3 | `applySafeFixesToFiles` body comment wrongly said topo diagnostics are counted as skipped (they are not). (TRL-833) | Correct the comment: only fix-bearing-but-unsafe diagnostics are skipped; no-fix/topo are excluded from the count. | Fixed on TRL-833: corrected the doc comment; behavior unchanged. | `packages/warden/src/cli.ts` `applySafeFixesToFiles` doc. |
| Local review lane B | 5/5 | P3 | Overlap-detection `RangeError` branch in `applyEdits` untested. (TRL-833) | Add a test for overlapping safe edits. | Fixed on TRL-833: added "throws on overlapping safe edits" test (fix.test.ts 7/7). | `packages/warden/src/__tests__/fix.test.ts`. |
| Local review lane A | 4/5 | P3 | `report.test.ts`/`collect.test.ts` scratch dirs under package tree, contradicting radio-fixture's documented OS-temp-root safety rationale. (TRL-844/845) | Move scratch to `tmpdir()`. | Fixed on TRL-844 (collect.test.ts) and TRL-845 (report.test.ts): `mkdtempSync(join(tmpdir(), 'regrade-…'))`. | Both helpers now use `tmpdir()`; regrade suites green. |
| Local review lane C | 5/5 | P3 | `AnyResource` widening on crud-trail helpers loses type precision. (#619) | Restore narrow type if it type-checks, else leave + comment. | Kept (widening is required by `exactOptionalPropertyTypes` for the class-based fixture) + added explanatory comment. | `incomplete-accessor-for-standard-op.test.ts` comment. |
| Local review lane C | 5/5 | P3 — REJECTED | Claimed `await checkTopo(...)` is gratuitous in valid-detour-contract/cli tests. | Drop the `await`. | Rejected: `TopoAwareWardenRule.checkTopo` returns a `readonly WardenDiagnostic[]`-or-`Promise` union and the rule is exported `: TopoAwareWardenRule`, so the`await` resolves the union for `[0]` indexing; dropping it re-breaks TS7053. No change. | `packages/warden/src/rules/types.ts:322`; `valid-detour-contract.ts:70` `: TopoAwareWardenRule`. |

## Forbidden Actions Audit

| Action / Constraint | Status | Evidence |
| --- | --- | --- |
| No merge without explicit user approval | respected | PRs were created and updated, but no branch was merged. |
| No package publish / registry mutation unless authorized | respected | No publish commands run; `publish:check` was dry-run verification only. |
| No merge queue label unless authorized | respected | No merge queue labels added. |
| No source-control writes by subagents | respected | Subagents were briefed as read-only for source control; the main agent handled Graphite writes. |
| No goal execution before explicit start | respected | Execution began only after Matt said to proceed. |
| No Clark executor use | respected | Clark was used only as a review/contract lane, not as the source-control executor. |

## Final State

- Goal completion condition: initial execution complete; third-pass review fixes applied locally and prepared for final resubmit.
- Graphite / branch state: stack remains ordered from inserted #632 through #628.
- PR state: #632 and #619-#628 exist; final third-pass submit prepared at this checkpoint.
- Source-control host lag: Graphite/GitHub state should be refreshed after final submit.
- Tracker state: Linear issue updates deferred.
- Local review state: three local review rounds complete; accepted P2/P3 findings fixed.
- Remote review state: GitHub CI previously green; Greptile unavailable due account-level trial limit.
- Remote review scores: Greptile score unavailable; local subagent findings are recorded in the review-loop retro.
- Verification: focused third-pass Regrade/Warden checks, final predicate recheck, build, full tests, `bun run check`, and `bun run publish:check` passed. `bun trails warden` passed after explicit public access removed the new permit-governance warning.
- Skipped checks: none intentionally skipped in the final pass.
- Remaining P3s / risks: Greptile unavailable unless account access is restored; term-rewrite lexical refinement remains deferred.
- Follow-up issues created: none in this pass.
- Forbidden actions confirmation: no merge, package publish, registry mutation, merge queue label, or subagent source-control write.
- Packet archive readiness: not archived; stack remains in review.
- Final transcript proof: this retro plus `.agents/plans/2026-05-29-regrade-runway-review-loop/RETRO.md`.
