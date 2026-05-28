---
created: 2026-05-08T18:14:38Z
updated: 2026-05-08T18:14:38Z
description: Bottom-to-top local review of the Adapter Taxonomy + Commander Cutover stack (TRL-660 through TRL-642). Found and fixed two P1 changeset failures on TRL-663 and TRL-661. Records evidence commands, accepted residuals, and confirms no remaining P0/P1/P2 findings after fixes.
references: []
linear:
  - TRL-638
  - TRL-639
  - TRL-640
  - TRL-641
  - TRL-642
  - TRL-660
  - TRL-661
  - TRL-662
  - TRL-663
  - TRL-664
  - TRL-665
impl_status: implemented
---

# Local Review Pass 1

- **Date:** 2026-05-08
- **Scope:** Bottom-to-top review of the Adapter Taxonomy + Commander Cutover stack.

## Lanes Reviewed

- Taxonomy/API: TRL-660, TRL-661, TRL-662, TRL-664.
- Guardrail/audit: TRL-665, TRL-641, TRL-642.
- Commander package: TRL-638, TRL-639, TRL-640.
- Release/package metadata: branch-local changesets, package exports, package manifests, and publish discipline.

## Findings

### P1 - TRL-663 missing changesets for moved adapter workspaces

The branch-local changeset gate failed for TRL-663:

```text
Package-affecting changes need changeset entries for: @ontrails/drizzle, @ontrails/hono, @ontrails/vite
Affected packages: @ontrails/drizzle, @ontrails/hono, @ontrails/vite
```

Fix applied on TRL-663: added `.changeset/adapter-workspace-root.md` covering `@ontrails/drizzle`, `@ontrails/hono`, and `@ontrails/vite` as patch metadata for the workspace-root move.

Verification after fix:

```text
Changeset gate passed for: @ontrails/drizzle, @ontrails/hono, @ontrails/vite
Changed changesets: .changeset/adapter-workspace-root.md
```

### P1 - TRL-661 missing changeset coverage for `@ontrails/trails`

The branch-local changeset gate failed for TRL-661 because the branch updates `@ontrails/trails` source while the changeset only named `@ontrails/permits`:

```text
Package-affecting changes need changeset entries for: @ontrails/trails
Affected packages: @ontrails/permits, @ontrails/trails
Changed changesets: .changeset/permits-connector-to-adapter.md
```

Fix applied on TRL-661: updated `.changeset/permits-connector-to-adapter.md` to include `@ontrails/trails` patch metadata and explain the generated auth-resource config update to the new `adapter` discriminant.

Verification after fix:

```text
Changeset gate passed for: @ontrails/permits, @ontrails/trails
Changed changesets: .changeset/permits-connector-to-adapter.md
```

## Additional Checks

No remaining P0/P1/P2 findings after the fixes above.

Evidence commands:

```bash
rg -n "AuthConnector|authConnector|JwtConnector|createJwtConnector|OtelConnector|createOtelConnector|StoreConnectorOptions" packages adapters apps scripts --glob "*.ts" --glob "!**/CHANGELOG.md"
rg -n "@ontrails/cli/commander|from ['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]|import\(['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]\)" apps packages adapters scripts --glob "*.ts" --glob "*.tsx" --glob "*.json"
rg -n "connectors/|workspace:connectors|\"connectors/|src/connectors|/connectors" package.json bun.lock README.md apps packages adapters scripts docs .github .ast-grep --glob "!**/CHANGELOG.md" --glob "!.scratch/**"
rg -n "changeset publish|npm publish|merge queue|merge-queue|merge_queue" .changeset docs README.md packages apps adapters --glob "*.md" --glob "*.json"
rg -n "\./commander|@ontrails/cli/commander" packages/cli/package.json packages/cli/src adapters/commander apps packages --glob "*.json" --glob "*.ts"
```

Accepted residuals:

- `AuthConnector` fixtures remain only in Oxlint guardrail tests.
- `connectors/` residuals are migration docs, ADR history, or guardrail predicates/fixtures.
- `changeset publish` / `npm publish` appears only as explicit prohibition in `docs/migration/connector-to-adapter.md`.
- No active `@ontrails/cli/commander`, `@ontrails/http/hono`, or `@ontrails/store/drizzle` imports remain in source.
