# References

## Project Guidance

- `AGENTS.md`
- `.agents/plans/PLANNING.md`
- `.agents/plans/2026-05-28-regrade-runway-stack/`
- `docs/tenets.md`
- `docs/lexicon.md`
- `docs/contributing/code-standards.md`
- `docs/contributing/warden-rules.md`

## Live Stack

- PR #619: `warden-tests-type-hygiene`
- PR #620: `trl-840-harden-ontrailsregrade-package-boundary-before-public-use`
- PR #621: `trl-843-eliminate-regrade-tracer-dead-internal-trail-warden-warning`
- PR #622: `trl-842-fix-or-document-example-typing-for-transformed-input-schemas`
- PR #623: `trl-844-support-downstream-root-source-collection-for-regrade`
- PR #624: `trl-845-add-regrade-rule-selection-and-coverage-report-shape`
- PR #625: `trl-846-add-radio-shaped-downstream-regrade-regression-fixture`
- PR #626: `trl-831-define-the-warden-fix-metadata-contract`
- PR #627: `trl-832-add-term-rewrite-fix-metadata-for-retired-vocabulary`
- PR #628: `trl-833-implement-warden-fix-for-safe-source-edits`

## Known Vocab-Audit Failure

`bun run check` fails at `bun run vocab:audit` before this loop because the allowlist in `scripts/vocab-cutover-map.ts` is stale relative to current `main`.

Known failing matches:

- `surface-term`: `docs/adr/0048-trail-versioning-v3.md:266`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:77`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:78`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:79`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:80`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:81`
- `topograph-artifact-family-retired-term`: `scripts/bootstrap/config.toml:82`

Relevant source:

- `scripts/vocab-cutover-map.ts`
- `scripts/vocab-cutover-audit.ts`
- `docs/adr/0048-trail-versioning-v3.md`
- `scripts/bootstrap/config.toml`

## Primary Review Surfaces

- `packages/regrade/src/index.ts`
- `packages/regrade/src/literal-transform.ts`
- `packages/regrade/src/downstream/collect.ts`
- `packages/regrade/src/downstream/report.ts`
- `packages/regrade/src/downstream/__tests__/`
- `packages/warden/src/fix.ts`
- `packages/warden/src/cli.ts`
- `packages/warden/src/command.ts`
- `packages/warden/src/guide.ts`
- `packages/warden/src/rules/types.ts`
- `packages/warden/src/rules/metadata.ts`
- `packages/warden/src/rules/no-legacy-layer-imports.ts`
- `packages/warden/src/rules/dead-internal-trail.ts`
- `packages/warden/src/__tests__/`
- `apps/trails/src/trails/warden-guide.ts`
- `.changeset/`

## Prior Passing Checks Before This Loop

- `bun run typecheck`
- `bun run lint`
- `bun run format:check`
- `git diff --check main...HEAD`
- `bun run test`
- `bun run lint:ast-grep`
- Focused Regrade/Warden tests:
  - `bun test packages/regrade packages/warden/src/__tests__/fix.test.ts packages/warden/src/__tests__/command.test.ts packages/warden/src/__tests__/cli.test.ts packages/warden/src/__tests__/dead-internal-trail.test.ts packages/warden/src/__tests__/no-legacy-layer-imports.test.ts`
- `bun run build`
- `bun run dead-code`
- `bun run docs:links`
- `bun run warden:agents:check`
- `bun run warden:skills:check`
- `bun run skillset:check`
- `bun run publish:check`

## Forbidden Actions

- No `gt absorb`.
- No merge.
- No merge queue labels.
- No subagent source-control write operations.
