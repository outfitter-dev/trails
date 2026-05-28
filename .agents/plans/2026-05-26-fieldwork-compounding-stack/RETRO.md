---
created: "2026-05-26T22:32:21Z"
updated: "2026-05-26T22:32:22Z"
description: Durable execution ledger for the fieldwork compounding stack. Five draft PRs #597–#601 submitted with CI passing. Each branch (TRL-782, TRL-804, TRL-781, TRL-789, TRL-816) has implementation details and local review findings. TRL-814 Radio lane stopped; PRs held pending Greptile. Contains tracker mutations, execution log, verification log, review log, remote CI log, and forbidden-actions audit.
linear:
  - TRL-782
  - TRL-804
  - TRL-781
  - TRL-789
  - TRL-816
  - TRL-814
impl_status: partial
references:
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/PLAN.md
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/GOAL.md
---

# Execution Retro: Fieldwork Compounding Stack

- **Date started:** 2026-05-26
- **Date finalized:** 2026-05-26 16:55 EDT
- **Status:** Submitted draft stack; ready-for-review prep
- **Plan:** `.agents/plans/2026-05-26-fieldwork-compounding-stack/PLAN.md`
- **Goal:** `.agents/plans/2026-05-26-fieldwork-compounding-stack/GOAL.md`

Use this as the durable execution ledger. Update it before any final handoff, draft submission, ready-for-review transition, remote review closeout, merge readiness claim, archive, or explicit stop.

## Execution Summary

- Objective: Build the Fieldwork compounding stack before Radio migration: TRL-782, TRL-804, TRL-781, TRL-789, TRL-816, then stop at TRL-814 as the Radio proof lane.
- Final outcome: Trails-side stack submitted as draft PRs. PRs remain draft because Greptile has not produced a 5/5 summary yet.
- Final branch / stack tip: `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers`
- Final PR range: #597 -> #601
- Final tracker state: TRL-782, TRL-804, TRL-781, TRL-789, and TRL-816 are In Review with PR links. TRL-814 remains Backlog with a prerequisite-state comment and no Radio source-control mutation.
- Final verification state: Local focused checks passed per branch; stack-tip `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, and `bun run check` passed. GitHub CI passed for #597-#601, including the final #601 run after the RETRO ledger update.
- Remaining risks / P3s: Review bots have not reviewed the draft PRs yet. Greptile 5/5 / no prompt-to-fix is not verified, so ready-for-review is intentionally blocked. Generated `dist/crosses.*` residue was classified as generated/uncertain and left untouched.
- Archive state: Not archive-ready until review-bot state is known and any required review findings are resolved.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | TRL-782 | `trl-782-resourcet-doesnt-flow-config-schemas-inferred-type-into` | [#597](https://github.com/outfitter-dev/trails/pull/597) | Draft submitted; CI passed | Resource config type inference. |
| 2 | TRL-804 | `trl-804-warden-warn-topo-export-entry-should-not-open-a-surface-at` | [#598](https://github.com/outfitter-dev/trails/pull/598) | Draft submitted; CI passed | Warden top-level surface warning. |
| 3 | TRL-781 | `trl-781-trails-create-errors-hard-on-re-run-instead-of-reconciling` | [#599](https://github.com/outfitter-dev/trails/pull/599) | Draft submitted; CI passed | Scaffold rerun reconciliation. |
| 4 | TRL-789 | `trl-789-trails-create-starter-entity-complete-the-crud-entitylist` | [#600](https://github.com/outfitter-dev/trails/pull/600) | Draft submitted; CI passed | Entity starter CRUD completion. |
| 5 | TRL-816 | `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers` | [#601](https://github.com/outfitter-dev/trails/pull/601) | Draft submitted; CI passed after final ledger update | Current-facing compose straggler cleanup. |
| 6 | TRL-814 | `trl-814-crosscompose-cutover-s6-radio-migration-follow-up` | | Proof lane stopped | Radio migration; no branch, no Radio source-control mutation. |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| Main is clean of open PRs but not clean locally. | `gh pr list` returned none; `git status` showed `D scripts/import-scratch-to-notion.ts`. | Executor must isolate dirty deletion before creating stack branches. | Prevents accidental unrelated deletion in stack. |
| Compose aftercare needed its own issue. | Clark audit found current-facing stragglers after PR #596. | Created `TRL-816` under `TRL-784`. | Stack gets a focused cleanup branch. |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-26 13:31 EDT | TRL-816 | Created issue under TRL-784 for post-compose current-facing cleanup. | Linear URL: <https://linear.app/outfitter/issue/TRL-816/post-compose-cutover-cleanup-fix-current-facing-stragglers-and-stale> |

## Execution Log

```text
2026-05-26 13:31 EDT - planning packet seeded
- Changed: created `.agents/plans/2026-05-26-fieldwork-compounding-stack/` with PLAN.md, GOAL.md, REFS.md, and RETRO.md.
- Tracker: created TRL-816 for post-compose cleanup.
- Verified: live repo has no open PRs and Graphite shows main only; Linear Fieldwork backlog has the target issues.
- Result: packet ready for execution; implementation not started.
- Blockers before execution: local deletion of `scripts/import-scratch-to-notion.ts` must be isolated or approved.

