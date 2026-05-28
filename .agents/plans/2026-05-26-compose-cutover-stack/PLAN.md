---
created: "2026-05-26T12:59:04-04:00"
updated: "2026-05-26T12:59:04-04:00"
description: Detailed execution plan for the six-stage cross->compose cutover stack. Covers objective, completion conditions, non-goals, source-of-truth reading order, a ruling to fold TRL-783 into S1, per-stage scope/acceptance for TRL-809 through TRL-814, source-control plan, tracker plan, local/remote review plans, validation ladder, and stop/pause rules.
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
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0049-composition-is-compose-not-cross.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
  - packages/core/src/types.ts
  - packages/core/src/trail.ts
  - packages/core/src/execute.ts
---

# Goal Plan: Compose Cutover Stack

- **Date:** 2026-05-26
- **Status:** Planned

## Objective

Execute the staged `cross` -> `compose` cutover from the main Trails checkout, folding the `TRL-783` type fix into the first core API branch so the new `ctx.compose` authoring path is correct on arrival.

## Completion Condition

The goal is complete only when:

- The stack for `TRL-809` through `TRL-814` is either submitted as draft PRs or explicitly stopped with evidence at the first blocked stage.
- `TRL-809` includes the `TRL-783` type fix: declared composition gives the blaze a non-optional compose function, and typed trail-object composition returns the real `TrailOutput<T>` rather than `never`.
- Each submitted PR has current Linear comments, local review results, verification results, CI state, and review-bot state recorded in `RETRO.md`.
- Ready-for-review happens only after CI is green, Greptile summary is 5/5, there is no Greptile "Prompt for AI" / prompt-to-fix content, and P0/P1/P2 review findings are fixed or explicitly blocked.
- No merge, package publish, registry mutation, merge queue label, or subagent source-control write occurs without explicit Matt approval.
- `RETRO.md` is finalized as the durable execution ledger before any final handoff.

## Non-Goals

- Do not merge PRs.
- Do not publish packages or mutate registry state.
- Do not build Hike, Fieldwork, Trailblazing, or website/deck work inside this stack.
- Do not broaden the cutover beyond ADR-0049, `TRL-784`, and child issues without a new Linear comment or follow-up issue.
- Do not touch unrelated dirty/untracked files in the main checkout; current known unrelated file: `scripts/import-scratch-to-notion.ts`.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `docs/adr/0049-composition-is-compose-not-cross.md`
4. `docs/adr/0000-core-premise.md`
5. `docs/tenets.md`
6. `docs/adr/0001-naming-conventions.md`
7. `docs/lexicon.md`
8. `docs/architecture.md`
9. Linear `TRL-784`, `TRL-783`, `TRL-809`, `TRL-810`, `TRL-811`, `TRL-812`, `TRL-813`, `TRL-814`
10. `packages/core/src/types.ts`, `packages/core/src/trail.ts`, `packages/core/src/execute.ts`

## Ruling Carried Into Execution

Fold `TRL-783` into `TRL-809`.

Rationale:

- ADR-0049 explicitly allows either landing `TRL-783` on `cross` first or folding it into the cutover.
- The Warden-as-Coach blockers `TRL-785`, `TRL-786`, and `TRL-791` are Done, so the remaining gate is the type seam.
- The new public primitive should not inherit the old unhappy path. Shipping `ctx.compose` while it remains optional in declared composite blazes, or while typed trail-object output narrows to `never`, would preserve the bug under the new name.

Tracker treatment:

- `TRL-809` is the execution branch and PR for S1.
- `TRL-783` remains provenance for the Radio-discovered type bug and should be closed by the same PR if the type fix lands there.

## Stack Order

### 1. TRL-809: S1 core API + type rename, with TRL-783 folded in

Branch: `trl-809-crosscompose-cutover-s1-core-api-type-rename`

Intent:

- Establish the core compose contract and fix the authoring type seam at the same time.

Scope:

