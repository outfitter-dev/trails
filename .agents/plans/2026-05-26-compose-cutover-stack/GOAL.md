---
created: "2026-05-26T12:59:04-04:00"
updated: "2026-05-26T12:59:04-04:00"
description: Pasteable /goal prompt for the cross->compose cutover stack (TRL-809 through TRL-814). Instructs the executor to rename the composition API from ctx.cross/crosses to ctx.compose/composes across core, persistence, Warden, docs, scaffold, and codemod, folding TRL-783 into S1. Defines completion conditions, stop rules, and forbidden actions.
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
  - .agents/plans/2026-05-26-compose-cutover-stack/PLAN.md
  - .agents/plans/2026-05-26-compose-cutover-stack/RETRO.md
  - .agents/plans/2026-05-26-compose-cutover-stack/REFS.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0049-composition-is-compose-not-cross.md
  - docs/tenets.md
  - docs/lexicon.md
---

# Goal Prompt: Compose Cutover Stack

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-26-compose-cutover-stack/PLAN.md` end to end; use `.agents/plans/2026-05-26-compose-cutover-stack/RETRO.md` as the durable ledger and `.agents/plans/2026-05-26-compose-cutover-stack/REFS.md` as the source map.

Objective: run the staged `cross` -> `compose` cutover stack (`TRL-809` through `TRL-814`), folding `TRL-783` into S1 so the new `ctx.compose` path is type-correct on arrival: declared composition gives the blaze a non-optional compose function, and typed trail-object composition returns real `TrailOutput<T>` instead of `never`.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, `docs/adr/0049-composition-is-compose-not-cross.md`, `docs/tenets.md`, `docs/lexicon.md`, and Linear `TRL-784`, `TRL-783`, `TRL-809`-`TRL-814`.

Stack order/branches: `TRL-809` `trl-809-crosscompose-cutover-s1-core-api-type-rename` (includes `TRL-783`), then `TRL-810`, `TRL-811`, `TRL-812`, `TRL-813`, `TRL-814` using their Linear branch names from `PLAN.md`. Work from main checkout, sync first, and do not touch unrelated dirty/untracked files; known unrelated file may be `scripts/import-scratch-to-notion.ts`.

Loop: one issue per focused Graphite branch unless evidence shows branch boundaries cannot stay green. Report checkpoint, branch, changed files, commands/results, review state, blocker state, and next step. Use bounded subagents for research/review only; main agent owns all `git`/`gt` writes.

Validation: run focused tests for touched areas, then `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, ADR checks when ADR/docs change, Warden sync/check commands when Warden/AGENTS/skills change, and `bun run check` before claiming local completion unless explicitly blocked. Record every skipped check in `RETRO.md`.

Review: keep PRs draft until local review, CI, and required checks are green. Before ready-for-review, verify Greptile summary is 5/5 and there is no Greptile prompt-to-fix / "Prompt for AI"; treat bot errors as blockers. Fix P0/P1/P2 local or remote findings bottom-up; record scores, prompts, fixes, and unresolved P3s in `RETRO.md`.

Hard rules: no merge, publish, registry mutation, merge queue label, or subagent source-control write without Matt approval. Do not broaden ADR-0049, add backwards-compat aliases, or mutate Radio source control without stopping for approval unless already explicitly cleared in the packet.

Done only when the stack is submitted as draft/ready PRs or stopped with evidence, Linear is current, CI/review states are recorded, forbidden actions are audited, and `RETRO.md` has final tracker/branch/PR/verification/review/risk/archive-readiness state. Final transcript must name proof.

Stop/ask if staged branches cannot stay green, `TRL-783` needs type-system redesign beyond S1, public API or serialized artifact decisions exceed ADR-0049, Radio is unsafe to mutate, unrelated verification fails after focused retry, or credentials/irreversible actions are required.
````
