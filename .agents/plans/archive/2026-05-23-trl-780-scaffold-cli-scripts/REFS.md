# References: TRL-780 Scaffold CLI Scripts

## Tracked / Portable Sources

- `AGENTS.md` - repo commands, Graphite workflow, subagent rules, changeset
  requirement, and Trails vocabulary.
- `.agents/plans/PLANNING.md` - goal packet conventions, review discipline,
  validation ladder, and source-control expectations.
- `apps/trails/package.json:1` - `@ontrails/trails` package manifest. Current
  `main` already has `bin: { "trails": "./bin/trails.ts" }`, so this goal is
  scaffold consumption rather than bin invention.
- `apps/trails/src/trails/create-scaffold.ts:46` - `generatePackageJson()`
  owns baseline scaffold dependencies, dev dependencies, and scripts.
- `apps/trails/src/__tests__/create.test.ts:155` - scaffold package assertions
  live here.
- `apps/trails/src/__tests__/create.test.ts:166` - verify-mode assertions live
  here; extend carefully so `verify: false` still has the framework CLI dev
  dependency if the baseline scaffold owns it.
- `apps/trails/src/trails/add-verify.ts:33` - generated lefthook already runs
  `bunx trails warden`, proving the generated project needs a resolvable
  `trails` command when verification is enabled.
- `apps/trails/src/versions.ts:21` - `ontrailsPackageRange` derives
  `^${trailsPackageVersion}` from the current `@ontrails/trails` package.

## Untracked / Local-Only Sources

- `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-23-lewis-clark-turnaround.md`
  - shared Lewis/Clark coordination note. The load-bearing detail is copied
  here: Cluster D scripts-first is unblocked after the prior stack merged.
- `/Users/mg/Developer/outfitter/trailblazing/plans/fieldwork-loop/coverage-audit-20260523.md`
  - origin of the Fieldwork Loop routing. The load-bearing TRL-780 summary is
  represented by the Linear issue and this packet.

## Copied Or Summarized Sources

- This packet copies the current architectural fact that
  `@ontrails/trails` already ships a `trails` bin on `main`; the executor should
  verify before editing but should not reopen that decision unless it has
  changed.
- This packet summarizes the shared Cluster D recommendation: scripts-first as
  the immediate scaffold runway fix; published-bin work is already present;
  plugin install detection remains TRL-778.

## Tracker Records

- TRL-780 - in-goal issue: scaffolded projects cannot run most framework CLI
  subcommands.
- Fieldwork Loop / Scaffold Runway - Linear project and milestone containing
  TRL-780.
- TRL-778 - related but out of goal: plugin install detection.
- TRL-781 - related but out of goal: scaffold re-run reconciliation.
- TRL-789 - related but out of goal: entity starter CRUD completeness.
- TRL-792 - related but out of goal: Bun runtime docs companion.

## PRs / Branches

- Current base: `main` at or after `14714b858 docs: add beta.15 to beta.18 downstream migration guide (#576)`.
- Execution branch: `trl-780-scaffolded-projects-cant-run-most-framework-cli-subcommands`.
- No PR exists at planning time.

## Prior Plans

- `.agents/plans/2026-05-22-v1-release-readiness-closeout/` - prior active
  release-readiness closeout packet, not a prerequisite for this goal.

## Validation Commands

- `bun test apps/trails/src/__tests__/create.test.ts` - targeted scaffold test
  coverage.
- `bun --cwd apps/trails test` - package test suite for the `trails` app.
- `bun run typecheck` - repo type safety.
- `bun run lint` - repo lint with configured script.
- `bun run format:check` - formatting without direct binary path drift.
- `bun run check` - full repo check when feasible.
- `git diff --check` - whitespace/diff hygiene.
- Generated-project smoke: create a temp app, install, then run
  `bun run survey -- --help` and `bun run warden -- --help` where practical.
