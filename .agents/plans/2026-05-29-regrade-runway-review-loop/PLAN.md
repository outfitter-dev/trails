# Regrade Runway Review Loop

Created: 2026-05-29
Status: executing

## Outcome

Get the Regrade/Warden runway stack back to a reviewable submitted state by adding one bottom branch for base vocab-audit drift, restacking the existing stack upward, running exacting local review with subagents, fixing P0-P2 findings on the lowest owning branch, verifying from bottom to tip, and submitting the updated stack.

The goal is complete only when:

- A new bottom branch below `warden-tests-type-hygiene` carries the base vocab-audit fix and this execution packet.
- The existing stack remains ordered above it through `trl-833-implement-warden-fix-for-safe-source-edits`.
- At least three bounded local review lanes inspect the current stack tip and report P0-P3 findings with file:line evidence or explicit "unable to verify".
- All P0-P2 local review findings are fixed on the lowest owning branch or explicitly rejected in `RETRO.md` with evidence.
- Tip verification passes: `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run build`, `bun run format:check`, `bun run check`, `git diff --check main...HEAD`, plus focused checks required by touched areas.
- The stack changes are submitted with Graphite and `RETRO.md` records final PR/branch status.

## Starting State

Current worktree: current Trails checkout

Current stack tip: `trl-833-implement-warden-fix-for-safe-source-edits`

Existing stack order from bottom to top:

1. `warden-tests-type-hygiene` / PR #619
2. `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` / PR #620
3. `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` / PR #621
4. `trl-842-fix-or-document-example-typing-for-transformed-input-schemas` / PR #622
5. `trl-844-support-downstream-root-source-collection-for-regrade` / PR #623
6. `trl-845-add-regrade-rule-selection-and-coverage-report-shape` / PR #624
7. `trl-846-add-radio-shaped-downstream-regrade-regression-fixture` / PR #625
8. `trl-831-define-the-warden-fix-metadata-contract` / PR #626
9. `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` / PR #627
10. `trl-833-implement-warden-fix-for-safe-source-edits` / PR #628

Known pre-review blocker:

- `bun run check` currently fails in `bun run vocab:audit` because current `main` moved line numbers for reviewed legacy vocabulary allowlist entries in `scripts/vocab-cutover-map.ts`.

## Branch Plan

1. Check out `warden-tests-type-hygiene`.
2. Create `chore/vocab/audit-allowlist-bootstrap-cleanup` with `gt create --insert` so it sits between `main` and `warden-tests-type-hygiene`.
3. Commit only the base vocab-audit fix and this packet on the new branch.
4. Restack upward with `gt restack --upstack`.
5. Walk to the tip before running full-stack review.

If Graphite insertion creates conflicts, stop the branch operation, record the conflict in `RETRO.md`, resolve the conflict on the branch being rebased, then continue restacking.

## Review Lanes

Run subagents in parallel from the stack tip. They must not perform git, Graphite, GitHub, or Linear write operations.

Each reviewer must return:

- Score out of 5.
- Findings ordered by severity.
- Every finding with severity P0-P3, exact file:line, a short quote, impact, and a concrete suggested fix.
- Explicit "unable to verify" for any claim that cannot be grounded.
- A short "prompt to fix" for each P0-P2 finding.

Assigned lanes:

1. Regrade engine and downstream surface: `packages/regrade/src/**`, `packages/regrade/package.json`, Regrade package boundary, downstream collection/report fixtures, transformed-input typing.
2. Warden fix metadata and CLI: `packages/warden/src/**`, `apps/trails/src/trails/warden-guide.ts`, fix metadata contract, term rewrite metadata, safe-fix command behavior, generated guide surface.
3. Test hygiene, packaging, and audit gates: Warden test type hygiene, changesets, `scripts/vocab-cutover-map.ts`, bootstrap cleanup allowlist, publish/check gates, plan packet fit.
4. Trails doctrine and stack coherence: lexicon, Result/error/resource/surface doctrine, public API shape, whether branch boundaries match the design intent.

## Fix Loop

Repeat until the latest local review pass is P3-only or clean:

1. Collect subagent findings into `RETRO.md`.
2. Map each accepted finding to its lowest owning branch.
3. Check out the lowest owning branch.
4. Apply the focused fix.
5. Run the smallest relevant focused check.
6. `gt modify` that branch with an explicit Conventional Commit message.
7. `gt restack --upstack`.
8. Continue upward until all accepted P0-P2 findings are resolved.
9. Run tip verification.
10. Launch another review pass if P0-P2 findings remain or if the fix changed review-sensitive behavior.

Do not use `gt absorb`. Do not bundle unrelated changes into review-response commits.

## Verification Ladder

Run focused checks near the owning branch, then full gates at the tip:

- `bun run vocab:audit`
- `bun test packages/regrade packages/warden/src/__tests__/fix.test.ts packages/warden/src/__tests__/command.test.ts packages/warden/src/__tests__/cli.test.ts packages/warden/src/__tests__/dead-internal-trail.test.ts packages/warden/src/__tests__/no-legacy-layer-imports.test.ts`
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run lint:ast-grep`
- `bun run build`
- `bun run format:check`
- `bun run check`
- `bun run dead-code`
- `bun run docs:links`
- `bun run warden:agents:check`
- `bun run warden:skills:check`
- `bun run skillset:check`
- `bun run publish:check`
- `git diff --check main...HEAD`

If a command fails, record the command, failure, hypothesis, and next action in `RETRO.md`.

## Submit

After local review and verification are clean enough:

1. Confirm stack order with `gt log --no-interactive`.
2. Submit with Graphite.
3. Inspect PR status and bot review status.
4. Record open remote blockers or confirm none found.

Do not merge. Do not add merge queue labels.

## Stop Rules

Stop and ask if:

- A branch insertion would rewrite unrelated work outside this stack.
- A required fix changes Trails doctrine or public API beyond the stack's stated intent.
- A remote reviewer requests a change that conflicts with local review findings.
- Graphite cannot restack after one focused conflict-resolution pass.
- Secrets, production systems, or irreversible actions are required.
