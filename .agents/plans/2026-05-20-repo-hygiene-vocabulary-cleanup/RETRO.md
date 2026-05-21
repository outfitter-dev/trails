# Execution Retro: repo-hygiene-vocabulary-cleanup

Date started: 2026-05-20
Date finalized: 2026-05-21
Status: Complete - PRs ready; remote P2 fixed; Graphite mergeability lag only
Plan: `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/PLAN.md`
Goal: `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally be the last meaningful file touched before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff. Meaningful review-flow changes require a new retro entry.

## Seed State

- Repo: `.`
- Baseline branch during planning: `main`
- Baseline status during planning: clean, aligned with `origin/main`
- Known open PR during planning: #531 `chore: add codex clark agent wiring`
- Known executable anchors:
  - `TRL-733`
  - `TRL-734`
  - `TRL-616`
- Known tracker-only/planning audit candidates:
  - `TRL-351`
  - `TRL-508`
- Planning decision: `TRL-508` is not included for implementation. It remains planning-only.

## Execution Summary

- Objective: execute the Linear-first repo hygiene and vocabulary cleanup packet as a small Graphite stack.
- Final outcome: three included cleanup PRs submitted and marked ready; local review clean/P3-only; remote P2 feedback fixed on the owning bottom branch; no expansion issues admitted.
- Final branch / stack tip: `trl-616-audit-markdown-files-for-hard-line-wraps` (`ae308ebf`)
- Final PR range: #550 -> #551 -> #552
- Final tracker state: Linear-first audit complete; `TRL-351` moved from `Todo` to `Backlog`; `TRL-733`, `TRL-734`, and `TRL-616` moved to `In Review` with PR links; `TRL-508` remains planning-only.
- Final verification state: local route/markdown checks passed; `bun run check` passed; Graphite pre-push passed `turbo run test`, `turbo run typecheck`, and `trails warden --pre-push`; remote CI/Greptile passed after the remote P2 fix. Any CI caused by this ledger-only final touch is verified in the final transcript.
- Remaining risks / P3s: Graphite mergeability checks can lag on upper stacked PRs even when GitHub reports `MERGEABLE`; old cancelled/failed CI rollup entries on #550/#551 are superseded by latest successful labeled runs.
- Archive state: not archived; packet is ready for final handoff.

## Candidate Issue Classification

Phase 1 classification recorded before branch creation after `gt sync`, open PR inspection, Graphite stack inspection, and Linear queries for every `TRL` issue in `Todo`, `In Progress`, and `Backlog`.

| Issue | Classification | Evidence | Decision | Branch / PR |
| --- | --- | --- | --- | --- |
| `TRL-733` | executable in this stack | Backlog cleanup issue; `rg` still finds `packages/cli/src/build.ts:1134` saying "Convert a trail or route into a CLI command" | include as PR 1 | `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106` |
| `TRL-734` | executable in this stack | Backlog cleanup issue; route audit finds current-facing non-HTTP wording in Clark guidance, demo docs/tests, and source comments while preserving legitimate HTTP route terminology | include as PR 2 | `trl-734-audit-route-vocabulary-across-packages-consider-reserving` |
| `TRL-616` | executable in this stack, constrained | Backlog issue; current-facing markdown scope can be reduced without archive/history rewrites if detector and manual review stay conservative | include as PR 3 | `trl-616-audit-markdown-files-for-hard-line-wraps` |
| `TRL-351` | tracker-only hygiene | Was the only `Todo` issue; live search shows no permissive inline contour caller, only strict helper/tests and plan references | moved to Backlog with audit comment; no implementation | none |
| `TRL-508` | planning-only | Backlog M4 issue explicitly says "Do not start implementation from this issue as-is" and requires a scoped `trails migrate` plan first | confirm out of implementation scope | none |
| `TRL-612` | planning-only | Placeholder for future signpost draft ADR after wayfinding/signpost mechanics firm up | defer; no cleanup branch | none |
| `TRL-481` | deferred design/post-1.0 | Reactive Activation follow-up for shared webhook verification helpers after provider dogfooding | defer | none |
| `TRL-482` | deferred design/post-1.0 | Reactive Activation follow-up for advanced scheduler adapter contract | defer | none |
| `TRL-480` | deferred design/post-1.0 | Reactive Activation follow-up for first provider webhook adapter after core source lands | defer | none |
| `TRL-443` | deferred design/post-1.0 | Backlog lifecycle notification reservation for future `signal()` work | defer | none |
| `TRL-488` | deferred design/post-1.0 | Typed Signal follow-up for TypeScript fire-payload schema derivation | defer | none |
| `TRL-487` | deferred design/post-1.0 | Typed Signal follow-up for governed dynamic signal dispatch | defer | none |
| `TRL-125` | out of scope | Idea issue for config introspection as an agent superpower, not repo hygiene | exclude | none |
| `TRL-607` | deferred design/post-1.0 | Idea issue for shared Workbench/Admin/Studio capability model | defer | none |
| `TRL-606` | deferred design/post-1.0 | Idea issue for local Workbench over the capability model | defer | none |
| `TRL-486` | deferred design/post-1.0 | Reactive Activation follow-up for retry/DLQ semantics | defer | none |
| `TRL-485` | deferred design/post-1.0 | Reactive Activation follow-up for parallel or queued activation dispatch | defer | none |
| `TRL-484` | deferred design/post-1.0 | Reactive Activation follow-up for distributed schedule materialization | defer | none |
| `TRL-483` | deferred design/post-1.0 | Reactive Activation follow-up for schedule overlap, jitter, and retry policies | defer | none |
| `TRL-479` | deferred design/post-1.0 | Reactive Activation follow-up for source `.where()` shortcut after dogfooding | defer | none |
| `TRL-462` | deferred design/post-1.0 | Reactive Activation follow-up for activation overrides and composition semantics | defer | none |
| `TRL-304` | deferred design/post-1.0 | Vercel runtime adapter, explicitly excluded by goal | exclude | none |
| `TRL-303` | deferred design/post-1.0 | Cloudflare Workers runtime adapter, explicitly excluded by goal | exclude | none |
| `TRL-121` | out of scope | Idea issue for mock scaffolding and capture-based generation | exclude | none |
| `TRL-124` | out of scope | Idea issue for config migration and auto-fix, not current repo hygiene | exclude | none |
| `TRL-123` | out of scope | Idea issue for agent-assisted mock refinement loop | exclude | none |

Audit inventory:

- `Todo`: `TRL-351` only before mutation; now Backlog.
- `In Progress`: none.
- `Backlog`: `TRL-508`, `TRL-734`, `TRL-733`, `TRL-616`, `TRL-612`, `TRL-481`, `TRL-482`, `TRL-480`, `TRL-443`, `TRL-488`, `TRL-487`, `TRL-125`, `TRL-607`, `TRL-606`, `TRL-486`, `TRL-485`, `TRL-484`, `TRL-483`, `TRL-479`, `TRL-462`, `TRL-304`, `TRL-303`, `TRL-121`, `TRL-124`, `TRL-123`, plus `TRL-351` after mutation.
- Expansion decision: no additional issue met the cleanup-sized, current, executable, no-design-decision bar. Stack remains `TRL-733` -> `TRL-734` -> `TRL-616`.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `TRL-733` | `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106` | [#550](https://github.com/outfitter-dev/trails/pull/550) | ready, CI/Greptile clean | Route phrasing fix plus portable plan-packet path fix committed as `689cef1f`; labeled `release:none`. |
| 2 | `TRL-734` | `trl-734-audit-route-vocabulary-across-packages-consider-reserving` | [#551](https://github.com/outfitter-dev/trails/pull/551) | ready, CI/Greptile clean | Route vocabulary audit restacked as `9d3a42f8`; labeled `release:none`; Graphite mergeability may lag. |
| 3 | `TRL-616` | `trl-616-audit-markdown-files-for-hard-line-wraps` | [#552](https://github.com/outfitter-dev/trails/pull/552) | ready, CI/Greptile clean | Constrained current-doc hard-wrap cleanup on the stack tip; Graphite mergeability may lag. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| `TRL-508` is valuable but not executable yet | Linear issue updated before this packet; project M4 says paused pending scoped `trails migrate` plan | Exclude from implementation | Prevents executor from wandering into unsettled codemod/API design. |
| Only one open GitHub PR is visible | `gh pr list` returned #531; `gt log --stack` shows `trl-738-add-codex-clark-agent-wiring` ready to merge with local changes needing submit | Treat as state/collision awareness, not part of this stack | Avoids accidental collision with agent-wiring work. |
| Plan packet is untracked on `main` at execution start | `git status --short --branch` shows `?? .agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/` | Commit the packet on the lowest stack branch after the checkpoint | Keeps `main` clean and records the execution ledger in the stack. |
| Package-touching cleanup needs changeset handling | `TRL-733` and `TRL-734` touch publishable package source comments/tests/strings, but no package behavior or API changes | Use `release:none` labels and PR-body rationale instead of changesets | Satisfies the changeset gate without pretending docs/comment vocabulary cleanup is a package release. |

## Deferred / Follow-Up Discoveries

Out-of-goal discoveries belong here first. Create focused follow-up issues when they represent real future work.

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
|  |  |  |  |

## Tracker Mutations

Record issues, milestones, labels, dependency links, comments, and follow-up issues created or updated during planning/execution.

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-20 23:30 EDT | `TRL-351` | Moved from `Todo` to `Backlog`; added audit comment | Linear mutation via `_save_issue`; comment `89d7393c-c3ee-459a-b506-f0cacec2b701`; live search found no implementation pressure. |
| 2026-05-20 23:34 EDT | `TRL-733`, `TRL-734`, `TRL-616` | Moved from `Backlog` to `In Progress` for the active stack | Linear mutations completed after the local Graphite stack was created. |
| 2026-05-21 00:18 EDT | `TRL-733`, `TRL-734`, `TRL-616` | Moved from `In Progress` to `In Review`; attached PR links #550, #551, #552 | Linear `_save_issue` mutations returned `In Review` snapshots with GitHub attachments. |

## Execution Log

Append meaningful state changes, especially before handoff points.

```text
YYYY-MM-DD HH:MM TZ - <branch/issue/checkpoint>
- Changed:
- Verified:
- Result:
- Next:
- Blockers:

