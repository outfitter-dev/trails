---
created: "2026-05-24T16:45:06Z"
updated: "2026-05-24T16:45:06Z"
description: "Pasteable /goal prompt for the scaffold-runway overnight stack. Covers building TRL-788 (generated tsconfig.tests.json), TRL-777 (generated AGENTS.md + CLAUDE.md), TRL-779 (generated README) as a scaffold stack from post-PR-#577 main, plus TRL-792 (Bun runtime docs) as a separate sidecar PR. Specifies implementation constraints, validation ladder, review loop, and done/stop conditions."
impl_status: implemented
linear:
  - TRL-777
  - TRL-779
  - TRL-788
  - TRL-792
references:
  - .agents/plans/2026-05-23-scaffold-runway-overnight-stack/PLAN.md
  - .agents/plans/2026-05-23-scaffold-runway-overnight-stack/RETRO.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - apps/trails/src/trails/create-scaffold.ts
  - apps/trails/src/__tests__/create.test.ts
  - docs/releases/beta-channel-policy.md
---

# Goal Prompt: Scaffold Runway Overnight Stack

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-23-scaffold-runway-overnight-stack/PLAN.md` end to end; keep `.agents/plans/2026-05-23-scaffold-runway-overnight-stack/RETRO.md` as the durable ledger.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md`/`REFS.md`, Linear TRL-788/777/779/792, `apps/trails/src/trails/create-scaffold.ts`, `apps/trails/src/__tests__/create.test.ts`, `docs/releases/beta-channel-policy.md`.

Objective: build the scaffold-runway motion after merged PR #577: stack TRL-788 generated `tsconfig.tests.json`, TRL-777 generated `AGENTS.md` + `CLAUDE.md` guidance, and TRL-779 generated README; handle TRL-792 Bun runtime docs as a separate sidecar PR from `main`. Use one Graphite branch/PR per issue. Scaffold stack order: `trl-788-trails-create-scaffold-tsconfigtestsjson-sibling-for-lsp`; `trl-777-trails-create-scaffolds-agentsmd-claudemd-minimal-trails`; `trl-779-trails-create-scaffolds-readmemd-create-react-app-style`. Sidecar branch: `trl-792-document-bun-runtime-requirement-for-consumers-beta-channel`.

Work loop: execute checkpoint-by-checkpoint. After each turn report checkpoint, changed files, exact checks/artifact proof, result summary, remaining work, blocker status, next checkpoint. Use subagents for bounded research/review lanes; subagents must not run git/gt write commands or PR mutations. Main agent owns branches, commits, submits, Linear updates, and synthesis.

Implementation constraints: preserve Trails vocabulary (`trail`, `blaze`, `topo`, `cross`, `surface`, `resource`, `layer`). Do not add TRL-778 plugin install detection, TRL-781 rerun reconciliation, TRL-789 entity CRUD, TRL-790/791 Warden work, TRL-782/783 type work, or TRL-784 naming work. Do not add `--no-agents`, `--no-readme`, new CLI grammar, package publication, registry mutation, merge, or merge-queue labels. Package-affecting PRs need branch-local patch changesets for `@ontrails/trails`.

Validation ladder: after each branch run `bun test apps/trails/src/__tests__/create.test.ts` when scaffold code changes; run `bun --cwd apps/trails test` for scaffold branches; before draft submission/final handoff run `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`, and `bun run check` if time allows. Record skipped checks with reasons.

Review loop: run local review from stack tip with lanes for scaffold generation/tests, vocabulary/doctrine, and release/docs/changeset hygiene. Require overall score + P0-P3 findings + prompt-to-fix. Fix P0/P1/P2 bottom-up before draft submission or final handoff. After draft PRs, inspect CI, unresolved threads, review-bot summaries/scores, and prompt-to-fix blocks; fix P0/P1/P2 and record all in `RETRO.md`.

Done only when TRL-788/777/779 have draft PRs in the scaffold stack and TRL-792 has a separate draft PR, or each undone issue has an explicit evidence-backed deferral; checks pass or skips are justified; Linear/PR state is current; constraints hold; `RETRO.md` has final tracker, PR, review, verification, forbidden-action, risk, and archive-readiness state; final transcript reports proof.

Stop/ask if repo/tracker truth diverges, public API/scope/CLI grammar changes are needed, symlink support becomes necessary rather than a thin `CLAUDE.md` shim, secrets/external systems are missing, unrelated verification fails after focused retry, or publication/merge/merge queue would be required.
````
