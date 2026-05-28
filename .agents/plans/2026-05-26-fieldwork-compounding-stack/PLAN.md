---
created: "2026-05-26T22:32:21Z"
updated: "2026-05-26T22:32:21Z"
description: Detailed execution plan for five Trails framework fixes before Radio migration. Covers per-issue scope and acceptance for TRL-782, TRL-804, TRL-781, TRL-789, and TRL-816 (resource config inference, Warden top-level surface rule, scaffold rerun, entity starter CRUD, compose straggler cleanup), plus TRL-814 Radio proof lane criteria, source-control plan, subagent strategy, and validation ladder.
linear:
  - TRL-782
  - TRL-784
  - TRL-787
  - TRL-802
  - TRL-804
  - TRL-781
  - TRL-789
  - TRL-816
  - TRL-814
impl_status: partial
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
---

# Goal Plan: Fieldwork Compounding Stack

- **Date:** 2026-05-26
- **Status:** Planned

## Objective

Land a meaningful Trails framework stack that makes the next Radio migration cleaner and improves the repeatable fieldwork loop for future projects.

This is not a single cleanup PR. It is a small stack of compounding framework fixes:

1. infer resource config types at the authoring boundary;
2. add Warden coaching for top-level surface side effects in app entry modules;
3. make `trails create` reruns reconcile instead of half-mutating projects;
4. make the entity starter satisfy the framework's own CRUD expectations;
5. clean up current-facing compose vocabulary stragglers;
6. use Radio as the downstream proof lane once the Trails-side stack is ready.

## Completion Condition

The goal is complete only when:

- Trails-side stack branches for `TRL-782`, `TRL-804`, `TRL-781`, `TRL-789`, and `TRL-816` are submitted as draft PRs or the executor stops at the first blocked branch with evidence.
- Each submitted PR has focused implementation, a branch-local changeset if publishable package content changed, current Linear comments, local review results, verification results, CI state, and review-bot state recorded in `RETRO.md`.
- `TRL-814` Radio migration is either started only after a safe prerequisite decision, or explicitly left as the next proof lane with exact blocker/ready criteria.
- Ready-for-review happens only after CI is green, local review is clean or P3-only, Greptile summary is 5/5, and there is no Greptile "Prompt for AI" / prompt-to-fix content.
- No merge, package publish, registry mutation, merge queue label, or subagent source-control write occurs without explicit Matt approval.
- `RETRO.md` is finalized as the durable execution ledger before any final handoff.

## Non-Goals

- Do not merge PRs.
- Do not publish packages or mutate the registry.
- Do not add merge queue labels.
- Do not implement Hike/Fieldwork tooling, website/deck work, or Forge/Hike vocabulary work inside this stack.
- Do not mutate Radio source control unless Matt explicitly clears the downstream lane.
- Do not touch unrelated dirty local state in the main checkout. Current known unrelated state: `scripts/import-scratch-to-notion.ts` is deleted locally on `main`; resolve or isolate it before creating stack branches.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `docs/adr/0000-core-premise.md`
4. `docs/tenets.md`
5. `docs/adr/0001-naming-conventions.md`
6. `docs/lexicon.md`
7. `docs/architecture.md`
8. Linear `TRL-782`, `TRL-804`, `TRL-781`, `TRL-789`, `TRL-816`, `TRL-814`
9. This packet's `REFS.md`

## Ruling Carried Into Execution

This stack prioritizes framework fixes that help Radio and future fieldwork loops before publishing or migrating Radio.

Basis:

- ADR-0000 and the tenets: author what's new, derive what's known, override what's wrong.
- `TRL-782` is a direct Radio-originated type-safety issue. The resource config schema already exists; the framework should derive the `ctx.config` type instead of forcing an annotation or cast.
- `TRL-804` moves a real side-effect hazard into Warden coaching. Import-time surface opening during `survey`, `guide`, or compile breaks the "entry is the manifest" workflow.
- `TRL-781` and `TRL-789` improve the factory/scaffold fieldwork loop. New and rerun scaffold attempts should converge toward a quiet Warden path instead of generating half-baked or self-warning projects.
- `TRL-816` keeps the active vocabulary coherent after ADR-0049. Radio should migrate onto docs and agent guidance that teach the final `compose` shape, not stale `cross` residue.

## Stack Order

### 1. TRL-782: Resource config type inference

Branch: `trl-782-resourcet-doesnt-flow-config-schemas-inferred-type-into`

Intent:

- Make a resource's `config` Zod schema flow into the `create` callback's `ctx.config` type without manual `ResourceContext<...>` annotation.

