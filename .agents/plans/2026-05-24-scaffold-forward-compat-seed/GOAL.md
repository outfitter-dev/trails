---
created: 2026-05-25T14:30:47Z
updated: 2026-05-25T14:30:47Z
description: Executable goal prompt for the scaffold forward-compat seed session. Contains the verbatim /goal command to paste into the runtime, covering the four-PR Graphite stack (TRL-796 exact pins, TRL-798 provenance, TRL-797 bump helper, TRL-799 draft ADR), validation ladder, review requirements, hard rules, done criteria, and stop/ask conditions.
impl_status: implemented
linear:
  - TRL-796
  - TRL-797
  - TRL-798
  - TRL-799
references:
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/PLAN.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/RETRO.md
  - .agents/plans/2026-05-24-scaffold-forward-compat-seed/REFS.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
---

# Goal Prompt: scaffold forward-compat seed

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/.codex/worktrees/0f7f/trails`, execute `.agents/plans/2026-05-24-scaffold-forward-compat-seed/PLAN.md` end to end. Use `.agents/plans/2026-05-24-scaffold-forward-compat-seed/RETRO.md` as the durable ledger and touch it last before each handoff.

Read first: `AGENTS.md`, `.agents/plans/PLANNING.md`, packet `PLAN.md` + `REFS.md`, Linear TRL-796/798/797/799 plus the TRL-801 supersession comment, then the anchors in `REFS.md`: scaffold versions/source/tests, `scripts/sync-scaffold-versions.ts`, root `package.json`, release docs, and draft ADR docs.

Objective: build one coherent four-PR Graphite stack in PLAN order: TRL-796 exact generated `@ontrails/*` beta pins -> TRL-798 minimal `.trails/scaffold.json` provenance -> TRL-797 internal scaffold-version bump/check helper -> TRL-799 draft scaffold forward-compatibility ADR.

Scope: TRL-796 removes the caret prerelease range, updates scaffold tests and stable-cutover prerequisite docs, and adds a patch changeset. TRL-798 writes/documents/tests minimal provenance with `schemaVersion`, `scaffoldVersion`, `template`, `generatedAt` unless evidence forces narrower, and adds a patch changeset. TRL-797 extends existing internal scaffold-version tooling/checks so exact pins stay bumpable after `bunx changeset version`; keep it internal unless evidence proves otherwise. TRL-799 drafts the ADR under `docs/adr/drafts/`, grounded in the implemented breadcrumb/helper shape, explicitly deferring read/diff/migration/upgrade tooling.

Work loop: checkpoint-by-checkpoint. Report checkpoint, changes, exact proof, checks, remaining work, blockers, and next checkpoint. Update `RETRO.md` after meaningful implementation, tracker, verification, review, PR, CI, or remote-review changes.

Validation: run narrow relevant checks per branch: scaffold create tests, `bun --cwd apps/trails test`, `bun run scaffold-versions:check`, ADR/docs scripts when docs change, `bun run format:check`, `git diff --check`, and `bun run typecheck`. Before submission/final handoff run `bun run check`. Optional smoke: temp scaffold, inspect exact pins plus `.trails/scaffold.json`, then install/typecheck/test if registry/network state permits.

Review: run local review from stack tip before submission across scaffold shape, helper/tooling coverage, and release/docs/ADR doctrine fit. Fix P0/P1/P2 on owning branches bottom-up by checking out the affected branch, `gt modify`, `gt restack`, then rechecking affected descendants. Record local/remote scores, summaries, prompt-to-fix text, CI, threads, and fixes in `RETRO.md`.

Hard rules: do not implement TRL-803, TRL-794, TRL-782, TRL-783, or TRL-801 separately. Do not build scaffold diffing, migrations, template hashes, upgrade application, provenance readers, public `trails upgrade`, publication, registry/dist-tag mutation, stable versioning commands, merge, merge queue labels, or subagent git/gt writes. Keep PRs draft until CI green and local review clean.

Done only when all four draft PRs exist, CI is green, Linear is current, tests/docs prove exact pins/provenance/helper/ADR shape, checks pass or skips are justified, constraints hold, and `RETRO.md` has final tracker, PR, review, verification, forbidden-action, risk, follow-up, and archive-readiness state. Stop/ask if repo/Linear truth diverges, exact-pin policy reopens, helper scope becomes release automation/public CLI, ADR requires a new public primitive/command now, unrelated verification fails after focused retry, protected actions are needed, or three focused attempts do not shrink the failure.
````
