# Execution Retro: TRL-780 Scaffold CLI Scripts

Date started: 2026-05-23
Date finalized: 2026-05-23
Status: Ready for handoff
Plan: `.agents/plans/2026-05-23-trl-780-scaffold-cli-scripts/PLAN.md`
Goal: `.agents/plans/2026-05-23-trl-780-scaffold-cli-scripts/GOAL.md`

Use this as the durable execution ledger. This should normally be the last
meaningful file touched before local completion, draft submission,
ready-for-review, remote review closeout, merge readiness, archive, or final
handoff. Meaningful review-flow changes require a new retro entry.

## Execution Summary

- Objective: Make fresh `trails create` apps consume the existing
  `@ontrails/trails` bin and expose core framework commands via package
  scripts.
- Final outcome: Draft PR opened for TRL-780 scripts-first scaffold CLI
  reachability.
- Final branch / stack tip: `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands`
- Final PR range: PR #577
- Final tracker state: TRL-780 In Progress
- Final verification state: local targeted/package/smoke/repo checks passed; CI
  passed.
- Remaining risks / P3s: remote review still needs to settle before ready.
- Archive state: active packet

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TRL-780 | `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands` | [#577](https://github.com/outfitter-dev/trails/pull/577) | draft | Scripts-first scaffold command reachability. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| `@ontrails/trails` already exposes the `trails` bin on `main`. | `apps/trails/package.json:4` | Scope this goal to scaffold consumption, not bin invention. | Smaller implementation; no package architecture decision required. |
| Fresh scaffold package generation is centralized in `generatePackageJson()`. | `apps/trails/src/trails/create-scaffold.ts:46` | Add baseline dev dependency and scripts there. | One generated package shape for all starters and verify modes. |
| Verify hooks already call `bunx trails warden`. | `apps/trails/src/trails/add-verify.ts:33` | Generated projects need a resolvable `trails` command independent of direct `@ontrails/warden` bin access. | Strengthens `@ontrails/trails` dev dependency as baseline scaffold tooling. |

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| TRL-778 | Plugin install detection may also improve first-run guidance. | Separate guide/plugin workflow; not required for command reachability. | <https://linear.app/outfitter/issue/TRL-778> |
| TRL-781 | Re-running `trails create` can leave partial state. | Reconciliation behavior is broader than package scripts. | <https://linear.app/outfitter/issue/TRL-781> |
| TRL-789 | Entity starter emits known `incomplete-crud` warning. | Starter completeness is separate from command reachability. | <https://linear.app/outfitter/issue/TRL-789> |
| TRL-792 | Bun runtime docs need companion clarification. | Documentation companion, not scaffold package implementation. | <https://linear.app/outfitter/issue/TRL-792> |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-23 planning | TRL-780 | No mutation during packet creation. Executor should update status/comment when work begins or diverges. | This packet. |
| 2026-05-23 execution | TRL-780 | Moved to In Progress when implementation began on the Graphite branch. | Linear update |
| 2026-05-23 closeout | TRL-780 | Added draft PR comment with local verification summary. | Linear comment `61a0d969-a714-45fa-b7fc-5b78ed7a4568` |

## Execution Log

Append meaningful state changes, especially before handoff points.

```text
YYYY-MM-DD HH:MM TZ - <branch/issue/checkpoint>
- Changed:
- Verified:
- Result:
- Next:
- Blockers:

2026-05-23 18:29 EDT - branch setup / packet commit
- Changed: created Graphite branch trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands and committed the active packet.
- Verified: gt sync --no-interactive; git status --short --branch; packet committed with pre-commit markdownlint.
- Result: branch ready for implementation.
- Next: inspect scaffold generator/tests and implement package shape.
- Blockers: none.

2026-05-23 18:31 EDT - targeted scaffold test red/green
- Changed: added package-shape assertions for @ontrails/trails devDependency and framework command scripts; implemented @ontrails/trails baseline devDependency, sorted generated scripts, and changeset .changeset/trl-780-scaffold-cli-scripts.md.
- Verified: bun test apps/trails/src/__tests__/create.test.ts failed before implementation on missing @ontrails/trails; passed after implementation with 15 tests / 110 assertions.
- Result: targeted TRL-780 scaffold shape is green.
- Next: package tests and generated-project smoke.
- Blockers: none.

2026-05-23 18:34 EDT - local validation ladder
- Changed: no code changes; validated the implemented scaffold shape and generated-project runtime path.
- Verified: bun --cwd apps/trails test passed 347 tests / 1144 assertions; generated /tmp/trails-trl-780-smoke.tNP3u2/smoke-app with @ontrails/trails ^1.0.0-beta.18, ran bun install, bun run survey -- --help, and bun run warden -- --help; bun run typecheck passed; bun run lint passed; bun run format:check passed; git diff --check passed; bun run check passed.
- Result: target, package, smoke, and broad repo checks are clean.
- Next: local review lanes, fix any P0/P1/P2, then commit/submit or hand off with branch state.
- Blockers: none.

2026-05-23 18:40 EDT - draft PR / tracker closeout
- Changed: submitted draft PR #577, edited PR title/body, moved TRL-780 to In Progress, and added Linear comment with PR + verification summary.
- Verified: gh pr view 577; gh pr checks 577; Linear TRL-780 fetch/update/comment.
- Result: branch is pushed and attached to draft PR #577. CI passed: CI Gate, Lint & Format, Dead Code, Changeset, Build, Typecheck, Test, and Governance.
- Next: wait for remote review, then mark ready only when P0/P1/P2 feedback is clean.
- Blockers: none for local handoff; remote review pending.
```

## Local Review Log

Record local review rounds, reports, P0/P1/P2 findings, fixes, and remaining
P3s. Do not mark local review complete while P0/P1/P2 findings remain.

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| 1 | Scaffold/package shape | Spark subagent summary in transcript | pass: no P0/P1/P2 | Score 5/5. P3 stale smoke ledger finding resolved by adding generated-project smoke evidence to this retro. |
| 2 | Test/smoke adequacy | Spark subagent summary in transcript | pass: no P0/P1/P2 | Score 4/5 before retro smoke update. P3 stale smoke ledger finding resolved by adding generated-project smoke evidence to this retro. |

## Verification Log

Record exact commands and artifact checks. Include skipped checks with reasons.

| Check | Scope | Result | Evidence / Notes |
| --- | --- | --- | --- |
| `bun test apps/trails/src/__tests__/create.test.ts` | targeted | pass | First run failed as expected on missing `@ontrails/trails`; second run passed 15 tests / 110 assertions. |
| `bun --cwd apps/trails test` | package | pass | 347 tests / 1144 assertions across 26 files. |
| generated-project smoke | runtime | pass | Created `/tmp/trails-trl-780-smoke.tNP3u2/smoke-app`; package JSON had `@ontrails/trails` `^1.0.0-beta.18`, `survey`, and `warden`; `bun install`, `bun run survey -- --help`, and `bun run warden -- --help` passed. |
| `bun run typecheck` | repo | pass | 22 successful tasks. |
| `bun run lint` | repo | pass | 23 successful tasks. |
| `bun run format:check` | repo | pass | 846 formatted files checked; 0 warnings/errors. |
| `git diff --check` | diff | pass | No whitespace errors. |
| `bun run check` | repo | pass | Full repo check passed, including lint, ast-grep, vocab audit, format, typecheck, docs checks, scaffold versions, Warden/skill sync, Clark check, Trails check, and dead-code. |

## Remote Review / CI Log

Record remote review state after submission and after each meaningful fix round.
Treat code-review bot/agent errors and unresolved P0/P1/P2 comments as
incomplete. Also record summary scores and prompt-to-fix text from code-review
bots/agents; a lower score with concrete fixable feedback is review debt even
if inline threads are resolved.

| Time | PR | CI State | Review State | Scores / Signals | Unresolved P0/P1/P2 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-23 18:40 EDT | [#577](https://github.com/outfitter-dev/trails/pull/577) | Pass | Draft, remote review pending | GitHub Actions: CI Gate, Lint & Format, Dead Code, Changeset, Build, Typecheck, Test, and Governance passed | 0 known | Leave draft until remote review settles. |

## Review Feedback Resolutions

| Source | Score / Signal | Severity | Finding | Prompt To Fix | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Spark lane 1 | 5/5 | P3 | Runtime smoke proof was pending in the retro when reviewed. | Run the temp-project smoke path end-to-end and record pass/fail in `RETRO.md`, or record a justified blocker. | Resolved by recording generated-project smoke pass for `/tmp/trails-trl-780-smoke.tNP3u2/smoke-app`. | Verification Log generated-project smoke row. |
| Spark lane 2 | 4/5 | P3 | Runtime smoke proof was pending in the retro when reviewed; unit tests cover shape, not actual installed command execution. | Add a narrow runtime smoke check in tests/CI-facing verification or explicit scripted doc; update `RETRO.md` with command result or constrained skip reason. | Resolved for this goal through explicit smoke verification and retro evidence. No automated smoke test added because the goal required a runtime smoke as execution proof, and adding networked install to unit/CI tests would expand scope. | Verification Log generated-project smoke row. |

## Forbidden Actions Audit

Record constraints that stayed true. Add or remove rows to match the goal.

| Action / Constraint | Status | Evidence |
| --- | --- | --- |
| No merge without explicit user approval | respected | PR #577 remains draft/open; no merge command run. |
| No package publish / registry mutation unless authorized | respected | No `bun run publish:packages`, npm publish, or registry mutation run. |
| No merge queue label unless authorized | respected | No merge queue label applied. |
| No source-control writes by subagents | respected | Spark subagents only reviewed; main goal executor performed commits/submission. |
| No unrelated destructive changes | respected | Diff limited to goal packet, scaffold generator/tests, changeset, and this retro. |

## Final State

Fill before claiming completion, handoff, merge readiness, or archive.

- Goal completion condition: Locally satisfied for draft handoff: generated
  scaffolds include `@ontrails/trails` dev dependency and framework scripts,
  tests/checks/smoke passed, changeset exists, branch pushed, PR opened.
- Graphite / branch state:
  `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands` pushed
  with PR #577.
- PR state: Draft PR #577,
  <https://github.com/outfitter-dev/trails/pull/577>.
- Source-control host lag: none known; CI passed.
- Tracker state: TRL-780 In Progress with PR attachment and closeout comment.
- Local review state: two Spark local review lanes; no P0/P1/P2; P3 smoke-ledger
  findings resolved.
- Remote review state: pending.
- Remote review scores: pending.
- Verification: targeted create test, `apps/trails` package tests,
  generated-project smoke, typecheck, lint, format, `git diff --check`, and
  `bun run check` passed.
- Skipped checks: none recorded.
- Remaining P3s / risks: remote review pending; PR must stay draft until clean.
- Follow-up issues created: none.
- Forbidden actions confirmation: no merge, no publish/registry mutation, no
  merge queue label, no source-control writes by subagents, no unrelated
  destructive changes.
- Packet archive readiness: not ready to archive until PR #577 is merged or
  explicitly closed out.
- Final transcript proof: final handoff should name PR #577, branch, checks, CI
  pass state, remote-review pending state, and forbidden-action confirmation.

Do not mark complete until the goal completion condition has been proven, this
section is filled or explicitly marked blocked, and the final transcript names
the updated retro state.
