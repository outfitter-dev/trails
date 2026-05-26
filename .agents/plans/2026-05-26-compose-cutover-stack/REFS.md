# References: Compose Cutover Stack

## Tracker

- `TRL-784`: parent cutover issue, `cross` / `crosses` -> `composite trail` / `composes` / `ctx.compose`.
- `TRL-783`: Radio-discovered type bug; folded into S1 execution but retained as provenance.
- `TRL-809`: S1 core API + type rename; execution branch for `TRL-783` fold-in.
- `TRL-810`: S2 persistence migration.
- `TRL-811`: S3 Warden rules + recognition matchers.
- `TRL-812`: S4 docs, lexicon, tenets, migration guide.
- `TRL-813`: S5 scaffold templates.
- `TRL-814`: S6 codemod + Radio migration.
- Done blockers: `TRL-785`, `TRL-786`, `TRL-791`.

## Doctrine / Decision Sources

- `docs/adr/0049-composition-is-compose-not-cross.md`
  - Lines 58-80 define the compose family and type-family rename.
  - Lines 101-108 define sequencing and explicitly allow landing `TRL-783` first or folding it into the cutover.
- `docs/adr/0000-core-premise.md`
- `docs/tenets.md`
- `docs/adr/0001-naming-conventions.md`
- `docs/lexicon.md`
- `docs/architecture.md`

## Current Code Evidence

- `packages/core/src/types.ts`
  - `Implementation<I, O>` currently takes plain `TrailContext`.
  - `CrossFn` currently has typed trail-object overload intended to return `Result<TrailOutput<T>, Error>`.
  - `TrailContext.cross` is currently optional.
- `packages/core/src/trail.ts`
  - `TrailSpec.blaze` currently uses `Implementation<BlazeInput<I, CI>, O>`.
  - `TrailSpec.crosses` is still the declaration field.
- `apps/trails/src/trails/create.ts`
  - `createTrail` declares `crosses` but still guards for missing `ctx.cross`; this is a first-party example of the `TRL-783` unhappy path.

## Planning Context

- Packet location: `.agents/plans/2026-05-26-compose-cutover-stack/`
- Main checkout: `/Users/mg/Developer/outfitter/trails`
- Detached Codex worktree used for planning only: `/Users/mg/.config/codex/worktrees/0f7f/trails`
- Main checkout had unrelated untracked file during planning: `scripts/import-scratch-to-notion.ts`; do not touch unless Matt explicitly redirects.
- Planning convention: `.agents/plans/PLANNING.md`.

## Prior Decision

Matt approved folding `TRL-783` into the compose cutover instead of fixing `ctx.cross` first and immediately renaming it. Lewis recommendation: `TRL-809` owns execution; `TRL-783` remains provenance and closes with the S1 PR.

## Validation Commands

Baseline repo gates:

```bash
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run format:check
git diff --check
bun run check
```

ADR/doc gates:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
```

Generated Warden/agent guide gates:

```bash
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

## External Repo Note

`TRL-814` references Radio as the only downstream consumer. Treat `/Users/mg/Developer/outfitter/radio` as an external repo: inspect first, mutate only if safe, and stop before source-control writes there unless Matt has approved that lane.