2026-05-26 13:40 EDT - subagent strategy tightened
- Changed: PLAN.md now explicitly directs the executor to use subagents everywhere a task can be bounded, with no fast mode for any subagent and GPT 5.4 high reasoning for well-defined execution/coding tasks.
- Changed: GOAL.md pasteable prompt now carries the same instruction so it survives even if the executor only reads the prompt.
- Guardrail: main agent still owns all `git`/`gt` writes, tracker mutation, branch-shape decisions, and public API/doctrine calls.

2026-05-26 15:05 EDT - execution preflight
- Read: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, `docs/adr/0000-core-premise.md`, `docs/tenets.md`, `docs/adr/0001-naming-conventions.md`, `docs/lexicon.md`, and `docs/architecture.md`.
- Tracker: fetched Linear TRL-782, TRL-804, TRL-781, TRL-789, TRL-816, and TRL-814. All target Trails issues were Backlog at fetch time.
- Dirty state: confirmed unrelated tracked deletion `D scripts/import-scratch-to-notion.ts`; isolated it with `git stash push -m "isolate import-scratch deletion before fieldwork stack" -- scripts/import-scratch-to-notion.ts`.
- Dirty state after isolation: only untracked active packet files under `.agents/plans/2026-05-26-fieldwork-compounding-stack/`.
- Sync: ran `gt sync` on `main`; result `ok synced`.
- Branch state: `main`, `origin/main`, and local `main` all at `1eb5bdc06142d8886f3870801b2ef71a0c5f3844`.
- Note: local Trails skill was read but found stale on pre-compose `cross` wording; repo docs and live Linear are authoritative.

2026-05-26 15:25 EDT - TRL-782 implementation
- Branch: `trl-782-resourcet-doesnt-flow-config-schemas-inferred-type-into`.
- Tracker: moved TRL-782 to In Progress.
- Changed: `packages/core/src/resource.ts` now preserves the resource config generic through `Resource<T, C>` and overloads `resource()` so a `config` Zod schema contextually types `create(ctx).config`.
- Changed: `packages/core/src/__tests__/service-config.test.ts` removed manual `ResourceContext<{...}>` annotations in configured-resource factories so runtime tests exercise inferred authoring.
- Changed: `packages/core/src/type-checks.test-d.ts` added compile-time assertions for inferred config, defaulted config, returned `Resource<T, C>`, and no-config `unknown`.
- Changed: added `.changeset/resource-config-inference.md` for `@ontrails/core` patch.
- Local review: subagent Bacon confirmed the live seam and recommended the same type-only fix plus no new runtime behavior.

2026-05-26 15:42 EDT - TRL-804 implementation
- Branch: `trl-804-warden-warn-topo-export-entry-should-not-open-a-surface-at`.
- Tracker: moved TRL-804 to In Progress.
- Changed: added Warden rule `no-top-level-surface` to warn when a topo-export module opens a surface at module top level.
- Changed: rule detection is intentionally narrow: it requires an exported `topo(...)` entry (`default`, `graph`, or `app`) and imported surface-opening APIs or a top-level `.listen(...)`; guarded/nested startup remains allowed.
- Changed: added focused rule tests for direct, aliased, namespace, and `.listen(...)` diagnostics plus dedicated-surface and guarded-startup allowances.
- Changed: wired the rule through Warden exports, metadata, registry names, trail wrappers, and contract count tests.
- Changed: regenerated Warden guide blocks in `AGENTS.md`, `.claude/skills/clark/references/warden-guide.md`, and `plugin/skills/trails/references/warden-guide.md`.
- Changed: added `.changeset/warden-top-level-surface.md` for `@ontrails/warden` patch.
- Local review: subagent Rawls recommended binding-aware detection and warned against broad false positives; implemented the narrow imported-binding rule shape.