2026-05-20 23:30 EDT - main / mandatory first checkpoint
- Changed: `TRL-351` tracker hygiene mutation; `RETRO.md` audit ledger updated before branch creation.
- Verified: `gt sync` returned `ok synced`; `git status --short --branch` showed `main...origin/main` plus the untracked active packet; `gt log --stack` showed only PR #531 on `trl-738-add-codex-clark-agent-wiring`; `gh pr list` returned only PR #531; Linear `Todo`/`In Progress`/`Backlog` lists were queried; known issues `TRL-733`, `TRL-734`, `TRL-616`, `TRL-351`, and `TRL-508` were fetched.
- Result: no expansion issue admitted; `TRL-508` confirmed planning-only; proceed with the known three-branch stack.
- Next: create Graphite stack from `main`, commit the packet on the lowest branch, then implement `TRL-733`.
- Blockers: none.

2026-05-20 23:34 EDT - stack setup
- Changed: created local Graphite stack in planned order; committed this active packet on `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`.
- Verified: `gt log --stack --reverse` showed `main` -> `TRL-733` -> `TRL-734` -> `TRL-616`.
- Result: no empty branches were pushed or submitted; no expansion branch added.
- Next: implement `TRL-733`.
- Blockers: none.

2026-05-20 23:36 EDT - `TRL-733`
- Changed: tightened the `packages/cli/src/build.ts` comment from "trail or route" to "trail" and committed `57a18131c docs(cli): tighten route vocabulary`.
- Verified: targeted CLI route-drift search returned no matches; `bun run format:check` passed; `git diff --check` passed.
- Result: focused `TRL-733` branch complete locally.
- Next: implement route vocabulary audit on `TRL-734`.
- Blockers: none.