- Rename core authoring/runtime surface: `crosses:` -> `composes:`, `ctx.cross()` -> `ctx.compose()`.
- Rename type family: `CrossFn` -> `ComposeFn`, `CrossOptions` -> `ComposeOptions`, `CrossBatch*` -> `ComposeBatch*`, `CrossInput<T>` -> `ComposeInput<T>`, `crossInput` -> `composeInput`.
- Rename core files where appropriate, including `cross-batch.ts` and `cross-schema.ts`.
- Fix `TRL-783`: the blaze context should expose non-optional composition when composition is declared, and typed trail-object composition should propagate `TrailOutput<T>`.
- Flip S1 non-mechanical matchers in lockstep where ADR-0049 assigns them to core: `ForkCtxResetKey`, draft labels, and runtime guards in `execute.ts`.
- Remove only first-party defensive guards/casts made obsolete by the type fix when they are in touched compile paths.

Acceptance:

- Focused type tests prove both `TRL-783` repros.
- S1 branch is locally green or stops with evidence explaining which later stage must collapse into S1 to keep the stack buildable.

### 2. TRL-810: S2 persistence migration

Branch: `trl-810-crosscompose-cutover-s2-persistence-migration-topo_crossings`

Intent:

- Remove persisted `cross` vocabulary from topo store and lockfile state.

Scope:

- Rename SQLite `topo_crossings` table and index to the compose family.
- Bump `TOPO_SCHEMA_VERSION` and add table/index rename migration helper.
- Rename `TopoGraphEntry.crosses` -> `composes`; bump topo graph schema version and regenerate committed `.trails/topo.lock`.
- Flip `versioning.ts` literal and related diff/read paths in lockstep.

Acceptance:

- Existing `.trails` DB migration path is tested.
- Regenerated lockfiles carry `composes`.
- Topographer tests pass.

### 3. TRL-811: S3 Warden rules + recognition matchers

Branch: `trl-811-crosscompose-cutover-s3-warden-rules-recognition-matchers`

Intent:

- Keep Warden recognition and coaching aligned with the new canonical compose shape.

Scope:

- Rename `cross-declarations` -> `composes-declarations`; `version-pinned-cross` -> `version-pinned-compose`; `no-destructured-cross` -> compose wording/rule shape.
- Keep `no-direct-implementation-call` named as-is; update diagnostics to `ctx.compose`.
- Flip string-literal recognition matchers, AST helpers, metadata, trail fixtures, tests, and generated guide blocks.
- Regenerate Warden guide and AGENTS generated Warden Rule Guide block.

Acceptance:

- Renamed rules fire on `composes` / `ctx.compose`.
- Warden package tests and generated guide checks pass.

### 4. TRL-812: S4 docs, lexicon, tenets, migration guide

Branch: `trl-812-crosscompose-cutover-s4-docs-lexicon-tenets-migration-guide`

Intent:

- Make active-facing doctrine and docs match the code.

Scope:

- Update active-facing docs listed in `TRL-812`, including tenets, lexicon, getting-started, architecture, why-trails, language styleguide, AGENTS.md, and the `trails` skill.
- Add `cross` / `crosses` to retired-terms treatment.
- Write `docs/migration/cross-to-compose.md`.
- Apply ADR-0001 in-place cutover precedent: update ADR-0024, ADR-0028, ADR-0003, incidental active ADR mentions, and add Cutover 4 to ADR-0001. Do not supersede ADRs for this cutover.

Acceptance:

- Active-facing docs teach compose vocabulary.
- Historical/changelog mentions are left alone unless they describe current contract or are explicitly in scope.
- ADR map/check pass.

### 5. TRL-813: S5 scaffold templates

Branch: `trl-813-crosscompose-cutover-s5-scaffold-templates`

Intent:

- Fresh projects emit the new vocabulary and no longer teach stale composition shapes.

Scope:

- Update `create-scaffold.ts`, `create.ts`, and `add.*` scaffold paths as needed.
- Drop defensive missing-`ctx.cross`/destructured-cross residue now represented by S1 types and S3 Warden guidance.
- Update scaffold tests.

Acceptance:

