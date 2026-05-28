---
created: "2026-05-27T20:12:09Z"
updated: "2026-05-27T20:12:09Z"
description: Detailed execution plan for the first Regrade proof stack. States the ruling that Regrade is Trails using Trails, defines phases 0–3 with intent, source anchors, and done conditions for TRL-823, TRL-819, and TRL-825. Includes source-control plan, subagent strategy, tracker plan, local review output contract, remote review plan, validation ladder, and stop rules.
linear:
  - TRL-819
  - TRL-823
  - TRL-825
  - TRL-826
  - TRL-827
  - TRL-828
  - TRL-829
  - TRL-830
  - TRL-836
impl_status: implemented
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
  - docs/adr/0047-stable-release-line-discipline.md
  - docs/releases/stable-cutover.md
  - scripts/publish.ts
  - packages/core/src/types.ts
  - packages/core/src/type-utils.ts
  - packages/core/src/trail.ts
  - packages/core/src/type-checks.test-d.ts
  - packages/testing/src/examples.ts
  - packages/testing/src/__tests__/contracts.test.ts
  - packages/topographer/src/derive.ts
  - packages/wayfinder/
  - apps/trails/package.json
---

# Goal Plan: Regrade Tracer Stack

- **Date:** 2026-05-27
- **Status:** Planned

## Objective

Land the first executable Regrade stack: make package publication checks reject stale first-party beta rewrites, fix trail-object `ctx.compose(trail, input)` inference for trails without `composeInput`, then prove whether Regrade transform units can be literal `trail()` instances in an experimental `packages/regrade` package.

This is the architecture proof slice. It should not try to ship the full `trails regrade` CLI, downstream-root coverage, Warden-backed `term-rewrite`, or package-source delivery UX.

## Completion Condition

The goal is complete only when:

- A Graphite stack has draft PRs for `TRL-823`, `TRL-819`, and `TRL-825`, or
  stops earlier with a precise blocker recorded in `RETRO.md`.
- `TRL-823` proves packed manifests cannot silently rewrite first-party `workspace:^` dependencies to stale beta versions.
- `TRL-819` proves `ctx.compose(trailObject, input)` infers callable input and output from a normal trail's authored contract when `composeInput` is absent.
- `TRL-825` creates the smallest useful `packages/regrade` tracer and records whether literal transform trails pollute topo/surfaces/runtime semantics.
- Required branch-local changesets are present for publishable package content.
- Local review is clean or P3-only before PRs are marked ready for review.
- After ready-for-review, at most three remote review-bot feedback rounds are attempted; P0/P1/P2 findings are fixed on the owning branch or left as an explicit blocker.
- Linear issues, PR bodies, CI state, review state, unresolved P3s, and any follow-up issues are current.
- No merge, package publish, registry mutation, merge queue label, or subagent source-control write occurs without explicit Matt approval.
- `RETRO.md` is updated as the durable execution record and final state ledger.

## Non-Goals

- Do not implement `TRL-826`, `TRL-827`, `TRL-828`, `TRL-829`, `TRL-830`, or `TRL-836` inside this stack unless Matt explicitly expands scope.
- Do not implement the full `trails regrade` CLI.
- Do not implement downstream-root scanning, rule selection, coverage reports, version-delta resolution, local tarball package modes, or `NeedsReview` UX beyond the tracer's minimal output.
- Do not implement Warden fix metadata, `warden --fix`, or `term-rewrite`.
- Do not publish packages, mutate npm, add merge queue labels, or merge PRs.
- Do not touch unrelated open PRs #602 / #607 or the untracked `.agents/plans/2026-05-26-radio-compose-proof/README.md`.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `docs/adr/0000-core-premise.md`
4. `docs/tenets.md`
5. `docs/adr/0001-naming-conventions.md`
6. `docs/lexicon.md`
7. `docs/architecture.md`
8. Linear `TRL-823`, `TRL-819`, `TRL-825`
9. This packet's `REFS.md`

