# Regrade Runway Stack

Date: 2026-05-28
Repo: current Trails checkout
Status: executed; stack submitted and reopened for follow-up review fixes on 2026-05-29

## Objective

Build the next larger Regrade runway as one coherent Graphite stack:

1. Close the post-tracer framework/package seams.
2. Extend Regrade into a downstream-ready engine with reportable coverage.
3. Add Warden fix metadata and safe fix execution.
4. Prove Regrade can consume Warden-owned `term-rewrite` metadata.
5. Draft the Warden and Regrade doctrine after the evidence exists.

This intentionally supersedes the narrower downstream-only packet at
`.agents/plans/2026-05-28-regrade-downstream-stack/`.

## Doctrine Frame

- Regrade is Trails using Trails, not a new primitive.
- Warden owns detection. Regrade owns application, provenance, validation, and
  routed review.
- Fix metadata belongs with Warden diagnostics, not in a parallel Regrade rule
  database.
- `term-rewrite` is the durable mechanism name. `vocab-cutover` is historical
  wording only.
- `RegradeReport` is a trail output/report object, not a contour.
- Public `trails regrade`, package-source modes, and publishing are downstream
  delivery work, not this runway stack.

## Current State

As of packet creation:

- `main` is synced at `7cd714ff1`:
  `test(regrade): harden generated fixture temp handling (#618)`.
- PR #618 / TRL-841 is merged.
- `git status --short --branch` shows current branch `main...origin/main` with
  only untracked `.agents/plans/...` packet directories.
- `gt ls` shows `main` current and the old TRL-841 branch as merged.
- Linear shows the intended stack issues in Backlog:
  `TRL-840`, `TRL-843`, `TRL-842`, `TRL-844`, `TRL-845`, `TRL-846`,
  `TRL-831`, `TRL-832`, `TRL-833`, `TRL-834`, `TRL-836`, `TRL-829`.
- Linear shows prerequisites done:
  `TRL-823`, `TRL-819`, `TRL-825`, `TRL-841`.

Do not sweep unrelated untracked packet directories into a commit unless the
execution branch explicitly commits this packet.

## Hard Preflight

Before implementation:

1. Confirm the current Trails checkout is on `main`.
2. Run `gt sync` and confirm `git status --short --branch` has no unexpected
   tracked changes.
3. Confirm `gt ls` starts the new stack from `main`.
4. Confirm PR #618 is merged.
5. Confirm the issue list and branch names below still match Linear.
6. Leave unrelated untracked `.agents/plans/...` dirs alone.
7. Use a Claude agent for execution unless Matt explicitly redirects; do not
   use Clark as the executor.

Stop if any preflight item fails. Do not stack on an old merged branch or
detached Codex worktree.

## Stack Order

Use Graphite and exact Linear branch names.

| Order | Issue | Branch | Purpose |
| --- | --- | --- | --- |
| 1 | TRL-840 | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Narrow `@ontrails/regrade` root exports and fix runtime/dev dependency shape. |
| 2 | TRL-843 | `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` | Fix Regrade tracer happy-path Warden reachability warning without suppression. |
| 3 | TRL-842 | `trl-842-fix-or-document-example-typing-for-transformed-input-schemas` | Settle transformed-schema example typing and revisit the tracer cast. |
| 4 | TRL-844 | `trl-844-support-downstream-root-source-collection-for-regrade` | Add explicit downstream-root source collection substrate. |
| 5 | TRL-845 | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Add rule selection and `RegradeReport` coverage detail. |
| 6 | TRL-846 | `trl-846-add-radio-shaped-downstream-regrade-regression-fixture` | Add stable Radio-shaped downstream fixture. |
| 7 | TRL-831 | `trl-831-define-the-warden-fix-metadata-contract` | Define Warden fix metadata contract. |
| 8 | TRL-832 | `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` | Add `term-rewrite` metadata for retired vocabulary. |
| 9 | TRL-833 | `trl-833-implement-warden-fix-for-safe-source-edits` | Implement safe `warden --fix` source edits. |
| 10 | TRL-834 | `trl-834-draft-warden-fix-metadata-adr` | Draft Warden fix metadata ADR. |
| 11 | TRL-836 | `trl-836-integrate-warden-backed-term-rewrite-regrades` | Consume Warden-owned `term-rewrite` metadata from Regrade. |
| 12 | TRL-829 | `trl-829-draft-regrade-adr-from-tracer-evidence` | Draft Regrade ADR after tracer/downstream/Warden evidence. |

## Branch Contracts

### TRL-840

- Root `@ontrails/regrade` exports only intended public/package surface.
- Internal child transform trails remain reachable through topo/composes, not
  the root package barrel.
- Schema exports either become deliberate public contract or move behind a
  harness/internal path.
- Test-only deps such as `@ontrails/topographer` move to dev dependencies unless
  production Regrade code imports them.
- Existing generated-fixture and tracer tests still pass.

### TRL-843

- Reproduce the Regrade `dead-internal-trail` warning if still present.
- Fix the smallest layer: Warden object-form `composes`, tracer declaration, or
  topo evidence flow.
- Do not suppress Warden globally or add Regrade-specific exemptions.
- Add focused coverage for internal child reachability through object-form
  `composes` if that is the bug.

### TRL-842

- Decide whether examples for transformed input schemas type against raw schema
  input, blaze input, or an explicit dual shape.
