# Goal Prompt

````text
/goal Execute the Trails Regrade runway review loop from .agents/plans/2026-05-29-regrade-runway-review-loop.

Worktree: current Trails checkout
Start branch: trl-833-implement-warden-fix-for-safe-source-edits

Objective:
Add a new bottom Graphite branch for the current-main vocab-audit drift, restack the existing Regrade/Warden runway stack upward, run exacting subagent local reviews by area, fix accepted P0-P2 findings on the lowest owning branches, verify the full stack, and submit the stack changes.

Required branch shape:
main
-> chore/vocab/audit-allowlist-bootstrap-cleanup
-> warden-tests-type-hygiene / PR #619
-> trl-840-harden-ontrailsregrade-package-boundary-before-public-use / PR #620
-> trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning / PR #621
-> trl-842-fix-or-document-example-typing-for-transformed-input-schemas / PR #622
-> trl-844-support-downstream-root-source-collection-for-regrade / PR #623
-> trl-845-add-regrade-rule-selection-and-coverage-report-shape / PR #624
-> trl-846-add-radio-shaped-downstream-regrade-regression-fixture / PR #625
-> trl-831-define-the-warden-fix-metadata-contract / PR #626
-> trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary / PR #627
-> trl-833-implement-warden-fix-for-safe-source-edits / PR #628

Review lanes:
1. Regrade engine/downstream/package boundary.
2. Warden fix metadata, term rewrite metadata, guide, and safe-fix CLI.
3. Test hygiene, packaging, changesets, vocab audit, and check gates.
4. Trails doctrine and stack coherence.

Subagents must not run git/gt/gh/Linear write operations. Findings need P0-P3 severity, exact file:line, quote, impact, and suggested fix, or explicit unable-to-verify.

Loop:
Collect findings into RETRO.md, fix accepted P0-P2 findings bottom-up on the owning branch, gt modify with explicit messages, gt restack upward, run focused checks, then run full tip verification. Repeat local review until the latest pass is P3-only or clean.

Required final checks at tip:
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run dead-code
bun run docs:links
bun run warden:agents:check
bun run warden:skills:check
bun run skillset:check
bun run publish:check
git diff --check main...HEAD

Final action:
Submit stack changes with Graphite. Do not merge and do not add merge queue labels. Finalize RETRO.md with branch/PR status, verification results, review outcomes, skipped checks, and confirmation that forbidden operations were not used.
````
