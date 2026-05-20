# Local Review 02: Diff, Gates, and Warden

Date: 2026-05-20 10:58 EDT
Reviewer: Codex main agent
Scope: break classifier, compile force gate, graph-only force events, version-aware diff semantics, and Warden versioning rules.

## Reviewed Artifacts

- `packages/topographer/src/diff.ts`
- `packages/topographer/src/forces.ts`
- `packages/topographer/src/types.ts`
- `apps/trails/src/trails/compile.ts`
- `apps/trails/src/trails/survey.ts`
- `packages/warden/src/rules/trail-versioning-source.ts`
- `packages/warden/src/rules/trail-versioning-topo.ts`
- `packages/warden/src/cli.ts`
- `packages/warden/src/trails/schema.ts`
- Generated Warden guide files in `AGENTS.md`, `.claude/skills/clark/references/warden-guide.md`, and `plugin/skills/trails/references/warden-guide.md`

## Checks

- `bun test packages/topographer/src/__tests__/diff.test.ts apps/trails/src/__tests__/survey.test.ts` passed earlier in TRL-730 with 79 pass.
- `bun test apps/trails/src/__tests__/survey.test.ts packages/topographer/src/__tests__/diff.test.ts packages/topographer/src/__tests__/derive.test.ts` passed earlier in TRL-732 with 110 pass.
- `bun test packages/warden/src/__tests__/trail-versioning-rules.test.ts packages/warden/src/__tests__/warden-rule-metadata.test.ts packages/warden/src/__tests__/trails.test.ts packages/warden/src/__tests__/guide.test.ts` passed in TRL-120 with 166 pass.
- `bun run --cwd packages/warden typecheck`, `bun run --cwd packages/warden lint`, `bun run lint:ast-grep`, `bun run warden:agents:check`, and `bun run warden:skills:check` passed in TRL-120.

## Findings

No P0/P1/P2 findings.

P3 - Baseline/telemetry-dependent Warden rules are not fully enforceable with the current runner input.
Evidence: TRL-120 implemented enforceable current-runner rules for `deprecation-without-guidance`, `fork-without-preserved-blaze`, `version-gap`, `version-pinned-cross`, `version-without-examples`, `pending-force`, and `marker-schema-unsupported`. The branch also added optional `TopoGraph` input for graph-only force annotations. Rules that need a previous committed graph comparison or runtime traffic data still need a future runner/config seam. This is recorded in `RETRO.md` before draft submission.

P3 - `pending-force` currently depends on callers supplying a precomputed annotated `TopoGraph` when graph-only force entries matter.
Evidence: live `Topo` derivation cannot carry compile-time `forces[]` because those entries are graph artifact annotations, not runtime trail fields. The optional graph input keeps that debt visible without inventing a parallel runner.

## Verdict

Diff/gate/Warden behavior is P3-only/clean for draft submission after global gates pass.
