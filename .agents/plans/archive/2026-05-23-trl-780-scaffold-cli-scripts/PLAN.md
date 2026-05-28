---
created: 2026-05-23T23:25:16-04:00
updated: 2026-05-24T16:45:06Z
description: Execution plan for TRL-780 scaffold CLI scripts (scripts-first Cluster D slice). Four phases: confirm current shape, implement scaffold package shape (add @ontrails/trails devDep and framework command scripts to generatePackageJson), extend tests and smoke check, then review/PR/tracker. Covers completion condition, non-goals, tracker plan, source-control plan, validation ladder, and stop rules.
impl_status: implemented
linear:
  - TRL-780
  - TRL-778
  - TRL-781
  - TRL-789
  - TRL-792
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - apps/trails/package.json
  - apps/trails/src/trails/create-scaffold.ts
  - apps/trails/src/__tests__/create.test.ts
  - apps/trails/src/trails/add-verify.ts
  - apps/trails/src/versions.ts
---

# Goal Plan: TRL-780 Scaffold CLI Scripts

Date: 2026-05-23
Status: Ready for execution

## Objective

Make fresh `trails create` projects consume the already-published
`@ontrails/trails` binary and expose the core framework CLI subcommands through
package scripts, so scaffolded apps are not functional-but-blind.

