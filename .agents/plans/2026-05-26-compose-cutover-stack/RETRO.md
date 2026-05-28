---
created: "2026-05-26T12:59:04-04:00"
updated: "2026-05-26T12:59:04-04:00"
description: Durable execution ledger for the compose cutover stack. All six stages collapsed into PR #596; TRL-783 type fix included in S1; local checks and GitHub CI passed; ready-for-review held pending Greptile summary. Contains branch/PR/issue ledger, tracker mutations, execution log, verification log, local review log, remote CI log, forbidden-actions audit, and final state.
linear:
  - TRL-783
  - TRL-784
  - TRL-809
  - TRL-810
  - TRL-811
  - TRL-812
  - TRL-813
  - TRL-814
impl_status: partial
references:
  - .agents/plans/2026-05-26-compose-cutover-stack/PLAN.md
  - .agents/plans/2026-05-26-compose-cutover-stack/GOAL.md
---

# Execution Retro: Compose Cutover Stack

Date started: 2026-05-26 01:25 UTC
Date finalized: 2026-05-26 02:29 UTC
Status: Draft PR submitted; CI green; ready-for-review blocked on absent Greptile summary
Plan: `.agents/plans/2026-05-26-compose-cutover-stack/PLAN.md`
Goal: `.agents/plans/2026-05-26-compose-cutover-stack/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally be the last meaningful file touched before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff.

## Execution Summary

- Objective: execute `cross` -> `compose` cutover stack with `TRL-783` folded into S1.
- Final outcome: implementation is submitted as draft PR #596 with S1-S6 scope collapsed as required for a buildable no-alias monorepo cutover; CI is green; ready-for-review is blocked because no Greptile summary/review comment is visible to verify the 5/5 gate.
- Final branch / stack tip: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Final commit: branch head for PR #596 (`feat: rename trail composition API to compose`); use GitHub as the current source of truth for the exact SHA because this ledger is committed on that same branch.
- Final PR range: #596 (`https://github.com/outfitter-dev/trails/pull/596`), draft.
- Final tracker state: `TRL-783`, `TRL-784`, and `TRL-809` have PR/status comments; `TRL-809` remains In Progress.
- Final verification state: focused suites, full `bun run test`, `bun run typecheck`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, ADR checks, generated guide checks, vocab audit, docs checks, changeset gate, `bun run check`, and GitHub CI all pass.
- Remaining risks / P3s: no remaining local P0/P1/P2 findings; no Greptile summary/review visible yet, so ready-for-review was not performed; Radio migration not attempted.
- Archive state: not archive-ready until Greptile gate is visible and ready-for-review/remote review state is resolved.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TRL-809 + TRL-783 | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | #596 | Draft; CI green | Core compose API/type rename plus collapsed S2-S6 monorepo fallout; includes `TRL-783` type fix. |
| 2 | TRL-810 | `trl-810-crosscompose-cutover-s2-persistence-migration-topo_crossings` | collapsed into #596 | Collapsed | Topo DB + lockfile migration could not stay separate while S1 stayed green under no-alias cutover. |
| 3 | TRL-811 | `trl-811-crosscompose-cutover-s3-warden-rules-recognition-matchers` | collapsed into #596 | Collapsed | Warden rules and matchers required for monorepo type/test green. |
| 4 | TRL-812 | `trl-812-crosscompose-cutover-s4-docs-lexicon-tenets-migration-guide` | collapsed into #596 | Collapsed | Docs, lexicon, tenets, ADR in-place cutover, migration guide. |
| 5 | TRL-813 | `trl-813-crosscompose-cutover-s5-scaffold-templates` | collapsed into #596 | Collapsed | Scaffold templates and tests. |
| 6 | TRL-814 | `trl-814-crosscompose-cutover-s6-codemod-radio-migration` | partial collapsed into #596 | Partial | Codemod covered; Radio migration not attempted. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| Warden-as-Coach blockers are done. | Linear `TRL-785`, `TRL-786`, `TRL-791` status Done. | Compose cutover no longer blocked by Warden stack. | `TRL-783` is the remaining gate. |
| `TRL-783` should be folded into S1. | ADR-0049 allows fold-in; Matt approved. | `TRL-809` owns execution; `TRL-783` remains provenance. | Avoids fixing old `ctx.cross` just to rename immediately. |
| Main checkout had unrelated untracked file. | `git status --short --branch` showed `?? scripts/import-scratch-to-notion.ts`. | Leave untouched. | Executor should not clean or commit it. |
| Matt approved carrying the Notion scratch importer on the lowest branch. | Chat instruction: "You can commit it to the lowest branch...that's fine." | Add an intentional root script entrypoint so Knip treats `scripts/import-scratch-to-notion.ts` as a live operator script. | `bun run dead-code` and `bun run check` now pass. |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-26 01:21 UTC | TRL-783 | Added planning comment that the type fix is folded into TRL-809 while TRL-783 remains provenance. | Linear comment `c8ac17fb-d1d8-4375-aa3d-0d830298454d` |
| 2026-05-26 01:22 UTC | TRL-809 | Added planning comment that S1 owns the TRL-783 type seam and should close both issues if it lands there. | Linear comment `ca42ef06-3986-4ce0-9299-75a1a77c423d` |
| 2026-05-26 01:25 UTC | TRL-783, TRL-809 | Moved both issues to In Progress before implementation. | Linear state readback during execution. |
| 2026-05-26 02:05 UTC | TRL-809 | Added stop comment: implementation is staged and broad checks pass except `bun run check` final `dead-code`, blocked by known unrelated untracked `scripts/import-scratch-to-notion.ts`. | Linear comment `ce20be82-e261-4e4b-9678-9cb995f6ef47`. |
| 2026-05-26 02:26 UTC | TRL-809 | Added draft PR status with branch, commit, local checks, collapsed-stack rationale, and local review fix. | Linear comment `5fa1842d-cc19-452c-979e-d7959b49d88a`. |
| 2026-05-26 02:26 UTC | TRL-783 | Added implementation/PR comment noting both TRL-783 type properties are covered in PR #596. | Linear comment `eaafa822-848d-4a39-a4b6-c5da85ea1887`. |
| 2026-05-26 02:26 UTC | TRL-784 | Added parent/cutover comment with PR #596 and collapsed-stack rationale. | Linear comment `4138b14e-a29c-4f4c-8736-19f21d1db30d`. |
| 2026-05-26 02:29 UTC | TRL-809 | Added CI-green/draft-held comment; ready-for-review blocked on absent Greptile summary. | Linear comment `9efa7765-5b01-4a15-a3fd-272106c645a7`. |
| 2026-05-26 02:29 UTC | TRL-784 | Added parent status comment that CI is green and PR remains draft pending Greptile gate visibility. | Linear comment `d5895d13-9d67-46b3-8a36-ff165ac29a00`. |