Scope:

- Preserve existing runtime behavior.
- Update `resource()` and `Resource` typing so `ResourceSpec<T, C>` does not erase `C` at the definition boundary.
- Add compile-time assertions in `packages/core/src/type-checks.test-d.ts`.
- Add or tighten runtime tests only where they protect the type story from runtime regression.

Acceptance:

- A resource declared with `config: z.object(...)` gives `create(ctx)` a typed `ctx.config`.
- A resource without config keeps `ctx.config` as `unknown` or equivalent safe default.
- Existing resource users compile without broad annotation churn.

### 2. TRL-804: Warden warning for top-level surface opening

Branch: `trl-804-warden-warn-topo-export-entry-should-not-open-a-surface-at`

Intent:

- Coach app authors away from opening `surface()` at module top level in a topo-export entry that CLI introspection imports.

Scope:

- Add a Warden warning rule that detects a module-level `surface(...)` call in a likely app/topo entry context.
- Avoid false positives for imported surface helpers that are only used under an explicit runtime guard, function, or CLI entrypoint.
- Add diagnostics that explain why `survey`, `guide`, `compile`, and lock generation import the entry module.
- Add tests and generated Warden guide updates.

Acceptance:

- The rule catches a top-level `await surface(graph)` or direct top-level surface open in an entry module.
- The rule stays quiet for normal exported `graph = topo(...)` modules and guarded/manual runtime entrypoints.
- `bun run warden:agents:sync`, `bun run warden:skills:sync`, and matching check commands pass when generated guidance changes.

### 3. TRL-781: `trails create` rerun reconciliation

Branch: `trl-781-trails-create-errors-hard-on-re-run-instead-of-reconciling`

Intent:

- Make rerunning `trails create` on an existing or partially scaffolded directory deterministic and non-destructive.

Scope:

- Audit current write order and failure behavior around `apps/trails/src/trails/create.ts`, `create-scaffold.ts`, and project write helpers.
- Avoid overwriting unrelated user files before detecting blocking existing surface entries.
- Prefer a structured plan/apply result over ad hoc writes where the existing code shape supports it.
- Preserve existing first-run behavior and tests.

Acceptance:

- Rerun against partial scaffold state either reconciles safely or fails before writing unrelated files.
- Tests cover the Radio-discovered half-baked state.
- Existing scaffold scripts and verification behavior are preserved.

### 4. TRL-789: Entity starter complete CRUD

Branch: `trl-789-trails-create-starter-entity-complete-the-crud-entitylist`

Intent:

- Fresh entity starter projects should not trip Trails' own `incomplete-crud` Warden warning.

Scope:

- Extend generated entity starter trails with `entity.list` and `entity.delete` or the minimal canonical CRUD coverage the Warden rule expects.
- Keep generated code small and teach the happy path: schema, `Result`, examples, output schemas, resources, and direct `ctx.compose()` if composition is used.
- Update scaffold tests and smoke checks.

Acceptance:

- `trails create --starter entity` generates a project whose Warden run does not warn for incomplete CRUD.
- Generated tests/examples still pass.
- The starter remains beginner-readable.

### 5. TRL-816: Post-compose current-facing cleanup

Branch: `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers`

Intent:

- Clean current-facing `cross` vocabulary residue after PR #596 without rewriting frozen history.

Scope:

- Fix active docs/API reference/accepted ADR examples/agent guidance that still teach `cross` as current vocabulary.
- Rename low-risk local identifiers that already operate on compose concepts.
- Update `.agents/memory/decisions.md` with a dated annotation if needed instead of rewriting old decisions.
- Check whether `TRL-787` and `TRL-802` are now duplicate/superseded; comment or update them rather than leaving stale backlog ambiguity.

Acceptance:

- Active guidance teaches `compose`, `composes`, and `ctx.compose()`.
- Historical/migration from-state mentions are left intact when clearly legacy.
- Local review confirms no P0/P1/P2 current-facing vocabulary stragglers in the touched scope.

### 6. TRL-814: Radio migration proof lane

Branch: `trl-814-crosscompose-cutover-s6-radio-migration-follow-up`

Intent:

- Prove the framework stack against Radio once the Trails-side work is ready.

Scope:

- Verify `/Users/mg/Developer/outfitter/radio` exists, is the expected repo, and has a safe worktree state.
- Decide whether Radio should consume a published beta, local package override, or wait for merge/publish. Stop for Matt if unclear.
- Run the compose migration and remove workarounds made unnecessary by `TRL-782` and PR #596 where safe.
- Regenerate Radio `.trails` artifacts and run Radio checks.

