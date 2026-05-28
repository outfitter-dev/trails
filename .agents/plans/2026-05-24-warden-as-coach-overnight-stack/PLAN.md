---
created: 2026-05-24T16:45:07Z
updated: 2026-05-24T16:45:08Z
description: Detailed execution plan for the Warden-as-coach overnight session. Covers objective, completion conditions, non-goals, source-of-truth reading list, per-issue stack order with intent/actions/verification for TRL-791/793/794/785/786/790, tracker plan, source-control plan, retro discipline, validation ladder, local review lanes, and stop/pause rules.
impl_status: partial
linear:
  - TRL-785
  - TRL-786
  - TRL-790
  - TRL-791
  - TRL-793
  - TRL-794
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/tenets.md
  - docs/lexicon.md
  - packages/warden/src/rules/
  - packages/warden/src/__tests__/
  - .agents/plans/2026-05-24-warden-as-coach-overnight-stack/RETRO.md
---

# Goal Plan: Warden As Coach Overnight Stack

- **Date:** 2026-05-24
- **Status:** In progress

## Objective

Clear as much of the Warden-as-coach stack as safely possible overnight, turning Radio/Fieldwork learnings into concrete Trails guidance that leads agents toward the happy path.

## Completion Condition

The goal is complete only when:

- Each completed slice has a focused branch, draft PR, current Linear state, and updated `RETRO.md`.
- P0/P1/P2 local review findings are fixed or explicitly blocked before submission.
- Required checks pass for each submitted PR and CI state is recorded.
- No merge, package publish, registry mutation, merge queue label, or subagent source-control write occurs without explicit Matt approval.
- `RETRO.md` is updated as the durable execution record and final state ledger.

## Non-Goals

- Do not merge PRs.
- Do not publish packages or mutate registry state.
- Do not broaden Warden doctrine, public API, or rule semantics beyond the active issue without a new issue/comment.
- Do not fold unrelated scaffold or fieldguide work into the Warden stack.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `docs/tenets.md`
4. `docs/lexicon.md`
5. `packages/warden/src/rules/*`
6. `packages/warden/src/__tests__/*`
7. `plans/fieldwork-loop/warden-diagnostic-audit-20260523.md` if present in `trailblazing`
8. Linear `TRL-791`, `TRL-793`, `TRL-785`, `TRL-786`, `TRL-790`

## Stack Order

### TRL-791: Reject destructured `ctx.cross`

Status: draft PR submitted as #582.

Intent:

- Keep crossing provenance visible as `ctx.cross(...)` so Warden and future agents can see composition edges.

Actions:

- Add `no-destructured-cross`.
- Wire rule metadata, registry, trail wrapper, generated guide surfaces, tests, and changeset.
- Clean up any live examples that destructure `cross`.

Verification:

- Focused Warden tests.
- `bun --cwd packages/warden test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `git diff --check`
- `bun run check`
- CI green.

### TRL-793: Upgrade names-only diagnostics

Status: draft PR submitted as #583.

Intent:

- Make existing Warden diagnostics teach the fix instead of only naming the violation.

Actions:

- Update names-only diagnostics for `implementation-returns-result`, `resource-declarations`, `resource-exists`, `cross-declarations`, `valid-detour-contract`, `circular-refs`, `on-references-exist`, plus same-family `contour-exists` and `reference-exists`.
- Keep rule firing logic unchanged.
- Update exact-message tests and generated rule-trail expectations as needed.
- Record scope divergence honestly: partial diagnostics moved to `TRL-794`.

Verification:

- Focused touched-rule suite.
- `bun --cwd packages/warden test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `git diff --check`
- `bun run check`
- CI after draft PR.

### TRL-794: Upgrade partial diagnostics

Status: follow-up filed.

Intent:

- Sharpen the 13 partial Warden diagnostics from the audit without bloating the names-only PR.

Actions:

- Keep as diagnostic language + tests unless a rule cannot be made honest without detection changes.
- Sequence after the higher-priority provenance work unless Matt/Clark chooses wording cleanup first.

Verification:

- Focused touched-rule tests.
- Warden package tests.
- Repo gates.

### TRL-785: Result helper provenance alias gap

Status: draft PR submitted as #584; CI running.

Intent:

- Close the TRL-333 coverage hole where helper return annotations using `Result as ResultType` are invisible to `implementation-returns-result`.

Actions:

- Add failing fixtures for same-file and imported helpers using aliased `Result`.
- Make `hasResultReturnType` alias-aware without re-implementing TRL-333.
- Preserve `.js` to `.ts` import resolution; Clark's cause check ruled it out as the Radio failure.
- Teach or document the single-import pattern if the code surface naturally exposes it.

Verification:

- `bun test packages/warden/src/__tests__/implementation-returns-result.test.ts`
- `bun --cwd packages/warden test`
- `bun run typecheck`
- `bun run lint`
- `bun run check`

### TRL-786: Redundant `Result.err(x.error)` re-wrap detection

Status: after TRL-785 unless new evidence says otherwise.

Intent:

- Coach agents away from re-wrapping Result errors when propagation is the right path.

Actions:

- Use provenance from TRL-785; avoid syntactic-only detection.
- Add conservative fixtures for true redundant re-wraps and legitimate transformations.
- Keep diagnostic language specific: preserve the original Result or intentionally transform the error with a new TrailsError.

Verification:

- Focused new rule tests.
- Warden package tests.
- Repo gates.

### TRL-790: `TODO[trails-*]` lint marker carve-out

Status: opportunistic low-risk slice.

Intent:

- Allow explicit Trails-tracked TODO markers without fighting repo lint.

Actions:

- Keep isolated because it may touch lint/generated config surfaces.
- Verify it does not normalize generic TODO debt.

Verification:

- Focused lint/config check.
- `bun run lint`
- `bun run check`

## Tracker Plan

- In-goal issues: `TRL-791`, `TRL-793`, `TRL-794`, `TRL-785`, `TRL-786`, `TRL-790`.
- Dependencies/blockers: `TRL-786` should follow `TRL-785`; `TRL-794` owns the partial diagnostics left out of TRL-793.
- Keep Linear comments current after local verification, PR submission, and CI.
- Do not mark issues Done before merge.

## Source-Control Plan

- Branching model: Graphite.
- One issue per PR unless a tiny follow-up is explicitly inseparable.
- Use Linear-recommended branch names.
- Keep PRs draft until local checks and CI are green.
- Main agent performs all `git`/`gt` write operations; subagents do not.
- No merge without Matt approval.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification, local review, remote review, CI, PR-body, or source-control changes.
- Touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.

## Validation Ladder

Run checks from narrow to broad:

- Targeted: `bun test <touched warden test files>`
- Package: `bun --cwd packages/warden test`
- Repo: `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`
- Full gate: `bun run check`
- CI: GitHub checks on draft PR

## Local Review

Use subagents for bounded review lanes when a slice changes behavior or enough diagnostics to invite wording drift.

- Lane 1: false positives / firing logic
- Lane 2: diagnostic language and doctrine accuracy
- Lane 3: tests, examples, generated artifacts, and changeset coverage

Fix all P0/P1/P2 findings before remote submission or final handoff. Record each round and fix outcome in `RETRO.md`.

## Stop / Pause Rules

Stop and ask if:

- Linear, PR, or repo state diverges from this packet.
- A public API or doctrine change is needed beyond the active issue.
- Verification fails for unrelated reasons after focused retry.
- Secrets, credentials, production systems, merge, publish, or merge queue actions are needed.
- `TRL-785` or `TRL-786` requires broad provenance work beyond the current Warden rule boundary.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state requirements are represented.
- [x] Branch names/order are exact where known.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are summarized instead of required.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