2026-05-20 23:43 EDT - `TRL-734`
- Changed: replaced current-facing non-HTTP route wording across source comments, tests, demo app wording, Clark guidance, and contributor docs; added `reports/route-vocabulary-audit.md`; committed `6ba916a03 docs: audit route vocabulary`.
- Verified: targeted CLI route-drift search returned no matches; filtered route vocabulary audit preserved legitimate HTTP route terminology and teaching mentions; `bun run format:check`, `git diff --check`, and `bun run typecheck` passed.
- Result: `TRL-734` branch complete locally.
- Next: implement constrained markdown hard-wrap cleanup on `TRL-616`.
- Blockers: none.

2026-05-20 23:47 EDT - `TRL-616`
- Changed: narrowed the markdown cleanup after the branch-ref broad detector reported 328 candidates; mechanically joined prose-only hard wraps in 10 current-facing guidance/onboarding markdown files; added `reports/markdown-hardwrap-audit.md`.
- Verified: scoped detector reports zero candidates in touched files; broad detector now reports 247 remaining candidates in larger docs left for future slices; changed-file audit shows no `.scratch/**`, `.agents/notes/**`, `.agents/plans/archive/**`, or changelog edits; changed-line scan shows no code fences, tables, lists, generated Warden headings, or headings changed; `bun run format:check` and `git diff --check` passed.
- Result: `TRL-616` branch committed as `docs: reduce current markdown hard wraps` on the stack tip.
- Next: run full stack-tip checks, then start local review.
- Blockers: none.

