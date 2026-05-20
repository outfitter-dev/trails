# Execution Retro: Trail Versioning M1 + M2 Stack

Date started: 2026-05-19
Date finalized: pending
Status: In progress
Plan: `.agents/plans/2026-05-19-trail-versioning-m1-m2/PLAN.md`
Goal: `.agents/plans/2026-05-19-trail-versioning-m1-m2/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally
be the last meaningful file touched before local completion, draft submission,
ready-for-review, remote review closeout, merge readiness, archive, or final
handoff. Meaningful review-flow changes require a new retro entry.

## Execution Summary

- Objective: Build and submit the seven-PR Trail Versioning M1 + M2 stack.
- Final outcome: pending
- Final branch / stack tip: pending
- Final PR range: pending
- Final tracker state: pending
- Final verification state: pending
- Remaining risks / P3s: pending
- Archive state: pending

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `TRL-728` | `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine` | pending | locally committed | ADR-0048 and ADR-0044 supersession; local commit `a2ca7b710`. |
| 2 | `TRL-729` | `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning` | pending | locally committed | Top-level CLI namespace; local commit `ecf7fa87a`. |
| 3 | `TRL-113` | `trl-113-define-trail-version-versions-authoring-shape` | pending | locally committed | Source and graph authoring shape; local commit `f1a7284b2`. |
| 4 | `TRL-114` | `trl-114-add-pure-transpose-transforms-for-revision-entries` | pending | locally committed | Pure `transpose:` revision transforms; local commit `ccaed90fa`. |
| 5 | `TRL-739` | `trl-739-featcore-compute-content-addressed-version-markers` | pending | locally committed | Projected content-addressed markers; local commit `db49d4571`. |
| 6 | `TRL-115` | `trl-115-resolve-trail-versions-during-execution` | pending | locally committed | Runtime version resolution; local commit `168416a5b`. |
| 7 | `TRL-116` | `trl-116-run-examples-and-testall-across-live-version-entries` | pending | locally validated | Version-aware examples and `testAll`; branch-local commit pending. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| `gt sync` pulled PR #530 on top of beta.18. | `git log --oneline -2`: `5d88104c6 docs: align Trails blaze language (#530)`, `4c9c26af3 chore: version packages to 1.0.0-beta.18 (#529)` | Preserve the new blaze-language styleguide in Trail Versioning docs and Linear. | Updated `TRL-728`, `TRL-120`, the project body, and M1 milestone to mention blaze grammar. |
| Graphite cannot clean merged branch `trl-735-blaze-language-styleguide` because it is checked out in another worktree. | `gt sync` warning and `context-prime.sh` worktree list. | Treat as non-blocking for this stack. | Preflight tells executor to continue from clean `main`. |
| Existing previous active packet was still tracked. | `git ls-files .agents/plans/2026-05-16-http-bun-observability-closeout` listed tracked files. | Move it to archive on the lowest execution branch because that stack was complete. | TRL-728 owns the archive move. |
| `context-prime.sh` hit a known local jq option failure while scanning open PRs. | Command output: `jq: Unknown option --argfile`. | Treat primer as advisory; verify PR state directly. | PR #531 was verified directly and is not a base. |
| Linear stale-term sweep was clean after updates. | Linear search returned no active issue hits for stale doctrine terms. | Proceed to packet. | No extra versioning follow-up issues needed before kickoff. |

## Deferred / Follow-Up Discoveries

Out-of-goal discoveries belong here first. Create focused follow-up issues when
they represent real future work.

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| pending | Any M3 lifecycle/surface/gate work discovered while implementing M2. | M3 is deliberately excluded from this stack. | pending |
| pending | Any M4 consumer migration/codemod work discovered while implementing M1/M2. | `TRL-508` is the later consumer migration phase. | pending |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-19 18:08 EDT | `TRL-728` | Added post-sync note and acceptance criteria for preserving PR #530 blaze-language guidance; added `docs/contributing/language-styleguide.md` to scope. | Linear issue update |
| 2026-05-19 18:08 EDT | `TRL-120` | Renamed proposed rule `fork-without-preserved-impl` to `fork-without-preserved-blaze` and added blaze-language acceptance criterion. | Linear issue update |
| 2026-05-19 18:08 EDT | Trail Versioning project | Added recent-mainline note for PR #530 blaze grammar and updated success criteria. | Linear project update |
| 2026-05-19 18:09 EDT | M1 milestone | Added lexicon/language-styleguide and PR #530 blaze grammar to milestone description. | Linear milestone update |
| 2026-05-19 18:18 EDT | `TRL-728` | Moved to In Progress when the first execution branch started. | Linear issue update |
| 2026-05-19 18:22 EDT | `TRL-729` | Moved to In Progress when the CLI namespace branch started. | Linear issue update |
| 2026-05-19 18:32 EDT | `TRL-113` | Moved to In Progress when the authoring-shape branch started. | Linear issue update |
| 2026-05-19 18:42 EDT | `TRL-114` | Moved to In Progress when the pure-transpose branch started. | Linear issue update |
| 2026-05-19 18:49 EDT | `TRL-739` | Moved to In Progress when the marker branch started. | Linear issue update |
| 2026-05-19 19:03 EDT | `TRL-115` | Moved to In Progress when the runtime-resolution branch started. | Linear issue update |
| 2026-05-19 19:26 EDT | `TRL-116` | Moved to In Progress when the examples/testAll branch started. | Linear issue update |

## Execution Log

Append meaningful state changes, especially before handoff points.

```text
2026-05-19 18:09 EDT - planning
- Changed: Seeded PLAN.md, GOAL.md, REFS.md, and RETRO.md for Trail Versioning M1 + M2.
- Verified: gt sync completed; main clean; Linear stale-term searches clean after tracker updates.
- Result: Packet ready for goal kickoff.
- Next: Goal executor should create the Graphite stack from TRL-728 upward.
- Blockers: none known.

2026-05-19 18:20 EDT - preflight and TRL-728 branch start
- Changed: Ran fresh `gt sync`, confirmed `main` at `5d88104c6`, created `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine`, moved the completed HTTP/Bun observability packet to `.agents/plans/archive/`, and added ADR-0048 plus ADR/lexicon/styleguide updates.
- Verified: `git status --short --branch` on `main` showed only the new versioning packet before branching; PR #531 is draft, based on `main`, and not a required base; Linear issue text and branch names match the packet; `bun scripts/adr.ts map` and `bun scripts/adr.ts check` passed.
- Result: Lowest execution branch owns the plan packet commit, previous completed packet archive move, and TRL-728 docs/ADR scope.
- Next: Run focused TRL-728 docs checks, commit, then create the TRL-729 CLI namespace branch.
- Blockers: none.

2026-05-19 18:27 EDT - TRL-729 CLI namespace branch
- Changed: Created `trl-729-feattrails-settle-top-level-cli-namespace-before-versioning`, promoted the app trails from `topo.compile`/`topo.verify` to top-level `compile`/`validate`, updated docs/tests/Warden/topographer stale-command copy, and added a branch-local changeset.
- Verified: App, topographer, and Warden focused test suites passed; `trails --help`, `trails compile --help`, and `trails validate --help` expose the new top-level commands; stale current-facing command sweep returned no matches; formatting and `git diff --check` passed after a repo formatter pass.
- Result: TRL-729 is locally committed as the second stack branch.
- Next: Create the TRL-113 authoring-shape branch.
- Blockers: none.

2026-05-19 18:39 EDT - TRL-113 authoring-shape branch
- Changed: Created `trl-113-define-trail-version-versions-authoring-shape`, added trail-only `version` / `versions` source shape, normalized version-entry runtime data, rejected authored `kind` and invalid historical contracts, reserved `version?: never` on non-trail specs, projected version entries into `TopoGraph`, and added core/topographer tests plus a branch-local changeset.
- Verified: Core and topographer focused tests passed; package and root typechecks passed; `bun run format:check` and `git diff --check` passed; live-code sweep found no `.v*.ts` version-file discovery.
- Result: TRL-113 is locally committed as the third stack branch.
- Next: Create the TRL-114 pure-transpose branch.
- Blockers: none.

2026-05-19 18:48 EDT - TRL-114 pure-transpose branch
- Changed: Created `trl-114-add-pure-transpose-transforms-for-revision-entries`, added pure revision transpose validation and internal execution helpers, required `transpose:` for schema-changing revisions, kept same-schema metadata revisions zero-cost, added core runtime/type tests, and added a branch-local changeset.
- Verified: Core focused tests and typecheck passed; root `bun run test` passed; `bun scripts/adr.ts check`, `bun run format:check`, and `git diff --check` passed; stale bridge/adapter/reroute vocabulary sweep found no live-code drift beyond explicit doctrine examples.
- Result: TRL-114 is locally committed as the fourth stack branch.
- Next: Create the TRL-739 marker branch.
- Blockers: none.

2026-05-19 18:59 EDT - TRL-739 marker branch
- Changed: Created `trl-739-featcore-compute-content-addressed-version-markers`, added core marker hashing/prefix helpers, rejected authored `marker:` fields, projected 16-character markers into current and historical TopoGraph entries from the same core identity source runtime will use, added unambiguous marker-prefix resolution helpers, guarded unsupported empty schema projections, and added a branch-local changeset.
- Verified: Core and topographer focused tests passed; root `bun run typecheck`, `bun run format:check`, and `git diff --check` passed.
- Result: TRL-739 is locally committed as the fifth stack branch.
- Next: Create the TRL-115 runtime resolution branch.
- Blockers: none.

2026-05-19 19:25 EDT - TRL-115 runtime-resolution branch
- Changed: Created `trl-115-resolve-trail-versions-during-execution`, added runtime version reference parsing/resolution, introduced `VersionNotSupportedError`, wired `executeTrail` and `run()` to resolve current/revision/fork versions by number or marker prefix, kept `ctx.cross()` current by default while allowing explicit version pins, preserved versioned fork cross validation, avoided an `execute.ts` / `version-runtime.ts` import cycle by passing the current executor as a callback, updated direct revision-runtime tests, and added a branch-local changeset.
- Verified: Focused runtime/version tests passed; full `@ontrails/core` test suite passed; root `bun run typecheck`, `bun run format:check`, and `git diff --check` passed.
- Result: TRL-115 is locally committed as the sixth stack branch.
- Next: Create the TRL-116 examples/testAll branch.
- Blockers: none.

2026-05-19 19:36 EDT - TRL-116 examples/testAll branch
- Changed: Created `trl-116-run-examples-and-testall-across-live-version-entries`, made version-entry examples first-class on historical entries, validated them against historical schemas, projected version-entry examples into TopoGraph and survey/guide detail output, made `testExamples`, `testContracts`, and `testAll` run current plus live historical entries, preserved archived entries as non-live, forwarded version references through testing cross coverage, and added a branch-local changeset.
- Verified: Focused core, testing, topographer, and Trails app suites passed; focused package/app typechecks passed; `bun run format:check` and `git diff --check` passed after one targeted formatter fix.
- Result: TRL-116 is ready for commit as the seventh stack branch.
- Next: Commit TRL-116, restack, then run full stack-tip verification before the required three local review rounds.
- Blockers: none.

2026-05-19 19:40 EDT - TRL-728 owning-branch verification fix
- Changed: While running the stack-tip gate, `bun scripts/adr.ts map` exposed that the ADR decision-map generator could compact an ADR-0048 `depends_on` array in a way `bun run format:check` immediately expanded. Fixed the generator's inline primitive-array threshold on the lowest owning ADR branch so `adr map` and the repo formatter agree.
- Verified: `bun scripts/adr.ts map`, `bun scripts/adr.ts check`, `bun run format:check`, and `git diff --check` passed on `trl-728-docsadr-supersede-adr-0044-with-trail-versioning-v3-doctrine`.
- Result: TRL-728 is ready for `gt modify`; descendants need restack and the stack-tip verification must restart from `bun scripts/adr.ts map`.
- Next: Amend TRL-728, restack descendants, then return to TRL-116.
- Blockers: none.
```

## Local Review Log

Record local review rounds, reports, P0/P1/P2 findings, fixes, and remaining
P3s. Do not mark local review complete while P0/P1/P2 findings remain.

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending |

## Verification Log

| Command | Branch / Context | Result | Notes |
| --- | --- | --- | --- |
| `gt sync` | `main` | passed | Pulled PR #530; warned about merged branch in another worktree. |
| `git status --short --branch` | `main` after sync | passed | `## main...origin/main` before packet creation. |
| Linear stale-term search | Trail Versioning issues | passed | No active hits after updates for stale doctrine terms. |
| `gt sync` | `main` goal preflight | passed | `ok synced`; same checked-out-worktree warning for merged `trl-735-blaze-language-styleguide`. |
| `git status --short --branch` | `main` goal preflight | passed | `## main...origin/main`; only `.agents/plans/2026-05-19-trail-versioning-m1-m2/` untracked. |
| `gh pr view 531 --json ...` | preflight | passed | PR #531 is `trl-738-add-codex-clark-agent-wiring`, draft/open, base `main`, unrelated to versioning stack. |
| `bun scripts/adr.ts map` | TRL-728 | passed | Updated ADR decision map after ADR-0048 and supersession edits. |
| `bun scripts/adr.ts check` | TRL-728 | passed | 0 errors, 0 warnings. |
| `bun run format:check` | TRL-728 | passed | Passed after `bun run format:fix` normalized generated ADR map formatting. |
| `git diff --check` | TRL-728 | passed | No whitespace errors. |
| `bun scripts/adr.ts map` | TRL-728 owning-branch fix | passed | Re-generated maps after aligning ADR JSON inline-array threshold with formatter expectations. |
| `bun scripts/adr.ts check` | TRL-728 owning-branch fix | passed | 0 errors, 0 warnings. |
| `bun run format:check` | TRL-728 owning-branch fix | passed | Passed after ADR generator threshold fix; no generated JSON formatter drift. |
| `git diff --check` | TRL-728 owning-branch fix | passed | No whitespace errors. |
| `bun run --cwd apps/trails test` | TRL-729 | passed | 318 tests, 0 failures. |
| `bun run --cwd apps/trails typecheck` | TRL-729 | passed | `tsc --noEmit` exited 0. |
| `bun run --cwd packages/topographer test` | TRL-729 | passed | 121 tests, 0 failures. |
| `bun run --cwd packages/warden test` | TRL-729 | passed | 888 tests, 0 failures. |
| stale command `rg` sweep | TRL-729 | passed | No current-facing matches for retired `trails topo compile` / `trails topo verify` names outside historical ADR/draft/changelog exclusions. |
| `bun apps/trails/bin/trails.ts --help` | TRL-729 | passed | Shows top-level `compile` and `validate`; no `topo compile`/`topo verify` commands. |
| `bun apps/trails/bin/trails.ts compile --help` | TRL-729 | passed | Top-level compile command renders expected help. |
| `bun apps/trails/bin/trails.ts validate --help` | TRL-729 | passed | Top-level validate command renders expected help. |
| `bun run --cwd packages/core test` | TRL-113 | passed | 1116 tests, 0 failures. |
| `bun run --cwd packages/topographer test` | TRL-113 | passed | 122 tests, 0 failures. |
| `bun run typecheck` | TRL-113 | passed | 22 package tasks successful. |
| `.v*.ts` live-code sweep | TRL-113 | passed | No current code matches for version-file discovery or `.vN.ts` filenames. |
| `bun run --cwd packages/core test` | TRL-114 | passed | 1121 tests, 0 failures. |
| `bun run --cwd packages/core typecheck` | TRL-114 | passed | `tsc --noEmit` exited 0. |
| `bun scripts/adr.ts check` | TRL-114 | passed | 0 errors, 0 warnings. |
| `bun run test` | TRL-114 | passed | 37 package tasks successful. |
| `bun run --cwd packages/core test` | TRL-739 | passed | 1126 tests, 0 failures. |
| `bun run --cwd packages/topographer test` | TRL-739 | passed | 127 tests, 0 failures. |
| `bun run typecheck` | TRL-739 | passed | 22 package tasks successful. |
| `bun test packages/core/src/__tests__/version-runtime.test.ts packages/core/src/__tests__/version-execution.test.ts` | TRL-115 | passed | 13 tests, 0 failures. |
| `bun run --cwd packages/core test` | TRL-115 | passed | 1147 tests, 0 failures. |
| `bun run typecheck` | TRL-115 | passed | 22 package tasks successful. |
| `bun run --cwd packages/core typecheck` | TRL-116 | passed | `tsc --noEmit` exited 0. |
| `bun run --cwd packages/testing typecheck` | TRL-116 | passed | `tsc --noEmit` exited 0. |
| `bun run --cwd packages/topographer typecheck` | TRL-116 | passed | `tsc --noEmit` exited 0. |
| `bun run --cwd apps/trails typecheck` | TRL-116 | passed | `tsc --noEmit` exited 0. |
| `bun run --cwd packages/core test` | TRL-116 | passed | 1149 tests, 0 failures. |
| `bun run --cwd packages/testing test` | TRL-116 | passed | 176 tests, 0 failures. |
| `bun run --cwd packages/topographer test` | TRL-116 | passed | 129 tests, 0 failures. |
| `bun run --cwd apps/trails test` | TRL-116 | passed | 320 tests, 0 failures after updating the guide detail fixture for version fields. |
| `bun run format:check` | TRL-116 | passed | Initial check found one formatting issue in `packages/testing/src/examples.ts`; targeted `bunx ultracite fix` applied; rerun passed. |
| `git diff --check` | TRL-116 | passed | No whitespace errors. |

## Remote Review / CI Log

| PR | Review Source | Status | P0/P1/P2 Actions | Notes |
| --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending |

## Forbidden Actions Audit

| Action | Status | Notes |
| --- | --- | --- |
| Merge PRs | Not performed | Stack must stop before merge. |
| Add merge queue label | Not performed | Stack must not add it. |
| Publish packages / registry mutation | Not performed | Only `bun run publish:check` is allowed as a readiness gate. |
| `npm publish` / `changeset publish` guidance | Not introduced | Packet requires Bun publish scripts only. |
| Subagent source-control writes | Not performed | Main agent owns source-control writes. |
| Real publish commands | Not performed | `bun run publish:packages` must not run during this goal. |

## Final State

Pending local review, draft PR submission, CI, ready-for-review, remote review,
Linear In Review updates, and final handoff.