## Execution Log

```text
2026-05-26 01:22 UTC - planning packet seeded
- Changed: created `.agents/plans/2026-05-26-compose-cutover-stack/` with PLAN.md, GOAL.md, REFS.md, and RETRO.md.
- Tracker: commented on TRL-783 and TRL-809 to record the fold-in decision.
- Verified: packet files exist; GOAL.md prompt is 3206 bytes, under the 4000-character target.
- Result: packet is ready for a goal executor; implementation not started.
- Blockers: none.

2026-05-26 01:25 UTC - execution started from main checkout
- Branch: `main`, synced with `gt sync --no-interactive` (`ok synced`).
- Dirty state: packet directory is untracked; known unrelated `scripts/import-scratch-to-notion.ts` remains untracked and untouched.
- Tracker: fetched Linear `TRL-784`, `TRL-783`, and `TRL-809`-`TRL-814`; branch names and staged scope match `PLAN.md`.
- Doctrine read: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, ADR-0049, `docs/tenets.md`, `docs/lexicon.md`, ADR-0000, ADR-0001, and `docs/architecture.md`.
- Next: create S1 branch `trl-809-crosscompose-cutover-s1-core-api-type-rename` and mark `TRL-809`/`TRL-783` in progress.
- Blockers: none at start.

2026-05-26 01:36 UTC - S1 type seam implemented; branch-boundary stop point reached
- Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Changed: renamed the core composition contract from `cross`/`crosses` to `compose`/`composes`; added the `TRL-783` type correction so declared composition gives blazes a non-optional `ctx.compose` and typed trail-object composition resolves through real `TrailOutput<T>`.
- Changed: repaired compile fallout in testing, Warden, topographer, scaffold/demo/app call sites, and related tests because the no-alias public API rename made downstream package updates necessary for a green monorepo typecheck.
- Changed: added topo persistence migration coverage for legacy `topo_crossings`/`idx_topo_crossings_snapshot_id` to `topo_composings`/`idx_topo_composings_snapshot_id`; bumped topo DB schema and topo graph schema versions.
- Evidence: `bun run typecheck` passes across 22 packages; focused core/testing/Warden/topographer suites pass.
- Branch boundary finding: the planned one-issue-per-branch split cannot keep S1 independently green without also including S2/S3/S5 compile-surface changes, because ADR-0049 forbids compatibility aliases and the repo is a typechecked monorepo.
- Stop rule: paused before further docs/codemod/Radio/submission work for Matt's decision on whether to collapse the stack shape, permit non-green intermediate branches, or choose another split.
- Blockers: branch-boundary decision only.

2026-05-26 02:04 UTC - resumed, collapsed cutover scope locally, stopped on unrelated dead-code blocker
- Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Changed: completed the no-alias `cross` -> `compose` cutover across core authoring/runtime API, tests, topo projection and persistence naming, Warden rule ids and diagnostics, scaffold/demo call sites, active docs, accepted ADR wording, plugin/Codex skill references, and the migration guide.
- Changed: folded `TRL-783` into the new `ctx.compose` type path: declared composition gives blazes a non-optional compose function, and typed trail-object composition resolves through `TrailOutput<T>`.
- Changed: added `scripts/vocab-cutover-rewrite.ts` `compose-api` rule and updated the vocab audit allowlist for the existing legacy topo-export migration fixture after schema-line movement.
- Changed: added branch-local `.changeset/compose-cutover.md`.
- Generated: `bun scripts/adr.ts map`, `bun run warden:agents:sync`, `bun run warden:skills:sync`, and `bun run skillset:sync`.
- Evidence: focused core/testing/Warden/topographer/app suites pass; full `bun run test` passes; `bun run typecheck`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, `bun scripts/adr.ts check`, generated guide checks, `bun run vocab:audit`, docs checks, and changeset gate pass.
- Stop rule: `bun run check` fails only at final `dead-code` because `knip --no-progress` reports the known unrelated untracked `scripts/import-scratch-to-notion.ts`; the packet explicitly said not to touch that file, so execution stopped before commit/submit/Radio work.
- Blockers: unrelated untracked file must be removed, ignored, or accepted before the repo-local `bun run check` gate can pass unchanged.

2026-05-26 02:17 UTC - resumed after Matt approved committing scratch importer on lowest branch
- Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Changed: added root `scratch:import-to-notion` script so `scripts/import-scratch-to-notion.ts` is an intentional entrypoint rather than Knip-dead code.
- Evidence: inspected the script for token/secret markers; it contains Notion data source/project IDs but no bearer token, API key, or private credential.
- Evidence: `bun run dead-code` passes; `bun run check` passes end to end; `git diff --check` passes.
- Next: complete bounded local review, then commit and submit/update the Graphite branch if review stays clear.
- Blockers: none at this checkpoint.

2026-05-26 02:24 UTC - local review completed and P2 fixed
- Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Review: core type/runtime seam review reported no P0/P1/P2 findings; residual test gap was a missing compile-time assertion for typed trail-object `ctx.compose(...)` output inference.
- Review: topo/Warden review reported one P2 false-positive risk in `composes-declarations`: bare local `compose(...)` helpers could be treated as Trails composition calls.
- Changed: added a type assertion proving the trail-object compose overload resolves to `Result<TrailOutput<T>, Error>` and that `TrailOutput<T>` is not `never`.
- Changed: scoped bare `compose(...)` recognition to names verifiably destructured from the blaze context; added regression tests for unrelated local `compose` helpers and aliased destructured compose.
- Evidence: focused Warden compose/versioning suite passes; `bun run typecheck` passes; `git diff --check` passes; `bun run check` passes end to end.
- Next: commit S1 with Graphite.
- Blockers: none.

2026-05-26 02:29 UTC - draft PR submitted; CI green; ready-for-review held
- Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`.
- Commit: branch head for PR #596 (`feat: rename trail composition API to compose`).
- PR: #596 (`https://github.com/outfitter-dev/trails/pull/596`), draft.
- Changed after submit: filled in PR body with context, collapsed-stack rationale, verification, review state, and risks.
- Tracker: commented on TRL-809, TRL-783, and TRL-784 with PR/status; follow-up comments added after CI passed.
- Evidence: GitHub checks all pass: Build, Lint & Format, Dead Code, Typecheck, Test, Governance, Changeset, CI Gate.
- Review state: GitHub showed no review records and no Greptile/Copilot/bot review comments after a short wait; only Linear linkback and Graphite stack comments were visible.
- Decision: left PR in draft. Ready-for-review is blocked until Greptile summary is visible and verifies 5/5 with no "Prompt for AI" / prompt-to-fix content.
- Forbidden actions: no merge, publish, registry mutation, merge queue label, Radio source-control mutation, or subagent source-control write.
```

## Verification Log

| Time | Branch | Command | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-26 01:32 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/core/src/__tests__/execute.test.ts packages/core/src/__tests__/trail.test.ts packages/core/src/__tests__/type-utils.test.ts packages/core/src/__tests__/validate-topo.test.ts packages/core/src/__tests__/version-execution.test.ts packages/core/src/__tests__/fork-ctx.test.ts` | Pass | 209 pass, 0 fail. |
| 2026-05-26 01:32 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/testing/src/__tests__/composes.test.ts packages/testing/src/__tests__/context.test.ts packages/testing/src/__tests__/examples.test.ts packages/testing/src/__tests__/scenario.test.ts packages/testing/src/__tests__/public-subpaths.test.ts` | Pass | 77 pass, 0 fail. |
| 2026-05-26 01:33 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/warden/src/__tests__/cross-declarations.test.ts packages/warden/src/__tests__/no-destructured-compose.test.ts packages/warden/src/__tests__/trail-versioning-rules.test.ts packages/warden/src/__tests__/implementation-returns-result.test.ts packages/warden/src/__tests__/intent-propagation.test.ts packages/warden/src/__tests__/missing-visibility.test.ts packages/warden/src/__tests__/dead-internal-trail.test.ts` | Pass | 109 pass, 0 fail. |
| 2026-05-26 01:35 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/topographer/src/__tests__/topo-store.test.ts` | Pass | 21 pass, 0 fail; includes v12 `topo_crossings` to `topo_composings` migration. |
| 2026-05-26 01:36 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/topographer/src/__tests__/topo-store.test.ts packages/topographer/src/__tests__/topo-store-read.test.ts packages/topographer/src/__tests__/derive.test.ts packages/topographer/src/__tests__/diff.test.ts packages/topographer/src/__tests__/workspace-topos.test.ts` | Pass | 107 pass, 0 fail. |
| 2026-05-26 01:36 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run typecheck` | Pass | 22 successful packages, 0 failed. |
| 2026-05-26 01:58 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | focused Warden suite with renamed files | Pass | 109 pass, 0 fail. |
| 2026-05-26 01:58 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | focused core suite | Pass | 209 pass, 0 fail. |
| 2026-05-26 01:59 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | focused testing suite | Pass | 90 pass, 0 fail. |
| 2026-05-26 01:59 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | focused topographer suite | Pass | 107 pass, 0 fail. |
| 2026-05-26 01:59 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | focused apps/demo suite | Pass | 141 pass, 0 fail. |
| 2026-05-26 02:00 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun scripts/adr.ts map` | Pass | Regenerated `docs/adr/decision-map.json`, `docs/adr/drafts/decision-map.json`, and `docs/adr/drafts/README.md`. |
| 2026-05-26 02:00 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun scripts/adr.ts check` | Pass | 0 errors, 0 warnings after restoring ADR-0028 slug/filename alignment. |
| 2026-05-26 02:00 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run warden:agents:sync`; `bun run warden:skills:sync`; matching `--check` commands | Pass | Generated Warden guides are current. |
| 2026-05-26 02:01 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run test` | Pass | 37 successful tasks, 37 total. |
| 2026-05-26 02:02 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run lint:ast-grep` | Pass | No findings. |
| 2026-05-26 02:02 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 02:02 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run changeset:check` | Pass | Gate reported no publishable package-affecting files changed relative to its PR-file-list heuristic; `.changeset/compose-cutover.md` is still present for release provenance. |
| 2026-05-26 02:03 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run lint` | Pass | 23 successful tasks, 23 total after targeted formatter fixes. |
| 2026-05-26 02:03 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run format:check` | Pass | Formatting and Ultracite checks pass. |
| 2026-05-26 02:03 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run vocab:audit` | Pass | No legacy patterns found in repo target set. |
| 2026-05-26 02:04 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run skillset:sync`; `bun run skillset:check` | Pass | Generated Codex skillset output is current. |
| 2026-05-26 02:04 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run check` | Blocked | Reaches final `dead-code`; `knip --no-progress` reports only known unrelated untracked `scripts/import-scratch-to-notion.ts`. |
| 2026-05-26 02:16 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run dead-code` | Pass | `scripts/import-scratch-to-notion.ts` is now referenced by root script `scratch:import-to-notion`. |
| 2026-05-26 02:17 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run check` | Pass | Full repo gate passes end to end, including `dead-code`. |
| 2026-05-26 02:17 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 02:20 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun test packages/warden/src/__tests__/composes-declarations.test.ts packages/warden/src/__tests__/no-destructured-compose.test.ts packages/warden/src/__tests__/trail-versioning-rules.test.ts` | Pass | 53 pass, 0 fail after Warden P2 fix. |
| 2026-05-26 02:20 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run typecheck` | Pass | 22 successful packages, 0 failed after type assertion. |
| 2026-05-26 02:24 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | `bun run check` | Pass | Full repo gate passes after local review fix. |
| 2026-05-26 02:27 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | GitHub CI on PR #596 | Pass | Build, Lint & Format, Dead Code, Typecheck, Test, Governance, Changeset, and CI Gate all pass. |