- Fresh entity starter uses `composes:` / `ctx.compose`.
- Scaffold smoke tests prove generated scripts still work.

### 6. TRL-814: S6 codemod + Radio migration

Branch: `trl-814-crosscompose-cutover-s6-codemod-radio-migration`

Intent:

- Give downstream consumers a real migration path and exercise it against Radio.

Scope:

- Extend `scripts/vocab-cutover-rewrite.ts` with `cross` -> `compose` rewrite rules.
- Validate the codemod against Trails fixtures.
- Before mutating Radio, verify `/Users/mg/Developer/outfitter/radio` exists, is the expected repo, and has a safe worktree state. If not safe, stop and record exact status.
- If safe, run the migration against Radio, regenerate lockfiles, run Radio checks, and record results. If Radio requires separate source-control handling, stop before committing there unless Matt has approved that lane.

Acceptance:

- Codemod covers the rename surface.
- Radio migration is either green with evidence or blocked with a precise external-repo reason and follow-up.

## Source-Control Plan

- Work from `/Users/mg/Developer/outfitter/trails`, not the detached Codex worktree.
- Start by syncing `main` with Graphite and confirming branch state.
- Use Graphite branch creation with the Linear-recommended branch names above.
- Prefer one branch per issue in the listed order.
- If a lower branch breaks an upper branch, fix on the owning branch, then restack and run checks upward.
- Do not use `gt absorb` as the normal review-fix workflow.
- Main agent owns all `git` and `gt` writes. Subagents must not run source-control write commands.

## Tracker Plan

- Add planning comments to `TRL-783` and `TRL-809` noting that `TRL-783` is folded into `TRL-809`.
- Keep `TRL-784` as parent/cutover record; children remain staged.
- Move issues only when execution actually begins.
- Comment every PR submission, ready-for-review transition, material scope divergence, skipped check, and final state.
- File follow-up Linear issues for out-of-goal discoveries rather than stuffing them into the stack.

## Local Review Plan

Run local review before each PR leaves draft. Use subagents for bounded review lanes, with concrete artifacts and no source-control writes.

Suggested lanes:

- S1: type contract, public API compatibility, first-party guard/cast cleanup.
- S2: migration correctness, lockfile format, schema-version behavior.
- S3: Warden rule recognition, diagnostic language, generated guide coverage.
- S4: doctrine/vocabulary precision, ADR in-place cutover, active-vs-historical docs split.
- S5/S6: scaffold output, codemod coverage, Radio migration safety.

For each lane, request 1-5 scores and P0/P1/P2/P3 findings. Fix P0/P1/P2 or record a hard blocker before ready-for-review.

## Remote Review Plan

- Keep PRs draft until local checks and CI are green.
- Before ready-for-review, verify Greptile summary is 5/5 and there is no Greptile prompt-to-fix / "Prompt for AI" content.
- Treat Greptile errors as blockers.
- Resolve or answer all P0/P1/P2 review comments with a brief audit note.
- Record remote review summaries, scores, prompts, and fixes in `RETRO.md`.

## Validation Ladder

Run narrow to broad:

- Focused tests for touched package/files.
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run lint:ast-grep`
- `bun run format:check`
- `git diff --check`
- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- Generated guide checks when Warden/skills/AGENTS change:
  - `bun run warden:agents:sync`
  - `bun run warden:skills:sync`
  - `bun run warden:agents:check`
  - `bun run warden:skills:check`
- `bun run check`
- GitHub CI on submitted PRs.

## Stop / Pause Rules

Stop and ask Matt before continuing if:

- The staged branch boundaries cannot be kept locally green without collapsing major stages.
- The cutover appears to require a backwards-compat alias or deprecation window not described by ADR-0049.
- A public API, serialized artifact layout, or doctrinal decision needs to change beyond ADR-0049.
- `TRL-783` cannot be solved inside S1 without broad type-system redesign.
- Radio is dirty, missing, not the expected repo, or requires source-control mutation beyond the Trails stack.
- Verification fails for unrelated reasons after a focused retry.
- Required credentials, secrets, production systems, or irreversible actions are needed.
