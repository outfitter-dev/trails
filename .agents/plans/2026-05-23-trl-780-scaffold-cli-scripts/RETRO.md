# Execution Retro: TRL-780 Scaffold CLI Scripts

Date started: 2026-05-23
Date finalized: pending
Status: Seeded
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
- Final outcome: pending
- Final branch / stack tip: pending
- Final PR range: pending
- Final tracker state: TRL-780 pending
- Final verification state: pending
- Remaining risks / P3s: pending
- Archive state: active packet

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TRL-780 | `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands` | pending | planned | Scripts-first scaffold command reachability. |

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

## Execution Log

Append meaningful state changes, especially before handoff points.

```text
YYYY-MM-DD HH:MM TZ - <branch/issue/checkpoint>
- Changed:
- Verified:
- Result:
- Next:
- Blockers:
```

## Local Review Log

Record local review rounds, reports, P0/P1/P2 findings, fixes, and remaining
P3s. Do not mark local review complete while P0/P1/P2 findings remain.

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| pending | scaffold/package shape; tests/smoke; optional changeset policy | pending | pending | Use Spark subagents where available. |

## Verification Log

Record exact commands and artifact checks. Include skipped checks with reasons.

| Check | Scope | Result | Evidence / Notes |
| --- | --- | --- | --- |
| `bun test apps/trails/src/__tests__/create.test.ts` | targeted | pending | Required. |
| `bun --cwd apps/trails test` | package | pending | Required unless superseded by broader passing check. |
| `bun run typecheck` | repo | pending | Required unless unrelated failure is recorded. |
| `bun run lint` | repo | pending | Required unless unrelated failure is recorded. |
| `bun run format:check` | repo | pending | Required. |
| `bun run check` | repo | pending | Run if feasible; record skip if too broad/slow. |
| `git diff --check` | diff | pending | Required. |
| generated-project smoke | runtime | pending | Prefer temp create + install + `bun run survey -- --help`; record constraints if skipped. |

## Remote Review / CI Log

Record remote review state after submission and after each meaningful fix round.
Treat code-review bot/agent errors and unresolved P0/P1/P2 comments as
incomplete. Also record summary scores and prompt-to-fix text from code-review
bots/agents; a lower score with concrete fixable feedback is review debt even
if inline threads are resolved.

| Time | PR | CI State | Review State | Scores / Signals | Unresolved P0/P1/P2 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending | pending | pending |

## Review Feedback Resolutions

| Source | Score / Signal | Severity | Finding | Prompt To Fix | Resolution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending | pending | pending |

## Forbidden Actions Audit

Record constraints that stayed true. Add or remove rows to match the goal.

| Action / Constraint | Status | Evidence |
| --- | --- | --- |
| No merge without explicit user approval | pending | pending |
| No package publish / registry mutation unless authorized | pending | pending |
| No merge queue label unless authorized | pending | pending |
| No source-control writes by subagents | pending | pending |
| No unrelated destructive changes | pending | pending |

## Final State

Fill before claiming completion, handoff, merge readiness, or archive.

- Goal completion condition:
- Graphite / branch state:
- PR state:
- Source-control host lag:
- Tracker state:
- Local review state:
- Remote review state:
- Remote review scores:
- Verification:
- Skipped checks:
- Remaining P3s / risks:
- Follow-up issues created:
- Forbidden actions confirmation:
- Packet archive readiness:
- Final transcript proof:

Do not mark complete until the goal completion condition has been proven, this
section is filled or explicitly marked blocked, and the final transcript names
the updated retro state.