2026-05-20 23:51 EDT - stack tip verification
- Changed: no source changes; verification only from `trl-616-audit-markdown-files-for-hard-line-wraps`.
- Verified: exact broad route search completed with expected HTTP, history, changelog, plan/report, and teaching hits; targeted CLI route-drift search returned no matches; `bun run format:check` passed; `git diff --check` passed; `bun run check` passed, including lint, ast-grep, vocab audit, formatting, typecheck, docs links, docs snippets, API examples, error taxonomy, scaffold versions, Warden agent/skill sync checks, Trails Warden, and dead-code checks.
- Result: stack-tip checks are green before local review.
- Next: run local review lanes.
- Blockers: none.

2026-05-21 00:00 EDT - local review fixes
- Changed: recorded local review reports; updated the markdown detector count from the unreproducible local pre-cleanup `335` to the branch-ref-reproducible `328`; documented the `release:none` path for package-touching cleanup branches.
- Verified: branch-ref detector reproduces `328` candidates at `trl-734-audit-route-vocabulary-across-packages-consider-reserving` and `247` at `trl-616-audit-markdown-files-for-hard-line-wraps`; selected cleanup files remain at 0 detector candidates; local review lanes were route vocabulary 5/5, markdown safety 4/5 P3-only after fix, and PR readiness 4/5 with the changeset/label P2 resolved by documented `release:none` plan.
- Result: local review is clean/P3-only before draft submission; `release:none` labels still need to be applied after PR creation.
- Next: submit draft PR stack, add `release:none` to package-touching PRs, and update PR bodies.
- Blockers: none.

2026-05-21 00:01 EDT - pre-draft submission check
- Changed: no source changes; verification only from `trl-616-audit-markdown-files-for-hard-line-wraps` after local review fixes.
- Verified: `bun run check` passed again at the final local-review tip; `git status --short --branch` showed a clean top branch before this retro touch.
- Result: local stack is ready for draft PR submission.
- Next: submit draft PR stack and apply PR metadata/labels.
- Blockers: none.

