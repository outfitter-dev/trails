# References: Regrade Runway Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo workflow, Graphite, Trails rules, Warden guide, subagent constraints.
- `.agents/plans/PLANNING.md` - goal packet conventions, no `gt absorb`, review protocol, validation ladder.
- `packages/regrade/src/index.ts` - current root export leak for internal child trail/schema harness.
- `packages/regrade/src/literal-transform.ts` - literal Regrade tracer implementation and transformed-input example cast.
- `packages/regrade/src/__tests__/literal-transform.test.ts` - topo/surface proof for parent and internal child trails.
- `packages/regrade/src/__tests__/generated-fixture.test.ts` - package-consumer fixture proof hardened by PR #618.
- `packages/regrade/package.json` - current private package boundary and dependency shape.
- `packages/warden/src/rules/types.ts` - current Warden metadata, guidance, diagnostic, and rule types.
- `packages/warden/src/rules/metadata.ts` - built-in Warden rule metadata registry.
- `packages/warden/src/guide.ts` - Warden guide/manifest projection path.
- `packages/warden/src/cli.ts` and `packages/warden/src/command.ts` - current Warden runner/CLI command paths.
- `docs/adr/README.md` and `docs/adr/drafts/README.md` - ADR authoring locations.

## Adjacent Local Sources

- Trailblazing Regrade planning spine - canonical external planning context summarized in `PLAN.md`; not copied wholesale.

## Prior Plans

- `.agents/plans/2026-05-27-regrade-tracer-stack/` - prior proof stack that landed `TRL-823`, `TRL-819`, `TRL-825`; its retro is evidence for post-tracer follow-ups.
- `.agents/plans/2026-05-27-regrade-framework-seams-stack/` - stale broad packet superseded by this packet because it still gates on old PR #610 and includes TRL-841 handling.
- `.agents/plans/2026-05-28-regrade-downstream-stack/` - narrower downstream-only packet superseded by this larger runway stack.
- `.agents/plans/2026-05-26-radio-compose-proof/` - Radio compose proof context; do not mutate unless the execution needs to cite it in TRL-846 text.

## Tracker Records

| Issue | Status at planning | Branch | Role |
| --- | --- | --- | --- |
| TRL-840 | Backlog | `trl-840-harden-ontrailsregrade-package-boundary-before-public-use` | Regrade package boundary. |
| TRL-843 | Backlog | `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning` | Warden object-form compose/reachability seam. |
| TRL-842 | Backlog | `trl-842-fix-or-document-example-typing-for-transformed-input-schemas` | Transformed-schema example typing. |
| TRL-827 | Backlog | `trl-827-support-downstream-roots-rule-selection-and-coverage` | Parent for downstream root/report/fixture. |
| TRL-844 | Backlog | `trl-844-support-downstream-root-source-collection-for-regrade` | Downstream root source collection. |
| TRL-845 | Backlog | `trl-845-add-regrade-rule-selection-and-coverage-report-shape` | Rule selection and coverage report shape. |
| TRL-846 | Backlog | `trl-846-add-radio-shaped-downstream-regrade-regression-fixture` | Radio-shaped downstream fixture. |
| TRL-830 | Backlog | `trl-830-define-warden-fix-metadata-and-safe-fix-execution` | Parent for Warden fix metadata/safe fix execution. |
| TRL-831 | Backlog | `trl-831-define-the-warden-fix-metadata-contract` | Warden fix metadata contract. |
| TRL-832 | Backlog | `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary` | `term-rewrite` fix metadata. |
| TRL-833 | Backlog | `trl-833-implement-warden-fix-for-safe-source-edits` | Safe `warden --fix`. |
| TRL-834 | Backlog | `trl-834-draft-warden-fix-metadata-adr` | Warden fix metadata ADR. |
| TRL-836 | Backlog | `trl-836-integrate-warden-backed-term-rewrite-regrades` | Regrade consumes Warden metadata. |
| TRL-829 | Backlog | `trl-829-draft-regrade-adr-from-tracer-evidence` | Regrade ADR. |

Completed prerequisites observed:

- `TRL-823` - packed manifest stale beta check.
- `TRL-819` - `ctx.compose(trail, input)` inference without `composeInput`.
- `TRL-825` - literal Regrade transform tracer.
- `TRL-841` / PR #618 - generated-fixture temp handling.

Deferred/out-of-goal:

- `TRL-826` - package-source modes.
- `TRL-828` - public `trails regrade` and `NeedsReview` routing.
- `TRL-835` - `trails warden --help` and hook-integrity package mode triage.
- `TRL-838` - packed manifest integration coverage.

## PRs / Branches

- PR #618 - merged at 2026-05-28T23:26:27Z; merge commit `7cd714ff1ea0efb3ac9b591088932347aebbe1bf`.
- Current branch at planning: `main`.
- Old local branch `trl-841-harden-regrade-generated-fixture-temp-directory-handling` remains in `gt ls` as merged; do not stack on it.

## Validation Commands

- `bun run --cwd packages/regrade typecheck` - Regrade package typecheck.
- `bun test packages/regrade` - Regrade package tests.
- `bun run --cwd packages/regrade lint` - Regrade package lint when source lint is relevant.
- `bun run --cwd packages/core typecheck` - core type surface check for transformed example typing.
- `bun run --cwd packages/warden typecheck` - Warden package typecheck.
- `bun run --cwd packages/warden test` - Warden package tests.
- `bun scripts/adr.ts map` - ADR map generation/check input for ADR branches.
- `bun scripts/adr.ts check` - ADR consistency check.
- `bun run typecheck` - repo typecheck.
- `bun run test` - repo tests.
- `bun run lint` - repo lint.
- `bun run lint:ast-grep` - AST-grep lint gate.
- `bun run format:check` - formatting gate.
- `bun run check` - full repo check.
- `git diff --check` - whitespace and patch sanity.

Run Warden guide sync/check commands if generated Warden or agent guide content
changes:

- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`
