---
created: 2026-05-08T18:14:38Z
updated: 2026-05-08T18:14:38Z
description: Final verification checklist for TRL-642, closing the Commander cutover stack after TRL-638–641. Records accepted residual buckets for @ontrails/cli/commander references, confirms no real publish or merge-queue label was applied, and lists all passing verification commands at stack tip.
references:
  - docs/migration/connector-to-adapter.md
  - docs/adr/0029-connector-extraction-and-the-with-packaging-model.md
  - docs/releases/beta15.md
  - .agents/plans/v1
linear:
  - TRL-638
  - TRL-639
  - TRL-640
  - TRL-641
  - TRL-642
impl_status: implemented
---

# Final Commander Migration Verification

Date: 2026-05-08
Issue: TRL-642
Branch: `trl-642-final-verification-ontrailscommander-migration-complete`

## Scope

This closes the local Commander cutover stack after TRL-638, TRL-639, TRL-640,
and TRL-641 are present underneath this branch.

## Active State

- Active source imports use `@ontrails/commander`.
- Active docs, scaffold output, app packages, and plugin references teach
  `@ontrails/commander`.
- `@ontrails/cli` no longer exports a `./commander` subpath.
- `@ontrails/commander` owns the Commander runtime adapter package under
  `adapters/commander`.
- There is no `@ontrails/cli/commander` compatibility alias or package-export
  bridge.

## Accepted Residuals

`rg -n "@ontrails/cli/commander" apps packages docs README.md .agents .claude --glob "*.ts" --glob "*.tsx" --glob "*.md" --glob "*.json"`
returns only these accepted buckets:

| Bucket | Paths | Reason |
| --- | --- | --- |
| Migration guidance | `docs/migration/connector-to-adapter.md` | Shows the before/after Commander import and states there is no long-lived compatibility subpath. |
| Accepted ADR history | `docs/adr/0029-connector-extraction-and-the-with-packaging-model.md` | Records the pre-split adapter subpath and the beta.16 move to `@ontrails/commander`. |
| Release history | `docs/releases/beta15.md` | Preserves beta.15 guidance and explicitly says the beta.16 split moves to `@ontrails/commander`. |
| Local planning history | `.agents/plans/v1/**` | Historical local plans, not current package guidance or scaffold output. |

`rg -ni "commander.*connector|connector.*commander" apps packages docs README.md .agents .claude --glob "*.md" --glob "*.ts" --glob "*.tsx"`
returns only ADR/changelog history, not current-facing Commander package
guidance.

## Publishing And Merge Safety

- Changesets in this stack are version/changelog metadata only.
- `bun run publish:check` is the package verification command used here.
- No real publish was run.
- No PR or local command added a merge queue label.
- The only `changeset publish` / `npm publish` wording in current docs is the
  explicit prohibition in `docs/migration/connector-to-adapter.md`.

## Verification Commands

The following commands passed at the stack tip after this file was added:

```bash
rg -n "@ontrails/cli/commander" apps packages docs README.md .agents .claude --glob "*.ts" --glob "*.tsx" --glob "*.md" --glob "*.json"
rg -ni "commander.*connector|connector.*commander" apps packages docs README.md .agents .claude --glob "*.md" --glob "*.ts" --glob "*.tsx"
bun scripts/vocab-cutover-audit.ts --rule legacy-extracted-adapter-subpath
bun scripts/vocab-cutover-audit.ts --rule connector-term
bun run vocab:rewrite -- --list-rules
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run publish:check
git diff --check
```
