# Goal Prompt: v1-release-readiness-closeout

Paste this into the goal runtime:

````markdown
/goal From cwd `<path-to-trails-repo>`, execute `.agents/plans/2026-05-22-v1-release-readiness-closeout/PLAN.md` end to end. Objective: build the 7-branch v1 release-readiness closeout stack: audits `TRL-767`, `TRL-766`, `TRL-756`, then implementation/docs `TRL-757`, `TRL-758`, `TRL-759`, `TRL-760`; one PR per issue; no merge.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`/`RETRO.md`, and all listed Linear issues. Start with `gt sync --no-interactive`; verify main/open PR state. Commit the packet on the lowest branch. Use exact Linear branch names/order from `PLAN.md`; local branch chain is ok; do not push empty branches.

Work loop: checkpoint-by-checkpoint. After each turn report checkpoint, changed files/artifacts, exact checks run, result summary, remaining work, blocker status, next checkpoint. Shrink failing surface before retrying. Keep `RETRO.md` updated after tracker, branch, audit, implementation, verification, local review, remote review, PR-body, or final-state changes; touch it last before handoff states.

Audit contract: `TRL-767`, `TRL-766`, `TRL-756` produce committed reports under the packet `reports/` dir, with verdicts, evidence, command snippets, source paths, and follow-up issue list. File focused Linear follow-ups for real out-of-goal discoveries. If an audit finds a stable-cutover blocker larger than a small in-stack fix, stop/ask after recording evidence.

Implementation contract: `TRL-757` isolates `@ontrails/testing` surface harnesses behind subpaths, optionalizes surface peers, adds regression + changeset; `TRL-758` clarifies top-level Topographer CLI workflow and retired topo commands; `TRL-759` documents beta install/dist-tag/version cadence using Bun publish scripts only; `TRL-760` adds linked beta.15 -> beta.18 downstream migration guide.

Validation ladder: targeted checks per phase; then `bun run check`, `bun run test`, `bun run build`, `bun run publish:check`, `bun run publish:registry-check`, `git diff --check`; add docs/plugin/warden checks if touched. If skipped, say why and what would prove it.

Review loop: run >=3 scored local review passes from stack tip; request n/5, prose summary, P0-P3 findings, evidence, Prompt To Fix. Fix all P0/P1/P2 bottom-up before submit. Submit draft stack with high-quality PR bodies; mark ready only after CI/local review clean. After ready, wait ~15m; run max 4 post-ready remote-review turns; resolve P0/P1/P2 and concrete lower-score bot/agent feedback bottom-up; record scores/prompts/threads in `RETRO.md`.

Hard rules: no npm publish, no `bun run publish:packages`, no registry/dist-tag mutation, no merge, no merge queue label, no `gt absorb`, no source-control writes by subagents, no `TRL-508`/`TRL-765` implementation unless explicitly authorized. Do not spin on Graphite mergeability lag alone if GitHub checks/reviews are otherwise clean.

Done only when all 7 issues have PRs, audits/reports/docs/code are complete, checks pass, Linear and PR bodies are current, no unresolved P0/P1/P2 remains, forbidden-action audit is clean, `RETRO.md` final state is filled, and final transcript reports branch/PR range, verification, review scores, skipped checks, risks/P3s, and no-merge/no-publish confirmation.
````