2026-05-26 15:52 EDT - TRL-781 implementation
- Branch: `trl-781-trails-create-errors-hard-on-re-run-instead-of-reconciling`.
- Tracker: moved TRL-781 to In Progress.
- Changed: scaffold planning/application now supports preserve-existing mode; `create.scaffold` uses it so reruns only write missing scaffold files.
- Changed: `add.surface` now reconciles an existing surface entrypoint by preserving the file and still patching required package dependencies.
- Changed: `add.verify` preserves existing verification files while still patching verify dependencies.
- Changed: `create` preserves an existing README rather than overwriting it during rerun reconciliation.
- Changed: added a regression test for a Radio-like partial project with an existing CLI entry, custom package fields, existing README/app/tsconfig, and a requested MCP surface.
- Changed: added `.changeset/create-rerun-reconciliation.md` for `@ontrails/trails` patch.

2026-05-26 15:55 EDT - TRL-789 implementation
- Branch: `trl-789-trails-create-starter-entity-complete-the-crud-entitylist`.
- Tracker: moved TRL-789 to In Progress.
- Changed: entity starter now generates `entity.list` and `entity.delete` alongside existing `entity.show` and `entity.add`.
- Changed: generated `entity.list` returns the in-memory starter store contents with an explicit output schema and read intent.
- Changed: generated `entity.delete` declares destroy intent plus `permit: { scopes: ['entity:delete'] }` so the starter models permit governance instead of generating a Warden error.
- Changed: entity starter tests now assert generated CRUD trail IDs, store helper imports, list output, and delete permit declaration.
- Changed: added `.changeset/entity-starter-crud.md` for `@ontrails/trails` patch.
- Local review: subagent Laplace confirmed the current starter only had `show`/`add`, identified `entity.list`/`entity.delete` as the issue-scoped gap, and flagged permit governance for destructive trails.

2026-05-26 16:15 EDT - TRL-816 implementation
- Branch: `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers`.
- Tracker: moved TRL-816 to In Progress.
- Changed: refreshed current-facing compose vocabulary in accepted ADR prose/examples and package READMEs for core, testing, tracing, and Warden.
- Changed: renamed a stale `crossesEntry` test variable in `packages/topographer/src/__tests__/derive.test.ts` while preserving the existing `.composes` assertion.
- Changed: added `.changeset/compose-straggler-cleanup.md` for publishable package README updates.
- Local review: subagent Hume confirmed the same current-facing anchors and classified ADR-0049, the migration guide, and generated `dist/crosses.*` residue as leave/uncertain rather than branch edits.
- Explicit leave: `docs/adr/0049-composition-is-compose-not-cross.md`, `docs/migration/cross-to-compose.md`, release notes, lexicon negative examples, and generated `dist` files were not edited.

