# Local Review 01: Lifecycle and Surfaces

Date: 2026-05-20 10:58 EDT
Reviewer: Codex main agent
Scope: deprecation status, archive lifecycle, version negotiation across shipped surfaces, archived exclusion, and error/status projection.

## Reviewed Artifacts

- `packages/core/src/trail.ts`
- `packages/core/src/surface-versioning.ts`
- `packages/core/src/execute.ts`
- `packages/core/src/version-resolution.ts`
- `packages/cli/src/build.ts`
- `packages/http/src/build.ts`
- `packages/mcp/src/build.ts`
- `apps/trails/src/trails/revise.ts`
- `apps/trails/src/trails/deprecate.ts`
- `apps/trails/src/trails/doctor.ts`
- `apps/trails/src/trails/version-lifecycle-support.ts`
- `apps/trails/src/__tests__/version-lifecycle.test.ts`
- Surface docs in `docs/surfaces/*.md`

## Checks

- `bun test apps/trails/src/__tests__/version-lifecycle.test.ts apps/trails/src/__tests__/survey.test.ts` passed earlier in TRL-119 with 57 pass.
- `bun test packages/cli/src/__tests__/build.test.ts packages/http/src/__tests__/build.test.ts packages/mcp/src/__tests__/build.test.ts packages/core/src/__tests__/version-execution.test.ts` passed earlier in TRL-118 with 211 pass.
- `bun run --cwd apps/trails typecheck` passed earlier in TRL-119.
- `bun run --cwd apps/trails lint` passed earlier in TRL-119 with 0 warnings, 0 errors.

## Findings

No P0/P1/P2 findings.

P3 - WebSocket remains explicitly outside implementation because there is no shipped WebSocket package/API in the repo.
Evidence: surface negotiation is implemented for `cli`, `http`, and `mcp`; `survey surfaces` already reports WebSocket as planned/excluded. This is documented in `RETRO.md` and should be called out in PR bodies for TRL-118.

P3 - `apps/trails/src/trails/version-lifecycle-support.ts` is now a large source-rewrite helper.
Evidence: the file owns scanning, target parsing, property scanning, source insertion, lifecycle app loading, and doctor summaries. It is acceptable for this stack because tests cover the command grammar and rewrites, but it should be split if lifecycle source editing grows again.

## Verdict

Lifecycle and shipped surface behavior is P3-only/clean for draft submission after global gates pass.
