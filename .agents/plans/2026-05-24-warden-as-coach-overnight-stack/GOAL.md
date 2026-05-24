# Goal Prompt

````text
/goal
cwd: /Users/mg/Developer/outfitter/trails
packet: .agents/plans/2026-05-24-warden-as-coach-overnight-stack

Objective: build as much of the Warden-as-Coach stack as can be safely cleared overnight, starting with TRL-791. Preserve Trails doctrine and vocabulary. Turn fieldwork learning into Warden guidance that steers agents/authors toward the happy path.

Primary slice: TRL-791 on branch trl-791-warden-coach-against-destructured-ctxcross-new-reject-and. Add source-static warn rule no-destructured-cross. It must flag destructuring cross off the blaze context, including param destructuring ({ cross }, { cross: compose }) and body destructuring from the context identifier (const { cross } = ctx; const { cross: compose } = ctx). It must not flag direct ctx.cross(...), non-blaze code, or nested unrelated functions. Register the rule in Warden registries, metadata, trail wrapper exports, generated guide blocks, and add a patch changeset for @ontrails/warden.

Stack order after TRL-791: TRL-793 only if diagnostic-only; TRL-785 before TRL-786; defer TRL-790 unless scaffold stack is landed or the edit set is isolated. Do not take TRL-784. Do not change public ctx.cross API or bridge destructured cross in implementation-returns-result.

Loop: keep RETRO.md updated before each handoff; update Linear status/comments as branches/PRs move; use subagents for bounded review/research/coding tasks with exact file ownership; subagents must not run git/gt writes. Use Graphite for branch/commit/submit. Keep PRs draft until CI and local review are green.

Validation: focused Warden tests first; run guide sync/check after metadata changes; run bun --cwd packages/warden test, bun run typecheck, bun run lint, bun run format:check, git diff --check, and bun run check before final handoff unless a blocker is logged. Run at least two local review lanes and fix all P0/P1/P2 before submit.

Forbidden: no merge, no merge queue label, no publish/registry mutation, no destructive git commands, no unrelated scaffold edits, no undocumented divergence from Linear. Final proof must include branch/PR/status, changed artifacts, verification commands/results, local/remote review state, Linear updates, remaining risks, and forbidden-action audit.
````

## Completion Condition

At minimum, `TRL-791` has a draft PR with CI green, Linear updated, local review clean or P3-only, generated Warden guides synced, and `RETRO.md` finalized for handoff.

If additional slices are completed, each has its own branch/PR/Linear/retro evidence, and the stack order remains truthful.