2026-05-26 16:10 EDT - draft stack submission
- Submitted draft PRs #597, #598, #599, #600, and #601 with `gt submit --draft`.
- Populated PR bodies after submit because Graphite created empty descriptions.
- Moved TRL-782, TRL-804, TRL-781, TRL-789, and TRL-816 to In Review and attached their draft PR links.
- Added a TRL-814 comment recording the Trails prerequisite state, local proof, CI/review state, and that Radio was not mutated.
- Remote review state: no review-bot reviews or comments were present yet; Greptile 5/5 is not verified, so PRs remain draft.
```

## Verification Log

| Time | Branch | Command | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-26 15:25 EDT | TRL-782 | `bun run --cwd packages/core typecheck` | Pass | Compile-time assertions include resource config inference. |
| 2026-05-26 15:25 EDT | TRL-782 | `bun test packages/core/src/__tests__/service-config.test.ts packages/core/src/__tests__/resource.test.ts` | Pass | 25 tests passed. |
| 2026-05-26 15:26 EDT | TRL-782 | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 15:26 EDT | TRL-782 | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 15:28 EDT | TRL-782 | `bun run lint` | Pass after focused fix | Initial run failed on new type-check style (`prefer-destructuring`, `no-unused-expressions`, `consistent-type-definitions`); fixed and reran clean. |
| 2026-05-26 15:29 EDT | TRL-782 | `bun run format:check` | Pass after formatting | Initial run flagged `packages/core/src/type-checks.test-d.ts`; formatted with `bunx ultracite fix packages/core/src/type-checks.test-d.ts`, then reran clean. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun test packages/warden/src/__tests__/no-top-level-surface.test.ts packages/warden/src/__tests__/trails.test.ts` | Pass after focused fixes | Initial iterations exposed AST unwrap and export-specifier bugs; final run passed 168 tests. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run --cwd packages/warden typecheck` | Pass | Warden package typecheck passed. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run warden:agents:sync` | Pass | Regenerated root Warden guide; rule count now 59. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run warden:skills:sync` | Pass | Regenerated Clark and plugin Trails skill Warden guide references. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run warden:agents:check` | Pass | Generated `AGENTS.md` Warden guide is current. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run warden:skills:check` | Pass | Generated skill Warden guides are current. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run --cwd packages/warden lint` | Pass after focused fix | Initial run failed on AST destructuring and metadata key order; fixed and reran clean. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run format:check` | Pass after formatting | Initial run flagged new Warden rule and metadata formatting; formatted with `bunx ultracite fix ...`, then reran clean. |
| 2026-05-26 15:42 EDT | TRL-804 | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 15:42 EDT | TRL-804 | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 15:52 EDT | TRL-781 | `bun test apps/trails/src/__tests__/create.test.ts apps/trails/src/__tests__/project-writes.test.ts` | Pass | 22 tests passed, including rerun reconciliation and idempotent existing surface coverage. |
| 2026-05-26 15:52 EDT | TRL-781 | `bun run --cwd apps/trails typecheck` | Pass | Trails app typecheck passed. |
| 2026-05-26 15:52 EDT | TRL-781 | `bun run --cwd apps/trails lint` | Pass | Trails app lint passed. |
| 2026-05-26 15:52 EDT | TRL-781 | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 15:52 EDT | TRL-781 | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 15:52 EDT | TRL-781 | `bun run format:check` | Pass after formatting | Initial run flagged `apps/trails/src/trails/create-scaffold.ts`; formatted with `bunx ultracite fix ...`, then reran clean. |
| 2026-05-26 15:55 EDT | TRL-789 | `bun test apps/trails/src/__tests__/create.test.ts` | Pass | 18 tests passed, including entity starter assertions. |
| 2026-05-26 15:55 EDT | TRL-789 | `bun run --cwd apps/trails typecheck` | Pass | Trails app typecheck passed. |
| 2026-05-26 15:55 EDT | TRL-789 | `bun run --cwd apps/trails lint` | Pass | Trails app lint passed. |
| 2026-05-26 15:55 EDT | TRL-789 | `bun run format:check` | Pass | Repo format check passed. |
| 2026-05-26 15:55 EDT | TRL-789 | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 15:55 EDT | TRL-789 | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 16:15 EDT | TRL-816 | `bun test packages/topographer/src/__tests__/derive.test.ts` | Pass | 36 tests passed; focused coverage for renamed local variable context. |
| 2026-05-26 16:15 EDT | TRL-816 | `bun scripts/adr.ts check` | Pass | Numbered ADRs, drafts, index, and decision map all clean. |
| 2026-05-26 16:15 EDT | TRL-816 | `bun run vocab:audit` | Pass | Repo cutover audit found no legacy patterns in the target set. |
| 2026-05-26 16:15 EDT | TRL-816 | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 16:15 EDT | TRL-816 | `bun run format:check` | Pass | Repo format check passed. |
| 2026-05-26 16:15 EDT | TRL-816 | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 16:25 EDT | stack tip | `bun run typecheck` | Pass | 22 Turbo typecheck tasks passed. |
| 2026-05-26 16:26 EDT | stack tip | `bun run test` | Pass | 37 Turbo test/build tasks passed. |
| 2026-05-26 16:27 EDT | stack tip | `bun run lint` | Pass | 23 Turbo lint/build tasks passed. |
| 2026-05-26 16:27 EDT | stack tip | `bun run lint:ast-grep` | Pass | Repo ast-grep scan passed. |
| 2026-05-26 16:27 EDT | stack tip | `bun run format:check` | Pass | Repo format check passed. |
| 2026-05-26 16:27 EDT | stack tip | `git diff --check` | Pass | No whitespace errors. |
| 2026-05-26 16:28 EDT | stack tip | `bun run check` | Failed then fixed | Initial run failed at `skillset:check` because `.agents/skills/clark/references/warden-guide.md` was stale. Ran `bun run skillset:sync`, amended the generated guide into TRL-804, returned to the stack tip, and reran. |
| 2026-05-26 16:30 EDT | stack tip | `bun run check` | Pass | Aggregate gate passed: lint, ast-grep, vocab audit, format, typecheck, docs links/snippets/API examples, taxonomy/scaffold checks, Warden guide checks, skillset check, `trails warden`, and dead-code. `trails warden` reported the repo's existing 26 warnings and 0 errors. |
| 2026-05-26 16:11 EDT | PR #597 | `gh pr checks 597 --watch=false` | Pass | Build, CI Gate, Changeset, Dead Code, Governance, Lint & Format, Test, and Typecheck all passed. |
| 2026-05-26 16:11 EDT | PR #598 | `gh pr checks 598 --watch=false` | Pass | Build, CI Gate, Changeset, Dead Code, Governance, Lint & Format, Test, and Typecheck all passed. |
| 2026-05-26 16:11 EDT | PR #599 | `gh pr checks 599 --watch=false` | Pass | Build, CI Gate, Changeset, Dead Code, Governance, Lint & Format, Test, and Typecheck all passed. |
| 2026-05-26 16:11 EDT | PR #600 | `gh pr checks 600 --watch=false` | Pass | Build, CI Gate, Changeset, Dead Code, Governance, Lint & Format, Test, and Typecheck all passed. |
| 2026-05-26 16:11 EDT | PR #601 | `gh pr checks 601 --watch=false` | Pass | Build, CI Gate, Changeset, Dead Code, Governance, Lint & Format, Test, and Typecheck all passed before final RETRO ledger update. |

## Local Review Log

| Time | Branch | Lane | Reviewer | Score | Findings | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-26 15:25 EDT | TRL-782 | Type inference seam scout | Bacon (subagent) | Clean plan | Found the generic erasure in `Resource<T>` / `resource()` and recommended compile-time tests plus no runtime change. | Implemented matching fix. |
| 2026-05-26 15:42 EDT | TRL-804 | Warden surface coaching scout | Rawls (subagent) | Scoped warning | Found the introspection import hazard and recommended imported-binding detection with guarded/dedicated-surface allowances. | Implemented narrow source-static rule and tests. |
| 2026-05-26 15:55 EDT | TRL-789 | Entity starter CRUD scout | Laplace (subagent) | Scoped gap | Confirmed generated starter has `show`/`add` plus non-CRUD `search`; issue-scoped missing trails are `entity.list` and `entity.delete`, with permit governance needed for destroy intent. | Implemented list/delete and tests. |
| 2026-05-26 16:15 EDT | TRL-816 | Compose straggler scout | Hume (subagent) | Scoped cleanup | Identified current-facing `cross` residue in ADR-0025, package READMEs, ADR-0000, and ADR-0007; classified migration/history/generated outputs separately. | Implemented current-facing cleanup only. |

## Remote Review / CI Log

| Time | PR | Source | State | Details | Outcome |
| --- | --- | --- | --- | --- | --- |
| 2026-05-26 16:10 EDT | #597 | GitHub CI | Pass | All required checks passed. | Kept draft; no review-bot state yet. |
| 2026-05-26 16:10 EDT | #598 | GitHub CI | Pass | All required checks passed. | Kept draft; no review-bot state yet. |
| 2026-05-26 16:10 EDT | #599 | GitHub CI | Pass | All required checks passed. | Kept draft; no review-bot state yet. |
| 2026-05-26 16:10 EDT | #600 | GitHub CI | Pass | All required checks passed. | Kept draft; no review-bot state yet. |
| 2026-05-26 16:15 EDT | #601 | GitHub CI | Pass after final ledger update | All required checks passed after the final RETRO-only commit. | Kept draft; no review-bot state yet. |
| 2026-05-26 16:12 EDT | #597-#601 | Review bots | Pending | `gh pr view ... --json reviews,comments` found Linear linkbacks and Graphite stack comments only; no Greptile, Codex, Claude, or Copilot reviews/comments yet. | Ready-for-review blocked until Greptile 5/5 / no prompt-to-fix can be verified. |

## Forbidden Actions Audit

- Merge: none.
- Package publish / registry mutation: none.
- Merge queue label: none.
- Subagent source-control write: none; all git/gt writes were main-agent owned.
- Radio source-control mutation: none.

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| | | | |

## Final State

Submitted draft Trails stack and stopped at TRL-814 proof lane. Not ready-for-review because Greptile has not reviewed the draft PRs yet.