This is the scripts-first Cluster D slice for
[TRL-780](https://linear.app/outfitter/issue/TRL-780/scaffolded-projects-cant-run-most-framework-cli-subcommands).
After the 2026-05-23 stack merge, `@ontrails/trails` already has
`bin: { "trails": "./bin/trails.ts" }`; do not reopen the bin/package decision
inside this goal.

## Completion Condition

The goal is complete only when:

- `trails create` generated `package.json` includes `@ontrails/trails` as a
  dev dependency using `ontrailsPackageRange`.
- Generated scripts make the relevant framework commands reachable through
  `bun run`, including at least `warden`, `survey`, `topo`, `compile`,
  `validate`, `diff`, `doctor`, `guide`, `add`, `revise`, `deprecate`,
  `completions`, and `run`.
- Existing scaffold scripts remain intact: `build`, `test`, `typecheck`,
  `lint`, `format:check`, and `format:fix`.
- Tests prove the generated package shape, including `verify: false`.
- A smoke check proves a generated project can resolve the local `trails`
  command after install, or the reason it could not be run is recorded with the
  closest substitute proof.
- A branch-local changeset covers `@ontrails/trails`.
- `RETRO.md` has been updated as the durable execution record and final state
  ledger.

## Non-Goals

- Do not add a new CLI package or change the `@ontrails/trails` bin shape.
- Do not implement TRL-778 plugin install detection.
- Do not fix TRL-789 entity-starter CRUD warnings.
- Do not redesign scaffold reconciliation from TRL-781.
- Do not rename commands, alter CLI grammar, or make doctrine changes.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. This packet's `GOAL.md`, `REFS.md`, and `RETRO.md`
4. TRL-780 in Linear
5. `apps/trails/package.json`
6. `apps/trails/src/trails/create-scaffold.ts`
7. `apps/trails/src/__tests__/create.test.ts`
8. `apps/trails/src/trails/add-verify.ts`

## Work Plan

### Phase 1: Confirm Current Shape

Intent:

- Prove this is scaffold consumption work, not bin invention.

Actions:

- Confirm `apps/trails/package.json` exposes the `trails` bin.
- Confirm `generatePackageJson()` currently omits `@ontrails/trails` and the
  framework command scripts.
- Confirm add-verify already uses `bunx trails warden` in lefthook, so the
  generated project must carry a local `trails` binary even when verification
  hooks run.

Verification:

- `git status --short --branch`
- Read the files listed in `REFS.md`.

Done when:

- The implementation target is limited to generated package shape, tests, and a
  changeset.

### Phase 2: Implement Scaffold Package Shape

Intent:

- Give every fresh scaffold a local framework CLI entrypoint and obvious script
  aliases without adding a new primitive.

Actions:

- Add `@ontrails/trails: ontrailsPackageRange` to generated dev dependencies.
- Add a small, readable helper or constant for framework command scripts if it
  keeps `generatePackageJson()` clear.
- Generate scripts for the commands named in the completion condition.
- Keep JSON output stable and sorted where the surrounding code already sorts.

Verification:

- Targeted tests in `apps/trails/src/__tests__/create.test.ts`.

Done when:

- Tests fail before the change if asserted first, then pass after the scaffold
  generator changes.

### Phase 3: Tests, Smoke, Changeset

Intent:

- Prove the real TRL-780 failure mode is gone for newly scaffolded apps.

Actions:

- Extend scaffold tests to assert `@ontrails/trails` in `devDependencies` for
  default and `verify: false` scaffolds.
- Assert the new scripts and preserve existing scripts.
- Add `.changeset/trl-780-scaffold-cli-scripts.md` as a patch for
  `@ontrails/trails`.
- Run a generated-project smoke if practical:
  - create temp project with `bun apps/trails/bin/trails.ts create ...`
  - `bun install`
  - `bun run survey -- --help` or another no-app-load help command
  - `bun run warden -- --help`
- If the smoke cannot run due network/registry/runtime constraints, record that
  in `RETRO.md` and replace it with the narrowest proof that validates local
  bin/script generation.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `bun run check` if time and local state permit
- `git diff --check`

Done when:

- Targeted and package checks pass, broader checks pass or have justified skips,
  and the changeset is present.

### Phase 4: Review, PR, Tracker

Intent:

- Keep the branch reviewable and the tracker truthful.

Actions:

- Use Graphite and the Linear branch name:
  `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands`.
- Commit coherent changes with a Conventional Commit message.
- Open a draft PR only after local targeted checks pass.
- Keep TRL-780 updated with the implementation note and any smoke-test caveat.
- Use Spark subagents for bounded coding/review lanes when available; subagents
  must not run git or Graphite write commands.

Verification:

- Local review from at least two focused lanes:
  - scaffold/package shape
  - test and validation adequacy
- Resolve P0/P1/P2 findings before final handoff.

Done when:

- Draft PR or local branch status is clear, `RETRO.md` is current, and the final
  transcript gives exact proof.

## Tracker Plan

- In-goal issue: TRL-780
- Related but out of goal: TRL-778, TRL-781, TRL-789, TRL-792
- Project/milestone: Fieldwork Loop / Scaffold Runway
- Dependencies/blockers: previous release stack merged on 2026-05-23; no
  remaining blocker for this scripts-first slice.

## Source-Control Plan

- Branching model: Graphite
- Branch: `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands`
- PR strategy: draft until targeted checks and local review are clean; ready
  only when CI and P0/P1/P2 review feedback are clean.
- Forbidden: no merge, no publish, no registry mutation, no merge queue label
  without explicit Matt approval.
- Cleanup before merge: update `RETRO.md` final state; archive packet only if
  Matt requests merge-readiness cleanup.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification,
  local review, remote review, CI, PR-body, release, or packaging changes.
- Touch `RETRO.md` last before local completion, draft submission,
  ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry
  before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state,
  tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted: `bun test apps/trails/src/__tests__/create.test.ts`
- Package: `bun --cwd apps/trails test`
- Type/lint/format: `bun run typecheck`, `bun run lint`,
  `bun run format:check`
- Repo: `bun run check` if time/local state permit
- Diff hygiene: `git diff --check`
- Runtime smoke: generated temp project install plus `bun run <script> -- --help`
  where practical

## Local Review

Use Spark subagents for bounded review lanes if available.

- Lane 1: scaffold/package JSON shape and doctrine fit.
- Lane 2: test coverage and runtime-smoke adequacy.
- Optional Lane 3: changeset and release-policy compliance.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt to fix: concise prompt for each actionable finding

Fix all P0/P1/P2 findings before remote submission or final handoff.
Summarize each round and its fix outcome in `RETRO.md`.

For remote code-review bots/agents, also record summary scores, prose
summaries, prompt-to-fix blocks, and whether any score below 5/5 reflects
current unresolved debt, stale feedback, or an explicitly rejected
recommendation.

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

- Current `main` no longer has the `@ontrails/trails` bin.
- Fixing TRL-780 appears to require a new public package, CLI grammar change, or
  doctrine decision.
- Generated command scripts require a naming convention that conflicts with
  existing package scripts.
- Verification fails for unrelated reasons after one focused retry.
- Network/registry smoke fails in a way that may indicate beta publication
  drift rather than local scaffold behavior.
- Secrets, credentials, production systems, publish, merge, or irreversible
  actions are needed.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current.
- [x] Branch names/order are exact where applicable.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are copied, summarized, moved, or avoided.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review,
      verification, remote state, forbidden actions, final state, and archive
      readiness.
- [x] Packet can be executed without chat history.
