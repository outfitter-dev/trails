---
created: "2026-05-26T22:32:21Z"
updated: "2026-05-26T22:32:21Z"
description: Source map for the fieldwork compounding stack. Lists doctrine files, Linear issue IDs and roles, a live state snapshot capturing main head and dirty state at planning time, per-issue code anchors (resource.ts, Warden rules, create.ts, project-writes.ts), a TRL-816 audit seed list of files with cross residue, Radio lane context, and verification commands.
linear:
  - TRL-782
  - TRL-784
  - TRL-787
  - TRL-802
  - TRL-804
  - TRL-781
  - TRL-789
  - TRL-816
  - TRL-814
impl_status: partial
references:
  - docs/adr/0000-core-premise.md
  - docs/tenets.md
  - docs/adr/0001-naming-conventions.md
  - docs/lexicon.md
  - docs/architecture.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - packages/core/src/resource.ts
  - packages/core/src/__tests__/service-config.test.ts
  - packages/core/src/type-checks.test-d.ts
  - docs/resources.md
  - apps/trails/src/trails/load-app.ts
  - apps/trails/src/trails/create.ts
  - apps/trails/src/trails/create-scaffold.ts
  - apps/trails/src/project-writes.ts
  - apps/trails/src/__tests__/create.test.ts
  - packages/warden/src/rules/incomplete-crud.ts
  - .claude/skills/trails-adrs/SKILL.md
  - .agents/skills/trails-adrs/SKILL.md
  - plugin/README.md
---

# References: Fieldwork Compounding Stack

## Doctrine

- `docs/adr/0000-core-premise.md` - contract-first source of truth; author what's new, derive what's known, override what's wrong.
- `docs/tenets.md` - schema always exists, one write many reads, drift guard, evaluation hierarchy.
- `docs/adr/0001-naming-conventions.md` - compose cutover log and API grammar.
- `docs/lexicon.md` - current compose/resource/surface/topo vocabulary.
- `docs/architecture.md` - surface import and shared execution pipeline context.
- `AGENTS.md` - repo workflow, Graphite, subagent, review, and validation rules.
- `.agents/plans/PLANNING.md` - goal packet, review, source-control, and validation discipline.

## Linear

- `TRL-782` - `resource<T>(...)` does not flow `config` schema inferred type into `create`'s `ctx.config`.
- `TRL-804` - Warden warning for topo-export entry opening a surface at module top level.
- `TRL-781` - `trails create` errors hard on rerun instead of reconciling.
- `TRL-789` - entity starter should complete CRUD coverage.
- `TRL-816` - post-compose current-facing straggler cleanup.
- `TRL-814` - Radio compose migration follow-up.
- `TRL-784` - parent compose cutover record.
- `TRL-787` and `TRL-802` - likely duplicate/superseded guidance issues to inspect during `TRL-816`.

## Live State Snapshot

Captured 2026-05-26 around 13:30 EDT:

- Main checkout: `/Users/mg/Developer/outfitter/trails`
- `origin/main` / `main` head: `1eb5bdc06 feat: rename trail composition API to compose (#596)`
- Open GitHub PRs: none.
- Graphite stack: `main` only.
- Known dirty state on main: `D scripts/import-scratch-to-notion.ts`.
- Created tracker item: `TRL-816` with branch `trl-816-post-compose-cutover-cleanup-fix-current-facing-stragglers`.

## TRL-782 Code Anchors

- `packages/core/src/resource.ts`
  - `ResourceContext<C = unknown>`
  - `ResourceSpec<T, C = unknown>`
  - `Resource<T> extends ResourceSpec<T>` currently erases config generic.
  - `resource = <T>(id: string, spec: ResourceSpec<T>): Resource<T>` currently has only one generic.
- `packages/core/src/__tests__/service-config.test.ts`
  - runtime config behavior and current manual `ResourceContext<{...}>` annotations.
- `packages/core/src/type-checks.test-d.ts`
  - compile-time assertion home.
- `docs/resources.md`
  - resource config documentation if public type examples need adjustment.

## TRL-804 Code Anchors

- `apps/trails/src/trails/load-app.ts`
  - `tryLoadFreshAppLease()` imports real app entries for introspection.
- `apps/trails/src/trails/survey.ts`, `guide.ts`, `compile.ts`, `topo.ts`, `run.ts`
  - commands that depend on app import behavior.
- `packages/warden/src/rules/`
  - rule implementation patterns.
- `packages/warden/src/rules/index.ts`, `metadata.ts`, generated guide blocks
  - registration and docs paths.
- `packages/warden/src/__tests__/`
  - rule test patterns.

## TRL-781 / TRL-789 Code Anchors

- `apps/trails/src/trails/create.ts`
  - top-level `trails create` trail and compose flow.
- `apps/trails/src/trails/create-scaffold.ts`
  - starter content generation, including `generateEntityTrails()`.
- `apps/trails/src/project-writes.ts`
  - write helpers and overwrite behavior.
- `apps/trails/src/__tests__/create.test.ts`
  - scaffold and rerun behavior tests.
- `packages/warden/src/rules/incomplete-crud.ts`
  - entity starter acceptance target.

## TRL-816 Audit Seeds

From Clark's post-PR #596 audit, verify before editing because line numbers may drift:

- `docs/api-reference.md` reserved/dead `validateCross`-style names.
- `docs/adr/0018-signal-driven-governance.md` example using `conn.crossings`.
- `docs/adr/0009-first-class-resources.md` example step using `createCross`.
- `docs/adr/0023-simplifying-the-trails-lexicon.md` runtime verbs list.
- `docs/adr/0006-shared-execution-pipeline.md` prose mentioning cross capability.
- `docs/adr/0010-native-infrastructure.md` prose mentioning crossing declarations.
- `docs/adr/0015-topo-store.md` SQL comment/prose around trail crossings.
- `.claude/skills/trails-adrs/SKILL.md` and `.agents/skills/trails-adrs/SKILL.md` vocabulary line.
- `plugin/README.md` lexicon summary.
- Cosmetic local identifiers in `packages/core/src/execute.ts`, `packages/warden/src/rules/ast.ts`, `packages/tracing/src/__tests__/intrinsic-tracing.test.ts`, and `apps/trails-demo/__tests__/onboard.test.ts`.

Do not rewrite frozen release history, from-state migrations, generated historical survey snapshots, or clearly legacy references.

## Radio Lane

- Radio repo path: `/Users/mg/Developer/outfitter/radio`
- Previously observed dirty files: `src/trails/ensure-project.ts`, `src/trails/reply.ts`, `src/trails/transmit.ts`.
- Previously observed dependency range: `@ontrails/*` `^1.0.0-beta.18`.
- Radio source-control mutation requires explicit lane approval.

## Verification Commands

Base:

```bash
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run format:check
git diff --check
bun run check
```

Docs/guidance:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run vocab:audit
bun run warden:agents:sync
bun run warden:skills:sync
bun run warden:agents:check
bun run warden:skills:check
```

Scaffold:

```bash
bun test apps/trails/src/__tests__/create.test.ts
```

Use focused package tests first, then broaden as branches stabilize.
