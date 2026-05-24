# Goal Plan: Scaffold Runway Overnight Stack

Date: 2026-05-23
Status: Draft

## Objective

Build the next coherent Fieldwork Loop scaffold-runway motion after TRL-780: a scaffold-code stack for generated test TypeScript coverage, agent guidance, and README, plus a separate docs sidecar for the Bun runtime requirement gap.

## Completion Condition

The goal is complete only when:

- TRL-788, TRL-777, and TRL-779 each either have a draft PR in the intended scaffold stack or are explicitly deferred in `RETRO.md` with evidence.
- TRL-792 has a separate draft PR or an explicit evidence-backed deferral.
- Each package-affecting PR includes a branch-local changeset for `@ontrails/trails`, unless the PR is docs-only or explicitly labeled `release:none`.
- Targeted scaffold tests and relevant repo checks pass, or any skipped check is recorded with a concrete reason.
- Linear issue state, comments, branches, PRs, and remaining blockers are current.
- No merge, publish, registry mutation, or merge-queue label happens without Matt explicitly asking.
- `RETRO.md` has been updated as the durable execution record and final state ledger.

## Non-Goals

- Do not implement TRL-778 plugin install detection, TRL-781 scaffold rerun reconciliation, or TRL-789 entity CRUD completeness in this stack.
- Do not touch TRL-782/TRL-783 type semantics or TRL-790/TRL-791 Warden coaching in this stack.
- Do not relitigate `cross`/`crosses` naming or implement TRL-784.
- Do not add `--no-agents`, `--no-readme`, or new prompt flags unless a current test or issue proves they are required.
- Do not change CLI grammar beyond generated docs/scripts using already shipped commands.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. Linear project `Fieldwork Loop`
4. Linear issues TRL-788, TRL-777, TRL-779, TRL-792
5. `apps/trails/src/trails/create-scaffold.ts`
6. `apps/trails/src/__tests__/create.test.ts`
7. `docs/releases/beta-channel-policy.md`
8. `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-23-lewis-clark-turnaround.md`

## Work Plan

### Phase 0: Preflight And Tracker Truth

Intent:

- Start from synced `main`, avoid stale branch state, and keep completed packet cleanup visible.

Actions:

- Confirm `main` at or after PR #577 merge commit `52e4e8f7d`.
- Archive `.agents/plans/2026-05-23-trl-780-scaffold-cli-scripts/` under `.agents/plans/archive/`.
- Confirm Linear issues are still Backlog/Done as expected.
- Move in-goal issues to In Progress only when execution actually starts.

Verification:

- `git status --short --branch`
- `gt status`

Done when:

- Working tree changes are only the packet/archive work before implementation begins.

### Phase 1: TRL-788 Test TypeScript Config

Intent:

- Generated projects should get the repo's own `tsconfig.tests.json` convention so test files are visible to editor/LSP tooling without polluting build output.

Actions:

- Add a generated `tsconfig.tests.json` template to `create-scaffold.ts`.
- Prefer the dogfooded repo shape over the issue sketch if the sketch conflicts with root `__tests__` location or `rootDir`: generated tests live in root `__tests__/`, while main `tsconfig.json` has `rootDir: "src"`.
- Include `tsconfig.tests.json` in the base scaffold file map and default-file assertions.
- Add focused assertions for the generated JSON shape.
- Add a patch changeset for `@ontrails/trails`.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`

Done when:

- Default and `verify: false` scaffolds include the sibling config and tests prove its contents.

### Phase 2: TRL-777 Agent Guidance

Intent:

- Generated apps should tell agents they are in a Trails project immediately, using canonical Trails vocabulary and shallow guidance.

Actions:

- Add generated `AGENTS.md` content that is terse, framework-generic, and aligned with `AGENTS.md`, `docs/lexicon.md`, and `docs/tenets.md`.
- Add `CLAUDE.md` as a thin compatibility shim pointing to `AGENTS.md`. If implementing a true symlink would require widening `ProjectWriteOperation`, prefer the shim and record the issue-body divergence in Linear/RETRO.
- Avoid project-specific claims the scaffolder cannot know.
- Update scaffold tests for presence and key wording.
- Add a patch changeset for `@ontrails/trails`.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run format:check`

Done when:

- Default generated apps contain `AGENTS.md` plus `CLAUDE.md`, and tests assert canonical vocabulary and no retired nouns.

### Phase 3: TRL-779 Generated README

Intent:

- Humans get the same first-run runway agents get: commands, structure, surfaces, and next steps derived from scaffold options.

Actions:

- Add a generated `README.md` template that uses project name, selected surfaces, starter, and verify setting.
- Keep it short. It should orient, not become the full docs site.
- Ensure commands match current scaffold scripts from TRL-780 (`bun run warden`, `bun run survey`, `bun run test`, etc.).
- Do not generate this too early from `create.scaffold` if it would lie about surfaces. `create.scaffold` only knows `name` and `starter`; the full `create` trail knows `surfaces` and `verify`.
- Prefer a small internal helper/trail or write step after surface/verify work if contextual README generation needs full `create` input.
- Update tests for default, surface-specific, and starter-sensitive content where useful.
- Add a patch changeset for `@ontrails/trails`.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run format:check`

Done when:

- Generated README content reflects the selected surfaces and current script grammar.

### Phase 4: TRL-792 Bun Runtime Requirement Docs Sidecar

Intent:

- Consumer docs should explicitly say Trails requires Bun for published CLI invocation; Node-only/`npx` invocation is unsupported.

Actions:

- Add the runtime requirement near `docs/releases/beta-channel-policy.md#consumer-installs`.
- Use the issue's `bunx --bun --package @ontrails/trails@beta trails <subcommand>` shape unless live verification proves a better command.
- Consider whether `README.md` and `docs/getting-started.md` need a small alignment line; keep the branch docs-only.
- Do not change package code in this branch unless the docs reveal a hard contradiction.

Verification:

- `bun run format:check`
- `git diff --check`

Done when:

- The beta channel policy explicitly names the Bun runtime requirement and unsupported Node-only path. This PR does not need to be stacked on the scaffold-code PRs.

### Phase 5: Local Review, Draft Submission, Remote Review

Intent:

- Keep the stack reviewable and prevent scaffold/template copy from drifting out of Trails doctrine.

Actions:

- Run local review lanes before draft submission from stack tip.
- Fix P0/P1/P2 findings bottom-up on the owning branch.
- Submit draft PRs only after local checks and local review are clean enough.
- Keep each PR draft until CI and review-bot state are clean.
- Update `RETRO.md` after each meaningful fix/review state change.

Verification:

- Targeted tests after each owning branch.
- Before submission or final handoff: `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`, and `bun run check` if time allows.

Done when:

- Stack is submitted as draft PRs or explicitly stopped with current evidence in `RETRO.md`.

## Tracker Plan

- In-goal issues: TRL-788, TRL-777, TRL-779, TRL-792.
- Follow-up candidates only if discovered: issue-body divergence for CLAUDE symlink vs shim; docs command alignment outside TRL-792; generated-app dependency range policy if it resurfaces.
- Dependencies/blockers: TRL-780 must be merged first; verified merged as PR #577.
- Milestones/projects: all in Fieldwork Loop / Scaffold Runway.

## Source-Control Plan

- Branching model: Graphite.
- Scaffold stack order:
  1. `trl-788-trails-create-scaffold-tsconfigtestsjson-sibling-for-lsp`
  2. `trl-777-trails-create-scaffolds-agentsmd-claudemd-minimal-trails`
  3. `trl-779-trails-create-scaffolds-readmemd-create-react-app-style`
- Sidecar branch from `main`, independent of the scaffold stack:
  - `trl-792-document-bun-runtime-requirement-for-consumers-beta-channel`
- PR strategy: draft PRs until CI, local review, and P0/P1/P2 remote review are clean.
- Cleanup before merge: finalize `RETRO.md`; archive this packet only when the full goal is done or explicitly abandoned.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification, local review, remote review, CI, PR-body, release, or packaging changes.
- For stacked work, touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state, tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted scaffold: `bun test apps/trails/src/__tests__/create.test.ts`
- App package: `bun --cwd apps/trails test`
- Repo checks: `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`
- Full gate if time allows: `bun run check`
- Changeset gate: confirm each package-affecting PR has a `.changeset/*.md`

## Local Review

Required because this is a stack and generated guidance can become doctrine drift.

- Lane 1: Scaffold file generation and tests.
- Lane 2: Trails vocabulary/doctrine in generated `AGENTS.md` and README.
- Lane 3: Release/docs correctness and changeset/PR hygiene.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt to fix: concise prompt for each actionable finding

Fix all P0/P1/P2 findings before remote submission or final handoff.
Summarize each round and its fix outcome in `RETRO.md`.

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

- Linear, source, or PR state diverges from this packet in a way that changes stack order.
- A new scaffold option, public API shape, CLI grammar change, or `ProjectWriteOperation` primitive is required.
- Symlink support becomes necessary rather than a thin `CLAUDE.md` shim.
- Verification fails for an unrelated reason after one focused retry.
- Secrets, credentials, production systems, publication, merge, or irreversible actions are needed.
- Local or remote review finds unresolved P0/P1/P2 issues outside the current goal.

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
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
