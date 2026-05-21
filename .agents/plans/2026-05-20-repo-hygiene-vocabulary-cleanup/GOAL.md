# Goal Prompt: repo-hygiene-vocabulary-cleanup

Paste this into the goal runtime:

````markdown
/goal Execute the repo hygiene and vocabulary cleanup packet end to end from cwd `.`, using `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/PLAN.md` as the primary source of truth.

Read first:
- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/PLAN.md`
- `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/REFS.md`
- Linear issues `TRL-733`, `TRL-734`, `TRL-616`, `TRL-351`, and `TRL-508`

Objective:
Run a Linear-first cleanup sprint, then build and submit a small Graphite stack that starts with one PR per known executable issue (`TRL-733`, `TRL-734`, `TRL-616`) and may expand only when the Linear audit identifies additional cleanup-sized issues with exact branch names, acceptance criteria, and no unsettled design decisions.

Mandatory first checkpoint:
Before creating branches, run `gt sync`, inspect open PRs/Graphite state, query all TRL Todo/In Progress/Backlog issues, and write a candidate classification table into `RETRO.md`: executable in this stack, tracker-only hygiene, planning-only, deferred design/post-1.0, or out of scope. Recheck `TRL-351` and likely move it from Todo to Backlog if still conditional. Confirm `TRL-508` remains planning-only and do not implement it.

Known stack, bottom to top:
1. `TRL-733` on `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`
2. `TRL-734` on `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
3. `TRL-616` on `trl-616-audit-markdown-files-for-hard-line-wraps`

Expansion rule:
You may add more PRs only after the Linear-first audit proves the work is cleanup-sized, current, executable, and has a real Linear issue. If no issue exists, create one first. Record the branch name, acceptance criteria, dependency/order, and reason for inclusion in `RETRO.md`. Do not include `TRL-508`, activation design, Cloudflare/Vercel runtime adapters, package exports, release/versioning, or public API changes.

Source-control constraints:
- Use Graphite for branch/stack operations.
- It is fine to create local branches up front, but do not push or submit empty branches.
- Main agent owns all `git` and `gt` writes.
- Subagents may edit files, run checks, and write reports, but must not run source-control writes or PR mutations.
- Do not use `gt absorb` as the normal workflow.
- Do not add merge queue labels.
- Do not merge.
- Do not publish or mutate the npm registry.
- Do not use the local `trails` skill; use `AGENTS.md`, tracked docs, Linear, and live source instead.

Verification:
Use narrow checks first, then broader checks when needed:
```bash
rg -n "\\broute\\b|\\broutes\\b|Route" packages apps docs README.md AGENTS.md .claude .agents
rg -n "trail or route|route into a CLI command|CLI.*route|route.*CLI" packages/cli/src docs/surfaces/cli.md docs/contributing/language-styleguide.md
bun run format:check
git diff --check
```
For `TRL-616`, record the exact markdown hard-wrap detector command and manually verify no code blocks, tables, lists, generated sections, changelogs, `.scratch/**`, `.agents/notes/**`, or `.agents/plans/archive/**` were rewritten. Run `bun run check` if the diff expands beyond docs/comments or if local review asks for it.

Local review:
Before remote submission, run local review passes from the stack tip. Default to at least three passes unless the final stack is tiny and `RETRO.md` records why fewer are enough. Ask reviewers for `n/5` score, prose summary, P0/P1/P2/P3 findings, and Prompt To Fix With AI. Fix all P0/P1/P2 findings on the lowest owning branch, restack, and rerun relevant checks. Stop local review only when the latest pass is clean or P3-only.

Remote review:
Submit draft PRs with high-quality bodies. Keep them draft until CI and local review are clean. Mark ready only after that. After ready, check CI, unresolved threads, and code-review bot/agent summaries. Capture scores, prose summaries, and Prompt To Fix With AI blocks in `RETRO.md`. Resolve P0/P1/P2 feedback bottom-up. Treat Graphite mergeability lag as external service lag when GitHub checks/reviews are clean and GitHub reports mergeable; do not spin or queue/merge just to settle it. Stop after a maximum of four post-ready remote-review turns and report exact status if P2+ feedback remains.

Completion condition:
The goal is complete only when Linear audit and tracker updates are recorded, all included branches/PRs are submitted and ready or exact blockers are documented, local review is clean/P3-only, remote P0/P1/P2 feedback is resolved or explicitly blocked, required checks pass or skipped checks are justified, no forbidden action occurred, and the final transcript reports changed artifacts, PRs, Linear mutations, commands/results, remaining risks, blocker status, and finalized `RETRO.md` state.

Retro discipline:
Maintain `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/RETRO.md` as the durable execution ledger. For a stack, touch it last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, archive, or final handoff. Any meaningful local or remote review change must be reflected in `RETRO.md` before claiming that review loop is complete.

Stop and ask if:
- The plan appears stale against `main`, Linear, or open PR state.
- The audit would require implementation of `TRL-508`, activation design, runtime adapters, public API changes, package exports, release/versioning, publishing, registry mutation, merge, or merge queue actions.
- Markdown cleanup would rewrite historical archives/generated content or become too large for a safe review.
- Verification fails for unrelated reasons after one focused retry.
````