Local planning note summarized into this packet:

- `/Users/mg/Developer/outfitter/trailblazing/plans/regrade/README.md`

Do not make execution depend on that local trailblazing note being present. This packet carries the load-bearing decisions.

## Ruling Carried Into Execution

Regrade is not a new Trails primitive. It is Trails using Trails to make Trails code upgradeable.

Basis:

- ADR-0000: author what's new, derive what's known, override what's wrong.
- Tenets: contracts and derivation should make drift harder than alignment.
- Lexicon: use `trail`, `blaze`, `topo`, `compose`, `surface`, `resource`, and `layer` precisely.

Stack implications:

- Strengthen existing primitives first: `ctx.compose(trail, input)` should derive from the authored trail contract.
- Harden release tooling before trusting tarball/package-mode proofs.
- Prove literal transform trails structurally before bringing in Warden-backed rename/fix metadata.
- Keep `RegradeReport` as output schema/report data. Do not model it as a contour in this slice.

## Stack Order

Use one Graphite line for this goal:

1. `trl-823-fail-publish-checks-when-packed-manifests-rewrite-first`
2. `trl-819-fix-ctxcomposetrail-input-inference-for-trails-without`
3. `trl-825-scaffold-packagesregrade-and-prove-literal-transform-trails`

`TRL-823` and `TRL-819` are logically independent, but keeping one line avoids extra stack sprawl for this sprint. If `TRL-823` becomes contentious or blocks the tracer for reasons unrelated to Regrade, stop and ask before splitting the stack.

## Work Plan

### Phase 0: Preflight

Intent:

- Start from current `main` in the main checkout and avoid inherited stack
  drift.

Actions:

- Work from `/Users/mg/Developer/outfitter/trails`.
- Run `gt sync`, `gt ls`, `git status --short --untracked-files=all`, and inspect open PRs.
- Confirm PRs #602 and #607 are unrelated and leave them alone unless Graphite reports a real branch conflict.
- Preserve unrelated untracked local state, including `.agents/plans/2026-05-26-radio-compose-proof/README.md`.
- Move target Linear issues to In Progress only when starting their branch.

Verification:

- `git branch --show-current`
- `gt ls`
- `git status --short --untracked-files=all`

Done when:

- The executor knows the base branch, dirty state, and unrelated open PRs.

### Phase 1: TRL-823 publish-check beta coherence

Intent:

- Make `bun run publish:check` fail when the packed artifact rewrites a first-party workspace dependency to a stale beta range.

Source anchors:

- `scripts/publish.ts`
- `scripts/__tests__/check-changeset-gate.test.ts` as a style reference for script tests, if a new test file is needed.
- `docs/adr/0047-stable-release-line-discipline.md`
- `docs/releases/stable-cutover.md`

Actions:

- Parse the extracted packed `package/package.json`, not just source manifests.
- Compare packed first-party dependency ranges against live workspace versions when the source manifest used a `workspace:` range.
- For `workspace:^`, expect `^${workspace.version}`.
- Preserve existing `workspace:` / `catalog:` leakage checks.
- Add a focused test or fixture proving stale packed first-party deps fail even when no raw `workspace:` or `catalog:` string remains.

Verification:

- Focused script tests for the publish helper or new fixture.
- `bun run publish:check -- --only @ontrails/trails`
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `git diff --check`

Done when:

- A stale packed dependency error is actionable and names package, dependency, actual range, expected range, and source package path.

### Phase 2: TRL-819 trail-object compose inference

Intent:

- Fix the happy path so trail objects carry enough type information for
  `ctx.compose(trailObject, input)` without `composeInput`.

Source anchors:

- `packages/core/src/types.ts`
- `packages/core/src/type-utils.ts`
- `packages/core/src/trail.ts`
- `packages/core/src/type-checks.test-d.ts`
- `packages/testing/src/__tests__/contracts.test.ts`

Known suspicion:

