---
created: 2026-05-24T16:45:07Z
updated: 2026-05-24T16:45:08Z
description: Executable goal prompt for the Warden-as-coach overnight session. Contains the verbatim /goal command covering TRL-791 (no-destructured-cross), TRL-793 (names-only diagnostics), TRL-794 (partial diagnostics follow-up), TRL-785 (Result alias provenance gap), TRL-786 (redundant re-wrap detection), and TRL-790 (TODO lint carve-out). Specifies validation ladder, review loop, and done/stop criteria.
impl_status: partial
linear:
  - TRL-785
  - TRL-786
  - TRL-790
  - TRL-791
  - TRL-793
  - TRL-794
references:
  - .agents/plans/2026-05-24-warden-as-coach-overnight-stack/PLAN.md
  - .agents/plans/2026-05-24-warden-as-coach-overnight-stack/RETRO.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/tenets.md
  - docs/lexicon.md
---

# Goal Prompt: Warden As Coach Overnight Stack

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-24-warden-as-coach-overnight-stack/PLAN.md` end to end; use `.agents/plans/2026-05-24-warden-as-coach-overnight-stack/RETRO.md` as the durable ledger.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, the packet `PLAN.md` and `REFS.md`, `docs/tenets.md`, `docs/lexicon.md`, touched Warden rule/test files, and Linear issues `TRL-791`, `TRL-793`, `TRL-794`, `TRL-785`, `TRL-786`, `TRL-790`.

Objective: clear as much Warden-as-coach work as safely possible overnight, turning Radio/Fieldwork learnings into Warden diagnostics/rules that lead agents toward Trails happy paths.

Current known order: `TRL-791` is already draft PR #582 and should only need monitoring; `TRL-793` is draft PR #583; keep `TRL-794` as the partial-diagnostics follow-up; `TRL-785` is draft PR #584; next is `TRL-786` (redundant `Result.err(x.error)` re-wrap detection after provenance exists), with `TRL-790` opportunistic and isolated.

Work loop: execute one issue per focused branch/PR unless inseparable. After each turn report checkpoint, changed files, exact checks/artifact proof, result summary, remaining work, blocker status, and next checkpoint. Use bounded subagents for review/research; main agent owns all `git` and `gt` writes.

Validation ladder: run focused touched tests after each slice; before draft PR run package/repo gates from `PLAN.md`, including `bun --cwd packages/warden test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`, and `bun run check` unless explicitly justified. After PR submission, watch CI and record state.

Review loop: run local review lanes for any behavior change or broad diagnostic change. Fix P0/P1/P2 before remote handoff. Record local review, CI, remote review, and PR-body changes in `RETRO.md`.

Hard rules: no merge, package publish, registry mutation, merge queue label, or subagent source-control write without Matt approval. Keep terminology sharp: `trail`, `blaze`, `topo`, `cross`, `surface`, `resource`, `layer`; prefer `ctx.cross(...)` provenance. Do not broaden public API or doctrine without stopping.

Done only when completed slices have draft PRs, current Linear comments/status, green required checks/CI state recorded, forbidden actions respected, and `RETRO.md` has final tracker, PR, review, verification, forbidden-action, risk, and archive-readiness state. Final transcript must name proof.

Stop/ask if plan/repo/tracker truth diverges, public API/scope changes are needed, required secrets/external systems are missing, unrelated verification fails after focused retry, or `TRL-785`/`TRL-786` needs broad provenance work beyond the Warden rule boundary.
````
