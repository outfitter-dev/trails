# Local Review Round 2: Package And Publish Readiness

Date: 2026-05-16
Stack tip reviewed: `trl-718-docs-close-http-and-observability-wording-before-versioning`

## Scope

- `packages/pino`
- Pino changesets and publish guidance
- Package tarball checks for the full workspace
- Publish-command wording in touched docs

## Findings

### P2 - Fixed: metadata could overwrite stable Pino payload category

`createPinoSink` built the Pino payload with `category` before spreading metadata, so `record.metadata.category` could replace the canonical `record.category` in forwarded logs.

Fix landed on lowest owning branch `TRL-721`:

- `packages/pino/src/index.ts` now spreads metadata first and then writes stable `category` and `timestamp`.
- `packages/pino/src/__tests__/pino.test.ts` covers metadata collisions for `category` and `timestamp`.
- Graphite restacked every descendant branch.

## Follow-up Review Result

No remaining P0/P1/P2 findings in this lane after the fix.

## Package Boundary Checks

- `packages/pino/package.json` declares only the structural peer `@ontrails/observe`; it does not add a hard `pino` runtime dependency.
- `bun.lock` contains the workspace `@ontrails/pino` package entry and no resolved external `pino` dependency.
- Publish guidance uses `bun run publish:check` and `bun run publish:packages`.
- `npm publish` and `changeset publish` appear only in explicit "do not use" guidance.

## Verification

- `bun run --cwd packages/pino test` — pass, 12 tests
- `bun run --cwd packages/pino typecheck` — pass
- `bun run --cwd packages/pino lint` — pass
- `bun run format:check` — pass
- `git diff --check` — pass
- `bun run publish:check` — pass; all public package pack checks passed, including `@ontrails/pino`