- `ComposeInput<T>` currently checks `NonNullable<T['composeInput']>`; for a plain `Trail<I, O>` this can collapse through the `never` default and make object-compose input unusable. Verify this before editing.

Actions:

- Add a failing compile-time assertion for a plain trail object with `input` and `output` but no `composeInput`.
- Fix the type utility or overload so `ComposeInput<T>` falls back to `TrailInput<T>` when the trail's compose-input generic is `never` or absent.
- Preserve typed behavior for trails that do declare `composeInput`.
- Preserve string-id compose and batch compose behavior.
- Add no runtime behavior unless tests prove a runtime bug.

Verification:

- `bun run --cwd packages/core typecheck`
- Focused core/testing tests if touched.
- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `git diff --check`

Done when:

- Type assertions prove object-compose input/output inference for both plain trails and compose-input trails.

### Phase 3: TRL-825 literal Regrade tracer

Intent:

- Prove or disprove that Regrade transforms can be ordinary literal `trail()` instances.

Source anchors:

- `packages/wayfinder/` as a package-shell shape reference.
- `packages/core/src/trail.ts` for trail visibility and composition behavior.
- `packages/testing/src/examples.ts` for example execution with composed trails.
- `packages/topographer/src/derive.ts` and related tests for topo projection evidence.
- `apps/trails/package.json` only if the tracer needs local app consumption.

Actions:

- Create experimental `packages/regrade` with a minimal package shape.
- Keep it private or otherwise non-public until the boundary hardens.
- Define the minimal tracer record/output types needed to answer the topology question; do not build the whole Regrade domain.
- Implement one tiny parent regrade as a literal `trail()`.
- Implement one child structural transform as a literal `trail()`.
- Parent composes child by object.
- Use code-string fixtures in trail examples to prove example execution can model transform behavior.
- Add tests that inspect whether transform trails leak into app topo, user-facing surfaces, or require awkward visibility markers.
- If literal trails are polluted, document why a trail-shaped transform interface is needed and stop before building around the wrong shape.

Verification:

- `bun run --cwd packages/regrade typecheck`
- `bun test packages/regrade`
- Relevant topo/testing focused tests.
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run format:check`
- `git diff --check`
- `bun run check`

Done when:

- `TRL-825` has an evidence-backed answer: literal transform trails are clean
  enough to ratify later, or they fail with precise boundary evidence.

## Source-Control Plan

- Branching model: Graphite.
- Work from `/Users/mg/Developer/outfitter/trails`, not this Codex planning
  worktree.
- Use exact Linear branch names listed above.
- Commit this packet on the lowest execution branch, `TRL-823`.
- Main agent owns all `git` and `gt` writes.
- Subagents may edit files, run checks, and write reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation commands.
- For review fixes, check out the affected branch directly, verify it with `git branch --show-current`, apply the fix there, run focused checks, `gt modify`, then restack/walk upward through affected descendants.
- Do not use `gt absorb`.
- Keep PRs draft until CI and local review are clean or P3-only.
- After local review is P3-only or clean, Matt has authorized marking PRs ready for review.
- Do not merge unless Matt explicitly asks after the review loop.

## Subagent Strategy

- Use subagents everywhere a task can be bounded by concrete files, predicates, and verification commands.
- Do not use fast mode for any subagent.
- For well-defined execution/coding tasks, use GPT 5.4 subagents with high reasoning.
- Use Spark-style subagents for tightly scoped implementation, fixture, search, and review tasks where available.
- Keep branch shape, tracker state, Graphite writes, doctrine/API decisions, and scope decisions in the main agent loop.
- Give every subagent anchored briefs: issue ID, branch/scope, exact files or commands, allowed write targets, expected tests, and the rule that "unable to verify" is better than invented claims.

Suggested lanes:

- TRL-823: publish-script test/fixture scout.
- TRL-819: type-level inference scout.
- TRL-825: package-shape/tracer scaffold scout.
- Local review: type/API review, release-safety review, Regrade doctrine/tracer review, and test adequacy review.

## Tracker Plan

- Move each issue to In Progress only when its branch begins.
- Add PR links/comments when each draft PR opens.
- Leave `TRL-826` blocked by `TRL-823` and `TRL-827`.
- Leave `TRL-827`, `TRL-828`, `TRL-829`, `TRL-830`, and `TRL-836` untouched unless follow-up comments are needed to explain discoveries.
- File focused follow-up Linear issues for real out-of-goal discoveries, such as package-mode tarball gaps, Warden fix metadata requirements, or tracer pollution that needs a separate design fix.
- Do not mark issues Done until merged.

## Local Review

Before marking PRs ready for review:

- Run at least three local review passes across the stack unless the latest pass is clean earlier and Matt explicitly accepts the risk.
- Stop local review only when the latest pass has no P0/P1/P2 findings.
- P3 findings may remain if recorded in `RETRO.md` with fix/defer rationale.

Reviewer output contract:

```markdown
Overall score: n/5