2026-05-21 00:12 EDT - draft submission / CI metadata
- Changed: submitted draft PRs #550, #551, and #552; updated PR titles and bodies; added `release:none` to #550 and #551; recorded the CI label-event nuance.
- Verified: Graphite dry-run listed only the three planned PR creates; `graphite submit --draft --stack --no-edit --no-ai --no-interactive` created #550/#551/#552; pre-push passed `turbo run test`, `turbo run typecheck`, and `bun apps/trails/bin/trails.ts warden --pre-push`; latest labeled CI runs passed for #550 (`26204896278`) and #551 (`26204898038`); #552 CI passed (`26204706995`); all three PRs report `mergeable: MERGEABLE` and `mergeStateStatus: CLEAN`.
- Result: draft stack is submitted with proper metadata. Old failed Changeset/CI Gate entries on #550/#551 came from pre-label or original-event reruns and are superseded by successful labeled runs.
- Next: push this retro update, wait for any resulting top-branch CI, then mark PRs ready for review.
- Blockers: none.

2026-05-21 00:22 EDT - remote review round 1
- Changed: marked #550/#551/#552 ready; moved `TRL-733`, `TRL-734`, and `TRL-616` to `In Review`; addressed Greptile #550 P2 feedback by replacing plan-packet absolute local paths with repo-relative paths on `TRL-733`, then restacked #551/#552.
- Verified: #550 Greptile reported 4/5 with three P2 portability comments; #551 Greptile reported 5/5 with no findings; #552 Greptile reported 5/5 with no findings. After the fix, #550 review threads are resolved and outdated, and the local absolute-path sweep has no matches in the active packet.
- Result: remote P0/P1/P2 feedback is fixed on the lowest owning branch.
- Next: resubmit the restacked updates, wait for CI and Greptile, then record final remote closeout.
- Blockers: none.

