# Goal Plan: scaffold forward-compat seed

Date: 2026-05-24
Status: Seeded

## Objective

Build the smallest scaffold-forward-compat stack after the merged scaffold and
Warden work:

1. TRL-796: generated projects pin `@ontrails/*` packages to the exact current
   Trails beta version instead of a caret prerelease range.
2. TRL-798: generated projects get a minimal scaffold provenance breadcrumb so
   future upgrade tooling can identify their scaffold lineage.
3. TRL-797: release operators get a clean helper/check path for bumping scaffold
   output versions without hand-edit drift.
4. TRL-799: the post-1.0 scaffold forward-compatibility direction is captured
   in a draft ADR grounded in the implemented breadcrumb shape.

This is the coherent scaffold-forward line. It is still not the full
upgrade-path system.

## Completion Condition

The goal is complete only when:

- TRL-796, TRL-798, TRL-797, and TRL-799 are implemented on separate stacked
  Graphite branches in that order.
- Draft PRs are open, CI is green, and Linear issues are current.
- Generated `package.json` files use exact `@ontrails/*` beta pins.
- Generated projects include a documented `.trails/scaffold.json` provenance
  breadcrumb.
- Scaffold tests assert both the exact-pin shape and provenance file.
- A helper/check path exists for keeping scaffold output version pins and
  `scaffold-versions.generated.ts` aligned after version bumps.
- A draft ADR under `docs/adr/drafts/` captures the layer distinction, borrowed
  versioning patterns, and phased path for scaffold forward compatibility.
- `docs/releases/stable-cutover.md` records the exact-pin prerequisite.
- Branch-local patch changesets exist for package-touching PRs that ship
  `@ontrails/trails` behavior/tooling. Docs-only ADR work does not need a
  changeset unless the diff touches publishable package content.
- Local review finds no unresolved P0/P1/P2 findings.
- No merge, merge queue label, publish, registry mutation, or stable-versioning
  command is run.
- `RETRO.md` has final tracker, PR, review, verification, forbidden-action,
  risk, and archive-readiness state before handoff.

## Non-Goals

- Do not implement TRL-803 bootstrap/worktree hook tooling.
- Do not execute TRL-801 separately; treat it as decision coverage superseded
  by TRL-796 unless Matt reopens it.
- Do not build scaffold diffing, migration, template hash markers, upgrade
  application, provenance-reading tooling, or a public `trails upgrade` command.
- Do not change package publication, dist-tags, release versions, or the
  Changesets release flow.
- Do not sweep historical beta release notes just because they show old caret
  examples; only update active/current docs needed for this slice.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. Linear TRL-796, TRL-798, TRL-797, and TRL-799
4. `apps/trails/src/versions.ts`
5. `apps/trails/src/trails/create-scaffold.ts`
6. `apps/trails/src/__tests__/create.test.ts`
7. `scripts/sync-scaffold-versions.ts`
8. `package.json` script section
9. `docs/releases/beta-channel-policy.md`
10. `docs/releases/stable-cutover.md`
11. `docs/adr/drafts/README.md`
12. `.agents/plans/2026-05-23-scaffold-runway-overnight-stack/RETRO.md`

## Work Plan

### Phase 0: Preflight

Intent:

- Start from current `main`, confirm the merged baseline includes the previous
  scaffold/Warden stack, and verify no stale plan assumption remains.

Actions:

- Run `gt sync` from a branch checkout, or fetch/switch as needed in a detached
  worktree.
- Inspect `git status --short --branch`.
- Read TRL-796, TRL-798, TRL-797, TRL-799, and any newest comments.
- Check whether TRL-801 has been closed, commented, or superseded.

Verification:

- `git log --oneline -8`
- `git status --short --branch`

Done when:

- The executor is on current main or a clean branch based on it, and the issue
  state still matches this packet.

### Phase 1: TRL-796 Exact Beta Pin

Intent:

- Remove the stable-cutover footgun caused by caret prerelease ranges.

Actions:

- Create branch
  `trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel`.
- Change the scaffolded `@ontrails/*` range owner in
  `apps/trails/src/versions.ts` so `ontrailsPackageRange` is the exact
  `trailsPackageVersion`, not `^${trailsPackageVersion}`.
- Keep the public/local name `ontrailsPackageRange` unless a rename is needed
  for clarity; unnecessary rename churn is out of scope.
- Update scaffold tests to assert the emitted `@ontrails/*` range is exact and
  does not start with `^`.
- Add `docs/releases/stable-cutover.md` prerequisite language making exact
  scaffold pins a stable-cutover blocker.