- Prefer a tested type fix if small enough.
- If not small, document the limitation with a focused type/runtime test.
- `testExamples()` must continue feeding raw pre-transform input through
  validation.

### TRL-844 / TRL-845 / TRL-846

- Keep work package/engine-level; no public CLI.
- Accept an explicit downstream root.
- Collect deterministic candidate source files and skipped entries/reasons.
- Let rule/regrade-class selection run one class without executing all
  available transforms.
- Define `RegradeReport` with scanned/matched/rewritten/review/skipped counts
  plus enough detail to debug omissions.
- Add a stable Radio-shaped fixture in this repo; do not depend on the live
  Radio checkout.

### TRL-831 / TRL-832 / TRL-833

- Add structured Warden fix metadata covering rule id, transform class, target
  span/source edit, safety level, reason/migration note, and fixture/examples.
- Keep metadata authored on or near the detecting rule.
- Project fix availability through manifest/guide surfaces without a parallel
  rule database.
- `warden --fix` applies only safe fixes; unsafe/review-required findings remain
  reported.
- Include at least one safe source edit and one non-fixable diagnostic test.

### TRL-834 / TRL-836 / TRL-829

- Draft Warden fix metadata ADR before Regrade consumes the metadata.
- Integrate Regrade with Warden-backed `term-rewrite` without duplicating
  replacement mappings outside Warden.
- Model rename-class outcomes as `Rewrite`, `NeedsReview`, no-op, or structured
  failure.
- Draft Regrade ADR last, after evidence from literal trails, downstream roots,
  Warden metadata, and `term-rewrite` integration exists.

## Non-Goals

- Public `trails regrade` CLI (`TRL-828`).
- Package-source modes, published target install, local tarball closure, or
  delivery proof (`TRL-826` / `TRL-835`).
- Publishing `@ontrails/regrade`.
- Live Radio repo mutation.
- Reopening canceled legacy `TRL-818`.
- Solving every Warden diagnostic guidance issue outside `TRL-830`.
- Adding a new Trails primitive for Regrade.

## Subagent Policy

Use subagents aggressively for bounded work:

- current Regrade package boundary audit;
- Warden reachability/root-cause audit;
- transformed-example type design;
- downstream-source/report-shape design;
- Warden fix metadata design;
- local review lanes.

Execution subagents should use GPT-5.4 or better, high reasoning, no fast mode.
Subagents may edit files, run tests, and write reports, but must not run `git`,
`gt`, `gh`, or Linear write operations. The main executor owns source control,
PRs, tracker mutation, and review-thread replies.

Subagent briefs must name concrete files, issue IDs, and expected evidence.
"Unable to verify" is acceptable; invented paths, line numbers, branch states,
or issue claims are a hard failure.

## Source Control

- Use Graphite.
- Use exact Linear branch names.
- Commit this packet on the lowest branch (`TRL-840`) when execution begins.
- Keep each branch focused on its issue.
- Do not use `gt absorb`.
- For review fixes, check out the owning branch, verify with
  `git branch --show-current`, fix there, `gt modify`, restack/walk upward, and
  rerun affected checks.
- Submit PRs as draft first.
- Do not merge, publish, mutate registry state, or add merge-queue labels unless
  Matt explicitly authorizes it.

## Validation Ladder

Run focused checks per branch:

- Regrade package work:
  - `bun run --cwd packages/regrade typecheck`
  - `bun test packages/regrade`
  - `bun run --cwd packages/regrade lint` when source lint is touched
- Core/type work:
  - `bun run --cwd packages/core typecheck`
  - focused core tests or type tests
- Warden work:
  - focused `packages/warden/src/__tests__/*.test.ts`
  - `bun run --cwd packages/warden typecheck`
  - `bun run --cwd packages/warden test`
- ADR work:
  - `bun scripts/adr.ts map`
  - `bun scripts/adr.ts check`

Before submitting the full stack:

```bash
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run format:check
bun run check
git diff --check
```

If Warden guide or generated agent guidance changes:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

## Review Protocol

Before ready:

- Run at least three local review lanes over the stack.
- Each reviewer reports score `n/5`, summary, P0/P1/P2/P3 findings, and a
  concise "Prompt To Fix With AI" for actionable findings.
- Latest local review must be clean/P3-only before PRs leave draft.

After ready:

- Check CI, unresolved review threads, Greptile summaries, and bot/human review
  comments after each meaningful push.
- Target Greptile `5/5` with no "Prompt for AI" blocks.
- Treat Greptile errors as incomplete review, not success.
- Fix P0/P1/P2 bottom-up on owning branches.
- After at most three post-ready review rounds, stop and report exact remaining
  state if P2+ findings remain.

## Completion Condition

The goal is complete when:

- Draft PRs exist for the stack, or a narrower stopped point is explicitly
  justified in `RETRO.md`.
- CI is green or every skipped check is justified.
- Local review is clean/P3-only.
- Remote review has no unresolved P0/P1/P2 issues after allowed rounds.
- Linear issues and parents `TRL-827`, `TRL-830`, and `TRL-825`/`TRL-829`
  context are current with PR links/status.
- `RETRO.md` contains final branch/PR links, verification, review signals,
  tracker state, forbidden-action audit, and remaining risks.

Do not merge unless Matt explicitly authorizes merge.