2026-05-21 00:30 EDT - remote closeout / merge-readiness ledger
- Changed: recorded final remote review state and forbidden-action audit; no source changes beyond this ledger update.
- Verified: Graphite submit update passed pre-push `turbo run test`, `turbo run typecheck`, and `bun apps/trails/bin/trails.ts warden --pre-push`; fresh CI passed for #550 (`26205401108`), #551 (`26205401543`), and #552 (`26205401760`); Greptile passed on all three updated PRs; #550 review threads are resolved/outdated; #551 and #552 have no review threads.
- Result: stack is ready with only possible Graphite mergeability-check lag on upper stacked PRs.
- Next: push this final retro update on the top branch and verify the one resulting top-branch CI/Greptile cycle before final transcript.
- Blockers: none.
```

## Local Review Log

Record local review rounds, reports, P0/P1/P2 findings, fixes, and remaining P3s. Do not mark local review complete while P0/P1/P2 findings remain.

| Round | Scope / Lanes | Report Paths | Scores | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Route vocabulary, markdown safety, PR readiness | `reports/local-review-route-vocabulary.md`; `reports/local-review-markdown-safety.md`; `reports/local-review-pr-readiness.md` | 5/5; 4/5; 4/5 | P2 resolved by `release:none` plan; no remaining P0/P1/P2 | Markdown detector count fixed; stale summary fixed; `release:none` labels queued for PR creation. |

## Verification Log

Record exact commands and artifact checks. Include skipped checks with reasons.

| Check | Scope | Result | Evidence / Notes |
| --- | --- | --- | --- |
| `gt sync` | repo | pass | Returned `ok synced` on 2026-05-20 23:29 EDT. |
| `rg -n "\\broute\\b\|\\broutes\\b\|Route" packages apps docs README.md AGENTS.md .claude .agents` | route vocabulary | pass, noisy | Exact command completed; remaining hits are legitimate HTTP route terminology, explicit teaching/history/plan/report mentions, changelogs, and archived/local notes. `reports/route-vocabulary-audit.md` records preserved categories. |
| `rg -n "trail or route\|route into a CLI command\|CLI.*route\|route.*CLI" packages/cli/src docs/surfaces/cli.md docs/contributing/language-styleguide.md` | CLI route drift | pass | No matches after `TRL-733` and `TRL-734`. |
| markdown hard-wrap detector command | current-facing docs | pass, scoped | Exact command recorded in `reports/markdown-hardwrap-audit.md`; branch-ref broad detector 328 -> 247, selected touched files now 0 candidates. |
| `bun run format:check` | stack | pass | Passed on `TRL-733`, `TRL-734`, and `TRL-616` local checkpoints. |
| `git diff --check` | stack | pass | Passed on `TRL-733`, `TRL-734`, and `TRL-616` local checkpoints. |
| `bun run check` | stack | pass | Passed from stack tip after all three local commits and again after local review report/retro fixes. Existing Warden warnings remain warning-level; command exited 0. |
| Graphite pre-push | stack | pass | Passed on draft submit and update submit: `turbo run test`, `turbo run typecheck`, and `bun apps/trails/bin/trails.ts warden --pre-push`; Warden reported 0 errors and 3 existing warning-level demo findings. |
| GitHub CI | PR stack | pass | Latest successful post-fix remote runs before the ledger-only final touch: #550 `26205401108`, #551 `26205401543`, #552 `26205401760`. The resulting final top-branch run is verified in the final transcript to avoid a self-referential ledger update loop. |

## Remote Review / CI Log

Record remote review state after submission and after each meaningful fix round. Treat code-review bot/agent errors and unresolved P0/P1/P2 comments as incomplete. Also record summary scores and prompt-to-fix text from code-review bots/agents; a lower score with concrete fixable feedback is review debt even if inline threads are resolved.

| Time | PR | CI State | Review State | Scores / Signals | Unresolved P0/P1/P2 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| local route review | 5/5 | none | No P0/P1/P2/P3 findings. | No prompt needed. | No fix required. | `reports/local-review-route-vocabulary.md` |
| local markdown review | 4/5 | P3 | Branch-ref detector reproduced `328` before cleanup rather than reported `335`. | Update report and retro counts to branch-ref-reproducible values. | Fixed before draft submission. | `reports/local-review-markdown-safety.md`; `reports/markdown-hardwrap-audit.md` |
| local PR readiness review | 4/5 | P2 | Package-touching branches need changeset or `release:none`; no `.changeset` files exist. | Use `release:none` labels and PR-body rationale for `TRL-733` and `TRL-734`; record decision in `RETRO.md`. | Decision recorded; #550 and #551 labeled `release:none`; PR bodies include rationale. | `reports/local-review-pr-readiness.md`; PR #550/#551 labels |
| 2026-05-21 00:20 EDT | #550 | latest CI green after `release:none` label; Greptile rerun pending | Greptile 4/5 with three P2 portability findings about absolute local paths in `GOAL.md` and `RETRO.md` | 4/5; Prompt To Fix captured below | yes, three P2 | Fix on `TRL-733`, restack, resubmit |
| 2026-05-21 00:20 EDT | #551 | latest CI green after `release:none` label | Greptile 5/5, no findings | 5/5 | none | no fix |
| 2026-05-21 00:20 EDT | #552 | latest CI green | Greptile 5/5, no findings | 5/5 | none | no fix |
| 2026-05-21 00:30 EDT | #550/#551/#552 | fresh CI green on #550 `26205401108`, #551 `26205401543`, #552 `26205401760` | Greptile green on all three; #550 P2 threads resolved/outdated; #551/#552 no threads | #550: prior 4/5 P2 fixed; #551: 5/5; #552: 5/5 | none | only Graphite upper-PR mergeability lag may remain |

## Review Feedback Resolutions

| Source | Score / Signal | Severity | Finding | Prompt To Fix | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Greptile #550 | 4/5 | P2 | `GOAL.md` line 6 embedded a local absolute repo path; use cwd `.` and repo-relative plan path. | Replace the goal prompt cwd and plan path with repo-relative values. | Fixed on `TRL-733` in `689cef1f`; thread resolved/outdated after push. | <https://github.com/outfitter-dev/trails/pull/550#discussion_r3278625822> |
| Greptile #550 | 4/5 | P2 | `RETRO.md` `Plan:` and `Goal:` fields embedded local absolute paths. | Replace `Plan:` and `Goal:` with `.agents/plans/...` paths. | Fixed on `TRL-733` in `689cef1f`; thread resolved/outdated after push. | <https://github.com/outfitter-dev/trails/pull/550#discussion_r3278625950> |
| Greptile #550 | 4/5 | P2 | `RETRO.md` `Repo:` field embedded local absolute path. | Replace `Repo:` with `.`. | Fixed on `TRL-733` in `689cef1f`; thread resolved/outdated after push. | <https://github.com/outfitter-dev/trails/pull/550#discussion_r3278626110> |

## Remote Prompt To Fix With AI Captures

- #550 `GOAL.md`: "The goal prompt embeds a hardcoded absolute local path ... use a repo-relative path (e.g. `.`) so the prompt is portable." Suggested `/goal ... from cwd \`.\`, using \`.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/PLAN.md\` ...`.
- #550 `RETRO.md` header: "`Plan:`, `Goal:`, and `Repo:` header fields all carry the author's local absolute path ... Replacing with repo-relative paths makes the ledger portable." Suggested repo-relative `Plan:` and `Goal:` fields.
- #550 `RETRO.md` repo field: "`Repo:` field also carries the local absolute path." Suggested `- Repo: \`.\``.

