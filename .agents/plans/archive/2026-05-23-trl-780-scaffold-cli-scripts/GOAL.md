# Goal Prompt: TRL-780 Scaffold CLI Scripts

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/trails`, execute `.agents/plans/2026-05-23-trl-780-scaffold-cli-scripts/PLAN.md` end to end. Keep `.agents/plans/2026-05-23-trl-780-scaffold-cli-scripts/RETRO.md` as the durable ledger and update it before every handoff/completion claim.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, the packet `PLAN.md`, `REFS.md`, `RETRO.md`, Linear TRL-780, then `apps/trails/package.json`, `apps/trails/src/trails/create-scaffold.ts`, `apps/trails/src/__tests__/create.test.ts`, and `apps/trails/src/trails/add-verify.ts`.

Objective: finish TRL-780 scripts-first. Fresh `trails create` projects must install the already-existing `@ontrails/trails` bin and expose core framework commands through `bun run` scripts. Current main already has `@ontrails/trails` `bin: { "trails": "./bin/trails.ts" }`; do not reopen package/bin architecture unless live source disagrees.

Scope: add `@ontrails/trails: ontrailsPackageRange` to generated devDependencies; add scripts for at least `warden`, `survey`, `topo`, `compile`, `validate`, `diff`, `doctor`, `guide`, `add`, `revise`, `deprecate`, `completions`, and `run`; preserve existing `build`, `test`, `typecheck`, `lint`, `format:check`, `format:fix`; extend scaffold tests for default and `verify: false`; add `.changeset/trl-780-scaffold-cli-scripts.md` patching `@ontrails/trails`.

Use Graphite branch `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands`. Main agent owns git/gt writes. Delegate to Spark subagents for bounded coding or review lanes when useful, but subagents must not run git/gt write commands.

Work loop: implement in small checkpoints; after each turn report checkpoint, changed files, exact checks/artifact proof, result summary, remaining work, blockers, next checkpoint. Use direct file evidence, not memory.

Validation ladder: run `bun test apps/trails/src/__tests__/create.test.ts`, `bun --cwd apps/trails test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `git diff --check`, and `bun run check` if feasible. Prefer a generated temp-project smoke: create app, `bun install`, then `bun run survey -- --help` and `bun run warden -- --help`; if registry/network/runtime prevents it, record why in `RETRO.md` and provide the closest substitute proof.

Review loop: run at least two local review lanes before final handoff: scaffold/package shape and test/smoke adequacy. Use Spark subagents if available. Record score, P0-P3 findings, fixes/deferrals, and prompt-to-fix text in `RETRO.md`. Fix all P0/P1/P2 before draft PR or final handoff.

Hard rules: no merge, no publish/registry mutation, no merge queue label, no doctrine/API/CLI grammar changes beyond generated scripts, no TRL-778/781/789 work, no destructive cleanup. Keep TRL-780 tracker/PR state truthful if you create/update them.

Done only when generated scaffolds have the devDep and scripts, tests and checks pass or justified skips are logged, changeset exists, tracker/PR/branch state is clear, constraints hold, `RETRO.md` final state is filled, and final transcript reports proof.

Stop/ask if `@ontrails/trails` bin is absent on current main, fixing TRL-780 requires new public package/API/command grammar, script naming conflicts with existing scaffold scripts, unrelated verification fails after one focused retry, or secrets/publish/merge/irreversible actions are needed.
````
