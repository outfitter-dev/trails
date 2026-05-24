# Warden-as-Coach Overnight Stack Retro

Date: 2026-05-24
Owner: Lewis

## Current State

| Item | State | Notes |
|---|---|---|
| `TRL-791` | Draft PR, CI green | PR #582; branch root: `trl-791-warden-coach-against-destructured-ctxcross-new-reject-and`. |
| `TRL-793` | Candidate next | Only take if diagnostic-only. |
| `TRL-785` | Candidate later | Must precede `TRL-786`; overlaps `TRL-333`. |
| `TRL-786` | Deferred until provenance | Do not implement syntactically. |
| `TRL-790` | Deferred | Likely scaffold/lint config overlap. |

## Discoveries

- 2026-05-24 00:13 EDT - Clark and subagent findings converge on Warden-as-Coach order: `TRL-791` first; `TRL-793` if diagnostic-only; `TRL-785` before `TRL-786`; defer `TRL-790`.
- 2026-05-24 00:13 EDT - `TRL-785` is a coverage-gap follow-up to done `TRL-333`, not a fresh imported-helper implementation.
- 2026-05-24 00:13 EDT - Native Oxlint config cannot cleanly whitelist `TODO[trails-*]`; `TRL-790` likely needs plugin/custom-rule work and may overlap scaffold output.

## Tracker Mutations

| Time | Issue | Change |
|---|---|---|
| 2026-05-24 00:15 EDT | `TRL-791` | Moved to In Progress. |
| 2026-05-24 00:15 EDT | `TRL-791` | Commented with branch, packet path, and scope note. |
| 2026-05-24 00:30 EDT | `TRL-791` | Moved to In Review and attached draft PR #582. |
| 2026-05-24 00:30 EDT | `TRL-791` | Commented with verification plus diagnostic-divergence note. |

## Execution Log

| Time | Event |
|---|---|
| 2026-05-24 00:13 EDT | Created active goal packet under `.agents/plans/2026-05-24-warden-as-coach-overnight-stack/`. |
| 2026-05-24 00:13 EDT | Checked out `main` and created Graphite branch `trl-791-warden-coach-against-destructured-ctxcross-new-reject-and`. |
| 2026-05-24 00:18 EDT | Implemented `no-destructured-cross`, registered metadata/exports/trail wrapper, added tests and a changeset. |
| 2026-05-24 00:18 EDT | Updated the framework `create` trail to use `ctx.cross(...)` directly instead of destructuring `cross`. |
| 2026-05-24 00:18 EDT | Regenerated Warden guide blocks in `AGENTS.md`, Clark's Warden guide reference, and the Trails plugin guide reference. |
| 2026-05-24 00:32 EDT | Softened `no-destructured-cross` diagnostic after doctrine review: removed the absolute LSP/type-overload claim and kept the grounded Warden/result-recognition cost. |
| 2026-05-24 00:34 EDT | Added assignment destructuring detection for `({ cross } = ctx)` after implementation review found it as a bypass. |
| 2026-05-24 00:31 EDT | Submitted draft PR #582. |
| 2026-05-24 00:32 EDT | Fixed Changeset CI failure by adding `@ontrails/trails` to the changeset; the framework `create` trail cleanup touches a publishable package too. |

## Verification Log

| Command | Result | Notes |
|---|---|---|
| `bun test packages/warden/src/__tests__/no-destructured-cross.test.ts` | pass | Initial focused rule run: 9 tests. |
| `bun test packages/warden/src/__tests__/warden-rule-metadata.test.ts packages/warden/src/__tests__/guide.test.ts packages/warden/src/__tests__/warden-export-symmetry.test.ts` | pass | 28 tests. |
| `bun run warden:agents:sync` | pass | Regenerated `AGENTS.md`. |
| `bun run warden:skills:sync` | pass | Regenerated Clark + plugin Warden guide references. |
| `bun run warden:agents:check` | pass | Generated block in sync. |
| `bun run warden:skills:check` | pass | Generated skill guides in sync. |
| `bun --cwd packages/warden test` | failed, fixed | First run failed only because `trails.test.ts` still expected 56 rule trails; updated to 57. |
| `bun run typecheck` | failed, fixed | First run caught a narrow `property.key` AST type mismatch in the new rule; fixed with an explicit cast. |
| `bun run format:check` | failed, fixed | First run found formatting drift in `create.ts` and the new rule test. |
| `bun run format:fix` | pass | Applied formatter and cleared Ultracite's `prefer-destructuring` complaint. |
| `bun --cwd packages/warden test` | pass | 926 tests, 0 fail after updating rule trail count. |
| `bun run typecheck` | failed, fixed | Second run exposed optional `ctx.cross` narrowing in `apps/trails/src/trails/create.ts`; added `hasCross` type guard so direct `ctx.cross(...)` remains type-safe. |
| `bun test apps/trails/src/__tests__/create.test.ts` | pass | 15 tests, 0 fail after `ctx.cross` cleanup. |
| `bun run typecheck` | pass | 22 packages. |
| `bun run format:check` | pass | All matched files formatted; Ultracite 0 warnings/errors. |
| `bun run lint` | pass | 23 tasks, 0 warnings/errors. |
| `git diff --check` | pass | No whitespace errors. |
| `bun test packages/warden/src/__tests__/no-destructured-cross.test.ts` | pass | Final focused rule run after review fixes: 12 tests, 0 fail. |
| `bun --cwd packages/warden test` | pass | Final package run: 929 tests, 0 fail. |
| `bun run format:check` | pass | Final format/Ultracite run: 0 warnings/errors. |
| `bun run lint` | pass | Final repo lint: 23 tasks, 0 warnings/errors. |
| `git diff --check` | pass | Final whitespace check. |
| `bun run check` | pass | Full repo gate passed; Warden emitted only the known pre-existing warning set. |
| `gh api --paginate repos/outfitter-dev/trails/pulls/582/files --jq '.[].filename' \| bun run changeset:check -- --changed-files /dev/stdin` | pass | Reproduced the Changeset gate locally after adding `@ontrails/trails`. |

## Local Review Log

| Pass | Result | Findings | Action |
|---|---|---|---|
| 2026-05-24 00:26 EDT | Implementation/registration review dispatched to Nash | pending | Review only; no git/gt writes. |
| 2026-05-24 00:26 EDT | Doctrine/diagnostic review dispatched to McClintock | 4/5 | One P2: diagnostic overclaimed that destructuring breaks LSP typed-overload narrowing. Fixed by softening to visible composition + Warden Result recognition. |
| 2026-05-24 00:34 EDT | Implementation/registration review returned from Nash | 4/5 | One P2: assignment destructuring bypass. Fixed by adding `AssignmentExpression` detection and tests. |

## Remote Review / CI Log

| PR | State | CI | Review |
|---|---|---|---|
| #582 | Draft, open | Green on amended run: Build, Lint & Format, Dead Code, Typecheck, Test, Governance, Changeset, CI Gate. | No reviews posted yet. |

## Forbidden-Action Audit

- Merge: not performed.
- Merge queue label: not applied.
- Publish/registry mutation: not performed.
- Destructive git commands: not performed.
- Subagent git/gt writes: not performed.

## Final State

Draft PR #582 is open and CI green. No merge, merge queue, or publish action performed.
