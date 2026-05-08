# Legacy Extracted-Adapter Subpath Audit

Date: 2026-05-08
Branch: `trl-641-audit-legacy-extracted-adapter-subpath-transitions-before-v1`

## Scope

This audit checks that the old extracted-adapter subpaths are no longer active
package, source, manifest, scaffold, or current-facing guidance paths before the
Commander cutover stack reaches v1 readiness.

Checked transitions:

| Old path | Current path |
| --- | --- |
| `@ontrails/http/hono` | `@ontrails/hono` |
| `@ontrails/store/drizzle` | `@ontrails/drizzle` |
| `@ontrails/cli/commander` | `@ontrails/commander` |

Intentional public subpaths such as `@ontrails/core/trails`,
`@ontrails/core/patterns`, `@ontrails/store/jsonfile`,
`@ontrails/store/testing`, `@ontrails/permits/testing`, `@ontrails/warden/ast`,
`@ontrails/permits/jwt`, and `@ontrails/tracing/otel` are not legacy extracted
adapter subpaths and stay out of scope.

## Commands

```bash
rg -n "@ontrails/(http/hono|store/drizzle|cli/commander)" apps packages docs README.md .agents .claude --glob "*.ts" --glob "*.tsx" --glob "*.md" --glob "*.json"
rg -n '"\./(hono|drizzle|commander)"|@ontrails/(http/hono|store/drizzle|cli/commander)' package.json packages/*/package.json adapters/*/package.json apps/*/package.json
rg -n "from ['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]|import\(['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]\)" apps packages adapters --glob "*.ts" --glob "*.tsx"
rg -n "@ontrails/(http/hono|store/drizzle|cli/commander)" adapters packages docs README.md .agents .claude --glob "*.md" --glob "*.json"
```

## Result

No active TypeScript imports, dynamic imports, package manifests, or package
exports use the old extracted-adapter subpaths.

Remaining hits are accepted in these buckets:

| Bucket | Paths | Rationale |
| --- | --- | --- |
| Migration guidance | `docs/migration/connector-to-adapter.md`, `adapters/commander/README.md`, `adapters/drizzle/README.md`, `adapters/hono/README.md`, `packages/http/README.md`, `packages/store/README.md` | These blocks explicitly show before/after import paths for users migrating off the old subpaths. |
| Accepted ADR history | `docs/adr/0005-framework-agnostic-http-route-model.md`, `docs/adr/0022-drizzle-store-connector.md`, `docs/adr/0029-connector-extraction-and-the-with-packaging-model.md`, `docs/adr/decision-map.json` | These documents describe historical package-shape decisions. The decision map mirrors ADR source context. |
| Release and changelog history | `docs/releases/beta15.md`, `packages/http/CHANGELOG.md`, `packages/topographer/CHANGELOG.md` | These are versioned historical notes and must preserve the imports that existed at that release boundary. |
| Local planning history | `.agents/notes/**`, `.agents/plans/v1/**` | These are local historical notes/plans, not current package guidance or generated scaffold output. |

## Guardrail Decision

This branch adds the lightweight `legacy-extracted-adapter-subpath` vocab audit
rule because the predicate is narrow and reviewable: the three old extracted
adapter subpaths may appear only in historical or migration-context files.
The audit roots stay aligned with the existing vocab-audit target set. Adapter
package README migration blocks were also reviewed with the explicit `rg`
commands above and are listed in the accepted migration bucket.

The intentionally allowed paths are the same buckets listed above: ADR/release
history, migration docs, package README migration blocks, and local `.agents`
history. The live source/import predicate remains:

```bash
rg -n "from ['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]|import\(['\"]@ontrails/(http/hono|store/drizzle|cli/commander)['\"]\)" apps packages adapters --glob "*.ts" --glob "*.tsx"
```
