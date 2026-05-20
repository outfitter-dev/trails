# References: trail-versioning-m3-closeout

## Tracked / Portable Sources

- `AGENTS.md` - repo workflow, Graphite, Linear, release, Warden, and
  source-control rules.
- `.agents/plans/PLANNING.md` - Trails-specific goal-planning preferences.
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/PLAN.md` - execution
  contract for the next goal.
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/GOAL.md` - pasteable
  goal prompt.
- `.agents/plans/2026-05-20-trail-versioning-m3-closeout/RETRO.md` - running
  and final ledger.
- `docs/adr/0048-trail-versioning-v3.md` - current canonical versioning
  doctrine.
- `docs/adr/0044-trail-versioning.md` - superseded historical doctrine; useful
  only for contrast and migration context.
- `docs/adr/decision-map.json` - generated ADR map that should stay clean after
  ADR commands.
- `docs/lexicon.md` - public terminology alignment.
- `docs/contributing/language-styleguide.md` - language and naming guidance.
- `docs/contributing/warden-rules.md` - Warden contributor guidance.

## Source Areas To Inspect

- `packages/core/src/version-marker.ts` - marker derivation and diagnostics.
- `packages/core/src/version-resolution.ts` - version resolution and narrowing.
- `packages/core/src/execute.ts` - public/internal execution options boundary.
- `packages/core/src/version-runtime.ts` - runtime version resolution substrate.
- `packages/core/src/validate-topo.ts` and
  `packages/core/src/validate-established-topo.ts` - topo validation gates.
- `packages/core/src/transport-error-map.ts` - surface error projection.
- `packages/http/src/` - HTTP surface negotiation/projection.
- `packages/mcp/src/` - MCP tool projection and metadata.
- `packages/cli/src/` - CLI projection/input behavior.
- `apps/trails/src/` - `trails` application command implementation.
- `packages/topographer/src/` - topo graph/lock projections and snapshots.
- `packages/warden/src/` - Warden rule implementation, manifest, trails, and
  generated guidance support.
- `packages/testing/src/` - cross-surface harnesses and example execution.
- `apps/trails-demo/` - realistic examples/fixtures for parity and versioning.

## Untracked / Local-Only Sources

- `.agents/notes/2026-05-19-versioning-reset-v3.md` - historical reset note
  that fed ADR-0048. It is ignored/local-only, so the goal must not depend on
  reading it. The portable summary is in this packet and the canonical doctrine
  is now `docs/adr/0048-trail-versioning-v3.md`.

## Copied Or Summarized Sources

- `PLAN.md` summarizes the relevant M3 issue scope, stack order, non-goals, and
  validation from Linear and ADR-0048.
- `GOAL.md` carries the exact `/goal` prompt so the executor does not need chat
  history.
- `RETRO.md` records planning-time tracker mutations and the context-prime
  script failure.

## Tracker Records

- Linear project `Trail Versioning` - updated during planning to mark M1/M2 as
  landed and M3 as the next stack.
- Linear milestone `M1: Doctrine and CLI namespace` - 100% complete.
- Linear milestone `M2: Authoring, identity, and runtime resolution` - 100%
  complete.
- Linear milestone `M3: Lifecycle, surfaces, and gates` - active goal milestone.
- Linear milestone `M4: Consumer migrations and codemods` - deferred.
- TRL-740 - bottom cleanup branch; added to M3 during planning.
- TRL-117 - deprecation status and surface signals.
- TRL-731 - archive status lifecycle.
- TRL-732 - break detection and graph-only force events.
- TRL-730 - version-aware `trails diff`.
- TRL-118 - surface version negotiation.
- TRL-119 - lifecycle CLI commands.
- TRL-120 - Warden capstone.
- TRL-508 - M4 codemod work; explicitly out of goal.

## PRs / Branches

- PR #532 through PR #538 - merged M1/M2 stack through current `main`.
- PR #531 / `trl-738-add-codex-clark-agent-wiring` - unrelated open PR. Do not
  base this stack on it unless it merges into `main` first.
- Current planning branch:
  `docs/versioning-m1-m2-housekeeping-and-m3-plan`.

## Exact Branch Order

1. `trl-740-chorecore-tighten-trail-versioning-publicinternal-api`
2. `trl-117-add-status-deprecation-metadata-and-surface-signals`
3. `trl-731-featcore-add-archive-status-lifecycle-for-version-entries`
4. `trl-732-feattrails-add-compilevalidate-break-detection-and-force`
5. `trl-730-feattrails-add-version-and-marker-aware-trails-diff`
6. `trl-118-project-version-negotiation-across-http-mcp-cli-and`
7. `trl-119-add-cli-lifecycle-commands-revise-deprecate-and-doctor`
8. `trl-120-add-warden-rules-for-trail-version-entries-and-markers`

## Prior Plans

- `.agents/plans/archive/2026-05-19-trail-versioning-m1-m2/` - archived
  completed M1/M2 packet. It is ignored by Git after archive, so the new packet
  does not rely on it as a source of truth.

## Validation Commands

- `bun scripts/adr.ts map` - regenerates ADR map if needed.
- `bun scripts/adr.ts check` - validates ADR map and references.
- `bun run typecheck` - TypeScript public/internal shape validation.
- `bun run test` - repo test suite.
- `bun run lint` - repo lint.
- `bun run lint:ast-grep` - AST rule validation.
- `bun run build` - package/app build.
- `bun run format:check` - formatting check.
- `bun run check` - aggregate repo gate.
- `bun run publish:check` - Bun-based packaging dry run.
- `bun run warden:agents:sync` - sync generated agent Warden guidance when
  manifest output changes.
- `bun run warden:skills:sync` - sync generated skill Warden guidance when
  manifest output changes.
- `bun run warden:agents:check` - verify generated agent Warden guidance.
- `bun run warden:skills:check` - verify generated skill Warden guidance.
- `git diff --check` - whitespace/conflict marker hygiene.