- Add a patch changeset for `@ontrails/trails`.
- Update Linear TRL-796 with any implementation divergence.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run format:check`
- `git diff --check`
- `bun run typecheck`

Done when:

- The branch is locally clean, committed with a Conventional Commit message, and
  the stack can support TRL-798 above it.

### Phase 2: TRL-798 Scaffold Provenance Breadcrumb

Intent:

- Seed future scaffold upgrade tooling with lineage data that cannot be
  recovered later for already-generated projects.

Actions:

- Create branch
  `trl-798-stamp-scaffold-provenance-into-generated-projects-minimal` stacked
  on TRL-796.
- Generate `.trails/scaffold.json` during `create.scaffold`.
- Prefer this minimal JSON shape unless implementation evidence forces a tweak:

  ```json
  {
    "schemaVersion": 1,
    "scaffoldVersion": "1.0.0-beta.N",
    "template": "hello",
    "generatedAt": "2026-05-24T00:00:00.000Z"
  }
  ```

- `scaffoldVersion` must use the same source as `trailsPackageVersion`.
- `template` is the starter id used by `create.scaffold`.
- `generatedAt` is an ISO timestamp generated at scaffold time.
- Add tests for default create, dry-run operation planning, and at least one
  alternate starter where useful.
- Document the provenance contract in a stable current-facing doc. Prefer a
  small section in `docs/getting-started.md` or `docs/releases/stable-cutover.md`
  over creating a new doc unless the text would get too large.
- Add a patch changeset for `@ontrails/trails`.
- Update Linear TRL-798 with any shape divergence.

Verification:

- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run format:check`
- `git diff --check`
- `bun run typecheck`

Done when:

- The branch is locally clean and committed above TRL-796.

### Phase 3: TRL-797 Clean Scaffold Version Bump Helper

Intent:

- Keep exact pins ergonomic by making future bump work a one-command/checkable
  path instead of scattered hand edits.

Actions:

- Create branch
  `trl-797-internal-helper-for-clean-ontrails-version-bumps-in-scaffold` stacked
  on TRL-798.
- Inspect `scripts/sync-scaffold-versions.ts`, `package.json` scripts, and the
  Changesets version flow before editing.
- Prefer extending existing scaffold-version tooling over inventing a public
  trail, surface, or release system.
- The helper/check should compose with `bunx changeset version`; it may be a
  script enhancement, package script, or check that validates the emitted
  `@ontrails/*` pin against the CLI app version and validates
  `scaffold-versions.generated.ts` drift.
- Keep this internal/dev tooling. Do not expose it as public CLI grammar unless
  implementation evidence proves that is the smallest honest path.
- Add focused tests or a check path that fails when the emitted pin and intended
  version drift.
- Add a patch changeset for `@ontrails/trails` if the helper changes
  publishable app/package behavior; document any no-changeset decision.
- Update Linear TRL-797 with implementation notes and any scope divergence.

Verification:

- `bun run scaffold-versions:check`
- Targeted test(s) for the helper/check if added
- `bun test apps/trails/src/__tests__/create.test.ts`
- `bun --cwd apps/trails test`
- `bun run format:check`
- `git diff --check`
- `bun run typecheck`

Done when:

- The branch is locally clean, committed above TRL-798, and exact-pin bump
  hygiene is checkable.

### Phase 4: TRL-799 Draft ADR

Intent:

- Preserve the scaffold forward-compatibility direction without prematurely
  implementing the post-1.0 system.

Actions:

- Create branch
  `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system` stacked
  on TRL-797.
- Draft under `docs/adr/drafts/` using current draft ADR conventions.
- Capture:
  - why trail versioning is the wrong layer for scaffold lineage;
  - what transfers from versioning as design pattern only;
  - why `.trails/scaffold.json` is the minimal beta-window breadcrumb;
  - phased path: breadcrumb now, read/diff later, file-level migration later;
  - explicit non-goals for this pre-1.0 slice.
- Update draft ADR indexes/maps only through repo scripts if required by the ADR
  tooling.
- No changeset unless publishable package content changes.
- Update Linear TRL-799 with draft path and verification.

Verification:

- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- `bun run docs:links`
- `bun run format:check`
- `git diff --check`

Done when:

- The ADR draft is present, linked by generated ADR metadata if required, and
  committed above TRL-797.

### Phase 5: Review, Submit, And Tracker Closeout

Intent:

- Ship this as a coherent, reviewable stack with enough proof for merge later.

Actions:

- Run local review from the stack tip before submission:
  - Lane 1: scaffold package/range and provenance shape.
  - Lane 2: bump-helper/tooling path and generated-output coverage.
  - Lane 3: release/docs/ADR wording and doctrine fit.
- Fix all P0/P1/P2 findings on the owning branch and restack upward.
- Run final checks from the stack tip.
- Submit draft PRs with clear PR bodies.
- Keep PRs draft until CI is green and local review is clean.
- Update Linear TRL-796, TRL-798, TRL-797, and TRL-799 with PR links,
  verification, review state, and any out-of-scope follow-ups.
- Comment on TRL-801 if not already done: TRL-796 subsumes its decision and
  implementation path.

Verification:

- `bun run check`
- `git diff --check`
- PR CI for all PRs
- Remote review summaries and unresolved threads checked after CI/reviews post

Done when:

- Draft PRs exist, CI is green, local review is P3-only or clean, and
  `RETRO.md` final state is filled.

## Tracker Plan

- In-goal issues: TRL-796, TRL-798, TRL-797, TRL-799.
- Related/superseded: TRL-801 should be treated as covered by TRL-796 unless
  Matt wants a separate closure task.
- Follow-up issues intentionally out of goal:
  - TRL-803: bootstrap hook tooling in fresh worktrees.
  - TRL-794: Warden partial diagnostics.
  - TRL-782/TRL-783: type-safety lane.
- Dependencies/blockers:
  - TRL-798 depends on TRL-796 for the exact version source only loosely, but
    stacking them keeps scaffold-output review coherent.
  - TRL-797 follows TRL-796/798 because the helper should validate the real
    exact-pin and scaffold-output state.
  - TRL-799 follows TRL-798/797 because the ADR should point at the real
    breadcrumb and operator-helper shape rather than speculate.
- Project/status: preserve current Linear project/status assignments; do not
  move issues unless Matt asks.

## Source-Control Plan

- Branching model: Graphite.
- Branch order:
  1. `trl-796-scaffold-emits-caret-range-that-floats-past-the-beta-channel`
  2. `trl-798-stamp-scaffold-provenance-into-generated-projects-minimal`
  3. `trl-797-internal-helper-for-clean-ontrails-version-bumps-in-scaffold`
  4. `trl-799-draft-adr-scaffold-forward-compatibility-upgrade-path-system`
- PR strategy:
  - One PR per Linear issue.
  - Submit as draft.
  - Keep draft until CI is green and local review is clean.
  - Do not merge or queue.
- Downstack fixes:
  - Check out the owning branch directly.
  - Apply the fix there.
  - `gt modify`.
  - `gt restack`.
  - Walk checks upward through affected descendants.
  - Do not use `gt absorb` as the default workflow.
- Packet commit policy:
  - Commit this packet on the lowest branch if it is included in execution.
  - Touch `RETRO.md` last before local completion, draft submission, review
    closeout, or final handoff.
- Cleanup before merge:
  - Do not archive this packet until the PR stack is merged or Matt explicitly
    asks.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification,
  local review, remote review, CI, PR-body, or packaging changes.
- For stacked work, touch `RETRO.md` last before local completion, draft
  submission, ready-for-review, remote review closeout, merge readiness, or
  final handoff.
- Every meaningful review-flow change must have a corresponding retro entry
  before claiming the review loop is complete.
- Before completion, fill final state, verification log, review state, tracker
  state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted: `bun test apps/trails/src/__tests__/create.test.ts`
- Helper: `bun run scaffold-versions:check`
- ADR/docs: `bun scripts/adr.ts map`, `bun scripts/adr.ts check`,
  `bun run docs:links`
- App/package: `bun --cwd apps/trails test`
- Type/format: `bun run typecheck`, `bun run format:check`, `git diff --check`
- Full repo before submission/final handoff: `bun run check`
- Optional smoke if time permits:
  - create a temp scaffold with `bun apps/trails/bin/trails.ts create ...`
  - inspect `package.json` and `.trails/scaffold.json`
  - run `bun install`, `bun run typecheck`, and `bun test` inside it if network
    and registry state are available.

## Local Review

Required before draft submission.

- Lane 1: scaffold package/range and provenance shape.
- Lane 2: bump-helper/tooling path, tests, and generated-output coverage.
- Lane 3: release/docs/ADR/changeset wording and doctrine fit.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt to fix: concise prompt for each actionable finding

Fix all P0/P1/P2 findings before remote submission or final handoff. Record
review summaries, findings, fixes, and residual P3s in `RETRO.md`.

For remote code-review bots/agents, also record summary scores, prose summaries,
prompt-to-fix blocks, and whether any score below 5/5 reflects current
unresolved debt, stale feedback, or an explicitly rejected recommendation.

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

- Linear or repo state shows TRL-796/798/797/799 are already implemented or
  materially reshaped.
- The exact-pin decision reopens into `@beta` or another policy choice.
- The provenance breadcrumb needs behavior beyond writing/documenting a file.
- The bump-helper scope expands into release automation or publication.
- The draft ADR requires accepting a new Trails primitive or public command now.
- A public API, artifact-family doctrine, or stable-cutover doctrine change is
  needed beyond this packet.
- Verification fails for unrelated reasons after focused retry.
- Secrets, credentials, publication, registry mutation, merge queue labels, or
  a merge are needed.
- More than three focused attempts do not shrink a failing surface.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current as of planning.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are summarized in `REFS.md`.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review,
      verification, remote state, forbidden actions, final state, and archive
      readiness.
- [x] Packet can be executed without chat history.