## Local Review Log

| Time | Branch | Lane | Reviewer | Score | Findings | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-26 02:04 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | self-review | main agent | pending | No formal bounded subagent review run before stop. | Stopped at verification blocker before PR readiness. |
| 2026-05-26 02:18 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | bounded local review | core type/runtime seam | clean | No P0/P1/P2 findings; residual test gap for typed trail-object compose output inference. | Added compile-time assertion. |
| 2026-05-26 02:18 UTC | `trl-809-crosscompose-cutover-s1-core-api-type-rename` | bounded local review | topo/Warden rename seam | P2 | `composes-declarations` matched unrelated bare local `compose(...)` helpers. | Fixed by tracking only compose locals destructured from the blaze context; focused tests pass. |

## Remote Review / CI Log

| Time | PR | Source | State | Details | Outcome |
| --- | --- | --- | --- | --- | --- |
| 2026-05-26 02:26 UTC | #596 | Graphite/GitHub | Draft submitted | PR URL `https://github.com/outfitter-dev/trails/pull/596`; body filled after non-interactive submit. | Draft. |
| 2026-05-26 02:27 UTC | #596 | GitHub CI | Pass | Build, Lint & Format, Dead Code, Typecheck, Test, Governance, Changeset, CI Gate. | Green. |
| 2026-05-26 02:29 UTC | #596 | GitHub comments/reviews | Greptile absent | No review records; comments visible are Linear linkback and Graphite stack comment only. | PR remains draft; ready-for-review blocked on Greptile gate. |

## Forbidden Actions Audit

- Merge: not performed.
- Package publish / registry mutation: not performed.
- Merge queue label: not added.
- Subagent source-control write: not allowed.
- Radio source-control mutation: not performed.

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| none | `bun run check` final `dead-code` is blocked by unrelated untracked `scripts/import-scratch-to-notion.ts`. | Out of scope per packet hard rule to not touch unrelated dirty/untracked files. | Remove/ignore/commit that file in its owning lane, then rerun `bun run check`. |
| TRL-814 | Radio migration was not attempted. | Packet forbids unsafe Radio source-control mutation without approval; Trails PR reached draft/CI green first. | Follow-up should run Radio migration from an explicit Radio-safe lane. |

## Final State

Draft PR #596 is submitted from branch `trl-809-crosscompose-cutover-s1-core-api-type-rename`; local checks and GitHub CI are green. The PR remains draft because Greptile summary/review is not visible yet, so the ready-for-review gate cannot be verified. No merge, publish, registry mutation, merge queue label, or Radio source-control mutation performed.