Acceptance:

- Radio is green on the final framework vocabulary and type behavior, or the blocker is precise and tracked.
- No Radio source-control write occurs without explicit lane approval.

## Source-Control Plan

- Work from `/Users/mg/Developer/outfitter/trails`, not a detached Codex worktree.
- Before branch creation, handle the existing local deletion of `scripts/import-scratch-to-notion.ts` intentionally: commit it in its own approved branch, stash it, or have Matt confirm it belongs in the lowest stack branch.
- Use Graphite and exact Linear branch names.
- Prefer one branch per issue in the listed order.
- Fix downstack review findings on the owning branch, then restack and validate upward.
- Do not use `gt absorb` as the normal review-fix workflow.
- Main agent owns all `git` and `gt` writes. Subagents may edit files, run tests, and write reports, but must not run source-control write commands.

## Subagent Strategy

- Use subagents everywhere a task can be bounded by concrete files, predicates, and verification commands.
- Do not use fast mode for any subagent.
- For well-defined execution/coding tasks, use GPT 5.4 subagents with high reasoning.
- Use Spark-style subagents for tightly scoped implementation, test, fixture, search, audit, and review tasks where the expected output can be stated precisely.
- Keep ambiguous doctrine, branch-shape, tracker, source-control, and public API decisions in the main agent loop.
- Give every subagent anchored briefs: issue ID, branch/scope, exact files or commands, allowed write targets, expected tests, and the rule that "unable to verify" is better than invented claims.
- Run multiple subagents in parallel when branches or review lanes are independent; the main agent synthesizes findings, applies source-control writes, and updates `RETRO.md`.

## Tracker Plan

- Move issues to In Progress only when work starts on their branch.
- Comment on each issue when a PR is opened, when local review finishes, when ready-for-review is attempted, and when remote review is resolved.
- Comment/update `TRL-787` and `TRL-802` during `TRL-816` if they are superseded by PR #596 and `TRL-816`.
- Keep `TRL-814` Backlog until the Radio lane is explicitly safe to mutate.
- File follow-up issues for discoveries outside the stack rather than expanding scope silently.

## Local Review Plan

Use bounded subagents for local review after implementation and before ready-for-review. Prefer Spark reviewers when the review lane is concrete. Reviews must include scores and P0/P1/P2/P3 findings.

Suggested lanes:

- `TRL-782`: type inference seam, backwards-compatible resource authoring, runtime unchanged.
- `TRL-804`: Warden rule precision, false positives, diagnostic coaching.
- `TRL-781`/`TRL-789`: scaffold/rerun behavior, generated-project ergonomics, smoke adequacy.
- `TRL-816`: vocabulary/doctrine precision, active-vs-historical split, generated skill/guide drift.
- Whole stack: changesets, Linear hygiene, branch ownership, review gates.

Fix P0/P1/P2 or record a hard blocker before ready-for-review.

## Remote Review Plan

- Keep PRs draft until local review and CI are green.
- Before ready-for-review, verify Greptile summary is 5/5 and there is no prompt-to-fix / "Prompt for AI".
- Treat Greptile errors as blockers.
- Resolve review comments with concise replies and record meaningful changes in `RETRO.md`.

## Validation Ladder

Run focused tests per branch, then broaden up-stack:

- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run lint:ast-grep`
- `bun run format:check`
- `git diff --check`
- `bun run check`

Additional branch-specific checks:

- `TRL-804`: focused Warden tests, `bun run warden:agents:sync`, `bun run warden:skills:sync`, `bun run warden:agents:check`, `bun run warden:skills:check`.
- `TRL-816`: `bun scripts/adr.ts map`, `bun scripts/adr.ts check`, `bun run vocab:audit`, skillset/guidance sync checks if generated agent skills change.
- Scaffold branches: focused `apps/trails/src/__tests__/create.test.ts`, generated project smoke checks where practical.

Record skipped checks in `RETRO.md`.

## Stop Rules

Stop and ask Matt if:

- The dirty `scripts/import-scratch-to-notion.ts` deletion cannot be isolated safely.
- A branch boundary cannot stay buildable without collapsing the stack.
- `TRL-782` requires a public type redesign beyond preserving resource API shape.
- `TRL-804` cannot avoid broad false positives.
- `TRL-781` requires a destructive migration or large scaffold rewrite beyond the issue's intent.
- Radio requires source-control mutation, package publication, registry access, or local package-linking decisions not already approved.
- CI, Greptile, or code-review bots report P2+ findings that would require scope expansion.
