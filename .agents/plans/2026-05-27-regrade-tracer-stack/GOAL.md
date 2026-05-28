---
created: "2026-05-27T20:12:09Z"
updated: "2026-05-27T20:12:09Z"
description: Pasteable /goal prompt for the first Regrade proof stack: TRL-823 (packed-manifest first-party beta coherence), TRL-819 (ctx.compose trail-object inference without composeInput), then TRL-825 (experimental packages/regrade literal transform-trail tracer). Defines completion conditions, validation per branch, review protocol (up to 3 remote rounds), stop rules, and forbidden actions.
linear:
  - TRL-819
  - TRL-823
  - TRL-825
impl_status: implemented
references:
  - .agents/plans/2026-05-27-regrade-tracer-stack/PLAN.md
  - .agents/plans/2026-05-27-regrade-tracer-stack/RETRO.md
  - .agents/plans/2026-05-27-regrade-tracer-stack/REFS.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
---

# Goal Prompt: Regrade Tracer Stack

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-27-regrade-tracer-stack/PLAN.md`; use `.agents/plans/2026-05-27-regrade-tracer-stack/RETRO.md` as the durable ledger and `.agents/plans/2026-05-27-regrade-tracer-stack/REFS.md` as the source map.

Objective: land the first Regrade proof stack: `TRL-823` packed-manifest first-party beta coherence, `TRL-819` `ctx.compose(trail,input)` inference without `composeInput`, then `TRL-825` experimental `packages/regrade` literal transform-trail tracer. Do not implement full `trails regrade`, downstream roots, package-source modes, Warden fix metadata, `term-rewrite`, or ADR work in this goal.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, `docs/adr/0000-core-premise.md`, `docs/tenets.md`, `docs/adr/0001-naming-conventions.md`, `docs/lexicon.md`, `docs/architecture.md`, and Linear `TRL-823`, `TRL-819`, `TRL-825`.

Stack order: `trl-823-fail-publish-checks-when-packed-manifests-rewrite-first` -> `trl-819-fix-ctxcomposetrail-input-inference-for-trails-without` -> `trl-825-scaffold-packagesregrade-and-prove-literal-transform-trails`. Commit this packet on the lowest branch. Work from current `main`; run `gt sync`; inspect status/open PRs; do not touch unrelated PRs #602/#607 or untracked `.agents/plans/2026-05-26-radio-compose-proof/README.md`.

Loop: one issue per Graphite branch. Report checkpoint, branch/issue, changes, commands/results, review state, blockers, next step. Use subagents everywhere possible; no fast mode. For well-defined coding/review tasks use GPT 5.4 subagents with high reasoning. Main agent owns all `git`/`gt` writes and tracker/PR mutation.

Validation: run focused checks per branch (`publish:check -- --only @ontrails/trails` for TRL-823; `bun run --cwd packages/core typecheck` for TRL-819; `bun run --cwd packages/regrade typecheck` and `bun test packages/regrade` for TRL-825), then stack gates: `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, `bun run check`. Record skipped checks in `RETRO.md`.

Review: before ready, run local reviews until latest pass is clean or P3-only; record scores/findings/prompts in `RETRO.md`. Matt allows marking PRs ready once local review and CI are clean/P3-only. After ready, run at most 3 remote review-bot feedback rounds. Fix P0/P1/P2 on the affected branch directly, restack upward, and never use `gt absorb`. P3s may remain if recorded.

Hard rules: no merge, publish, registry mutation, merge queue label, unrelated destructive changes, or subagent source-control writes without Matt approval. Add changesets for publishable package content. File follow-up Linear issues for real discoveries outside scope.

Done only when draft/ready PRs exist or a precise blocker is recorded; Linear/PR bodies are current; CI/local/remote review states are recorded; P2+ review debt is cleared or blocked after max 3 rounds; forbidden actions are audited; and `RETRO.md` has final tracker, PR, review, verification, risk, and archive-readiness state. Final transcript must name proof.

Stop/ask if dirty state cannot be isolated, repo/Linear/Graphite truth diverges, TRL-823 needs broad release redesign, TRL-819 needs public API redesign, TRL-825 disproves literal trails or requires publication/package-source decisions, unrelated verification keeps failing, or 3 post-ready review rounds still leave P2+ debt.
````
