---
created: "2026-05-26T22:32:21Z"
updated: "2026-05-26T22:32:21Z"
description: Pasteable /goal prompt for the fieldwork compounding stack before Radio migration. Instructs execution of TRL-782 (resource config inference), TRL-804 (Warden top-level surface coaching), TRL-781 (trails create rerun reconciliation), TRL-789 (entity starter CRUD completeness), TRL-816 (post-compose cleanup), then stop at TRL-814 as the Radio proof lane.
linear:
  - TRL-782
  - TRL-804
  - TRL-781
  - TRL-789
  - TRL-816
  - TRL-814
impl_status: partial
references:
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/PLAN.md
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/RETRO.md
  - .agents/plans/2026-05-26-fieldwork-compounding-stack/REFS.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
---

# Goal Prompt: Fieldwork Compounding Stack

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-26-fieldwork-compounding-stack/PLAN.md` as a stacked Trails framework sprint. Use `.agents/plans/2026-05-26-fieldwork-compounding-stack/RETRO.md` as the durable ledger and `.agents/plans/2026-05-26-fieldwork-compounding-stack/REFS.md` as the source map.

Objective: build the Fieldwork compounding stack before Radio migration: `TRL-782` resource config type inference, `TRL-804` Warden top-level surface coaching, `TRL-781` `trails create` rerun reconciliation, `TRL-789` entity starter CRUD completeness, `TRL-816` post-compose current-facing cleanup, then prepare/stop at `TRL-814` Radio proof lane.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, `docs/adr/0000-core-premise.md`, `docs/tenets.md`, `docs/adr/0001-naming-conventions.md`, `docs/lexicon.md`, `docs/architecture.md`, and Linear `TRL-782`, `TRL-804`, `TRL-781`, `TRL-789`, `TRL-816`, `TRL-814`.

Stack branches in order: `trl-782-resourcet-doesnt-flow-config-schemas-inferred-type-into`; `trl-804-warden-warn-topo-export-entry-should-not-open-a-surface-at`; `trl-781-trails-create-errors-hard-on-re-run-instead-of-reconciling`; `trl-789-trails-create-starter-entity-complete-the-crud-entitylist`; `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers`. Treat `TRL-814` Radio as terminal proof lane, not an automatic Trails Graphite branch unless prerequisites are explicit.

Before creating branches: sync main; inspect status; do not accidentally include the current local deletion of `scripts/import-scratch-to-notion.ts`. Isolate it by approved separate branch, stash, or explicit Matt approval to carry it.

Loop: one issue per focused Graphite branch unless evidence proves branch boundaries cannot stay green. Report checkpoint, branch, changed files, commands/results, review state, blocker state, and next step. Use subagents everywhere possible; never use fast mode. For well-defined execution/coding work, use GPT 5.4 subagents on high reasoning. Main agent owns all `git`/`gt` writes.

Validation: run focused tests for touched areas, then `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `git diff --check`, and `bun run check` before claiming local completion unless blocked. Run Warden sync/check commands when Warden guides or agent guidance change; run ADR/vocab checks when ADR/docs/vocabulary change. Record every skipped check in `RETRO.md`.

Review: keep PRs draft until local review, CI, and required checks are green. Before ready-for-review, verify Greptile summary is 5/5 and there is no Greptile prompt-to-fix / "Prompt for AI"; treat bot errors as blockers. Fix P0/P1/P2 local or remote findings bottom-up on owning branches; record scores, prompts, fixes, and unresolved P3s in `RETRO.md`.

Hard rules: no merge, publish, registry mutation, merge queue label, Radio source-control mutation, or subagent source-control write without Matt approval. Do not broaden into Hike/Forge/website work. File follow-up Linear issues for real discoveries outside scope.

Done only when Trails-side stack PRs are submitted or stopped with evidence; Linear is current; CI/review states are recorded; `TRL-814` has precise ready/blocker state; forbidden actions are audited; and `RETRO.md` has final branch/PR/verification/review/risk/archive-readiness state. Final transcript must name proof.

Stop/ask if dirty local state cannot be isolated, branch boundaries cannot stay green, `TRL-782` needs a public type redesign, `TRL-804` creates broad false positives, scaffold reconciliation requires destructive behavior, Radio needs package publication/local-link/source-control approval, or unrelated verification fails after focused retry.
````