Summary:
<one short prose judgment>

Findings:
- P0/P1/P2/P3 - <file:line> - <finding>
  Prompt To Fix With AI:
  <concise fix prompt>

No-findings statement:
<what was inspected and residual risk>
```

Review lanes:

- Type/API review: `ctx.compose`, `ComposeInput`, public type compatibility.
- Release/package review: packed manifest coherence, publish script behavior, failure messages.
- Regrade doctrine review: literal trail tracer, topo/surface pollution,
  vocabulary, no new primitive.
- Test adequacy review: compile-time tests, package tests, fixture coverage,
  false positives.

## Remote Review

After local review and CI are clean or P3-only:

- Mark PRs ready for review.
- Run at most three rounds of remote review-bot feedback.
- In each round, fetch CI state, review summaries, unresolved threads, scores,
  and any "Prompt To Fix With AI" / "Prompt for AI" text.
- Fix P0/P1/P2 findings on the branch they affect, then restack and validate
  upward. Do not use `gt absorb`.
- P3 findings may be fixed if cheap or recorded as deferred.
- Treat review-bot errors as incomplete until rerun or explicitly explained.
- If P2+ debt remains after three rounds, stop and hand off with exact review state, not a ready-to-merge claim.

## Validation Ladder

Run checks from narrow to broad:

- TRL-823 targeted:
  - focused script tests
  - `bun run publish:check -- --only @ontrails/trails`
- TRL-819 targeted:
  - `bun run --cwd packages/core typecheck`
  - focused core/testing tests if touched
- TRL-825 targeted:
  - `bun run --cwd packages/regrade typecheck`
  - `bun test packages/regrade`
  - focused topo/testing tests for tracer evidence
- Stack/repo:
  - `bun run typecheck`
  - `bun run test`
  - `bun run lint`
  - `bun run lint:ast-grep`
  - `bun run format:check`
  - `git diff --check`
  - `bun run check`

If Warden guide content or generated agent skill content changes, also run:

- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`

## Progress Reporting

After each execution turn, report:

- Current checkpoint
- Branch and issue
- What changed
- What was verified
- Command/output summary
- What remains
- Blocker status
- Next checkpoint

## Stop / Pause Rules

Stop and ask if:

- The plan appears stale against `main`, Linear, Graphite, or open PR state.
- Dirty local state cannot be isolated safely.
- `TRL-823` requires a broader release/publish redesign than packed-manifest validation.
- `TRL-819` requires a public type/API redesign beyond deriving from authored trail contracts.
- `TRL-825` proves literal transform trails pollute topo/surfaces/runtime enough that the architecture choice changes.
- Creating `packages/regrade` requires deciding public publication, bundling, or package-source UX beyond the tracer.
- Verification fails for unrelated reasons after focused retry.
- More than three post-ready remote review rounds have run and P2+ feedback remains unresolved.
- Secrets, credentials, production systems, publishing, merge queue, or merge actions are needed.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current as of 2026-05-27.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are summarized or avoided.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
