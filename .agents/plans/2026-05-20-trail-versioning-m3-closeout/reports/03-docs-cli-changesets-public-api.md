# Local Review 03: Docs, CLI, Changesets, and Public API

Date: 2026-05-20 10:58 EDT
Reviewer: Codex main agent
Scope: command grammar, generated guidance, changesets, publish dry-run readiness, public exports, and package API boundaries.

## Reviewed Artifacts

- `.changeset/trl-*.md`
- `docs/topo-store.md`
- `docs/surfaces/cli.md`
- `docs/surfaces/http.md`
- `docs/surfaces/mcp.md`
- `AGENTS.md`
- Generated Warden skill guides
- `packages/core/src/index.ts`
- `packages/topographer/src/index.ts`
- `packages/cli/src/command.ts`
- `packages/http/src/build.ts`
- `packages/mcp/src/build.ts`
- `packages/warden/src/index.ts`

## Checks

- Branch-local changesets exist for every package-content branch in the stack: core, topographer, trails app, surface packages, and Warden.
- `bun run warden:agents:sync`, `bun run warden:skills:sync`, `bun run warden:agents:check`, and `bun run warden:skills:check` passed in TRL-120.
- `git diff --check` passed at the stack tip after TRL-120.

## Findings

No P0/P1/P2 findings.

P3 - PR bodies should explicitly explain why `trails revise`, `trails deprecate`, and `trails doctor` are the only lifecycle commands added.
Evidence: ADR-0048 retires the old grammar and the TRL-119 tests assert the stack does not add `trails version`, `trails sunset`, `trails mark`, `trails fork`, or `trails archive`.

P3 - The Warden guide generated rule count changed from 49 to 56.
Evidence: `packages/warden/src/__tests__/trails.test.ts` was updated, and guide sync/check commands passed. PR bodies should mention the generated guide churn so reviewers do not treat it as accidental docs noise.

## Verdict

Docs, CLI grammar, changesets, and public API surfaces are P3-only/clean for draft submission after global gates and publish checks pass.