## Forbidden Actions Audit

Record constraints that stayed true. Add or remove rows to match the goal.

| Action / Constraint | Status | Evidence |
| --- | --- | --- |
| No merge without explicit user approval | pass | No PR was merged. |
| No package publish / registry mutation | pass | No publish or registry command was run. |
| No merge queue label | pass | No `queue:*` labels were added. |
| No source-control writes by subagents | pass | Subagents only reported findings; main agent handled all `git`/`gt` writes. |
| No `TRL-508` implementation | pass | `TRL-508` classified planning-only and excluded. |
| No broad historical markdown archive rewrite | pass | No `.scratch/**`, `.agents/notes/**`, `.agents/plans/archive/**`, generated sections, changelogs, code blocks, tables, or lists were rewritten by the markdown cleanup. |
| No local `trails` skill usage | pass | Execution used `AGENTS.md`, tracked docs, Linear, GitHub, Graphite, and live source. |
| No unrelated destructive changes | pass | No destructive reset/checkout/delete/merge/publish action was run. |

## Final State

Fill before claiming completion, handoff, merge readiness, or archive.

- Goal completion condition: satisfied after the final top-branch ledger push verifies green.
- Graphite / branch state: three-branch stack remains `TRL-733` -> `TRL-734` -> `TRL-616`; no expansion branches.
- PR state: #550, #551, and #552 are ready for review.
- Source-control host lag: Graphite mergeability checks can remain pending on upper stacked PRs; GitHub reports the branches mergeable and CI/reviews are clean.
- Tracker state: `TRL-733`, `TRL-734`, and `TRL-616` are `In Review`; `TRL-351` is `Backlog`; `TRL-508` remains planning-only.
- Local review state: clean/P3-only after fixes; three local review reports committed.
- Remote review state: Greptile P2 feedback on #550 fixed; no unresolved P0/P1/P2 review threads.
- Remote review scores: #550 was 4/5 before P2 fix; #551 5/5; #552 5/5.
- Verification: route searches, markdown detector, `bun run format:check`, `git diff --check`, `bun run check`, Graphite pre-push, and GitHub CI passed as recorded above.
- Skipped checks: none required beyond the recorded commands.
- Remaining P3s / risks: only external Graphite mergeability-check lag and superseded historical CI rollup noise on #550/#551.
- Follow-up issues created: none; no additional cleanup issue met the expansion bar.
- Forbidden actions confirmation: all forbidden actions passed the audit above.
- Packet archive readiness: packet is not archived; ready for handoff.
- Final transcript proof: final response should name PRs, Linear mutations, checks, remote review fix, Graphite lag, and this finalized `RETRO.md` state.

Do not mark complete until the goal completion condition has been proven, this section is filled or explicitly marked blocked, and the final transcript names the updated retro state.
