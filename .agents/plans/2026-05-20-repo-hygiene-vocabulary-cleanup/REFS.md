# References: repo-hygiene-vocabulary-cleanup

## Tracked / Portable Sources

- `AGENTS.md` - repo operating rules, Graphite workflow, Linear team details, validation commands, and subagent constraints.
- `.agents/plans/PLANNING.md` - Trails-specific goal-planning preferences.
- `packages/cli/src/build.ts` - concrete `TRL-733` target; planning audit observed the comment around line 1134 saying "Convert a trail or route into a CLI command when it is publicly exposed."
- `docs/contributing/language-styleguide.md` - primary current-facing guidance for lexicon/vocabulary usage.
- `.claude/skills/clark/SKILL.md` - current agent guidance that mentions route as drift vocabulary and uses route in ordinary prose.
- `.claude/skills/clark/references/calibrate.md` - calibration table includes `route (for composition) -> cross`.
- `apps/trails-demo/src/trails/onboard.ts` - planning audit observed "entity.onboard route" in a trail file header.
- `docs/surfaces/http.md` - canonical legitimate HTTP route terminology.

## Untracked / Local-Only Sources

- `.agents/notes/**` - excluded from `TRL-616` by default; historical/local notes are too noisy for the current-doc markdown pass.
- `.scratch/**` - excluded from `TRL-616` by default; scratch/history should not be rewritten unless the executor records a specific current-facing reason.
- `.agents/plans/archive/**` - excluded from `TRL-616` by default; archived packets should not be rewritten.

## Copied Or Summarized Sources

- This packet summarizes the relevant planning conclusions from the live Linear/repo audit performed before packet creation.

## Tracker Records

- `TRL-733` - Clean up loose `route` phrasing in `packages/cli/src/build.ts:1106`.
  - URL: <https://linear.app/outfitter/issue/TRL-733/clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106>
  - Branch: `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`
- `TRL-734` - Audit `route` vocabulary across packages; consider reserving the term for HTTP-specific contexts.
  - URL: <https://linear.app/outfitter/issue/TRL-734/audit-route-vocabulary-across-packages-consider-reserving-the-term-for>
  - Branch: `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
- `TRL-616` - Audit markdown files for hard line wraps.
  - URL: <https://linear.app/outfitter/issue/TRL-616/audit-markdown-files-for-hard-line-wraps>
  - Branch: `trl-616-audit-markdown-files-for-hard-line-wraps`
- `TRL-351` - Conditional contour test-hook issue.
  - URL: <https://linear.app/outfitter/issue/TRL-351/add-getcontourcalleenamefortest-hook-if-an-inline-contour-caller-ever>
  - Expected handling: recheck and likely move from Todo to Backlog if still conditional.
- `TRL-508` - `trails migrate` planning issue.
  - URL: <https://linear.app/outfitter/issue/TRL-508/codemod-path-scope-trails-migrate-and-align-with-ontrailstrailworks>
  - Expected handling: confirm out of implementation scope.

## PRs / Branches

- PR #531 `chore: add codex clark agent wiring` - only open PR observed during planning. Treat as collision/context awareness, not in-goal work unless the Linear-first audit proves a direct relationship.
- Planned branch order:
  1. `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`
  2. `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
  3. `trl-616-audit-markdown-files-for-hard-line-wraps`

## Prior Plans

- No active tracked packet existed under `.agents/plans/` during planning. Existing packets were archived.
- The Trail Versioning M3 packet was already archived at `.agents/plans/archive/2026-05-20-trail-versioning-m3-closeout/`.

## Validation Commands

- `gt sync` - start from current Graphite/main state.
- `git status --short --branch` - verify worktree and branch.
- `gh pr list --repo outfitter-dev/trails --state open --json number,title,headRefName,isDraft,mergeable,reviewDecision,updatedAt` - open PR awareness.
- `rg -n "\\broute\\b|\\broutes\\b|Route" packages apps docs README.md AGENTS.md .claude .agents` - route vocabulary audit.
- `rg -n "trail or route|route into a CLI command|CLI.*route|route.*CLI" packages/cli/src docs/surfaces/cli.md docs/contributing/language-styleguide.md` - CLI route drift audit.
- `bun run format:check` - repo formatting gate.
- `git diff --check` - diff whitespace safety.
- `bun run check` - broader repo gate if source changes expand beyond docs/comments or review requests it.
