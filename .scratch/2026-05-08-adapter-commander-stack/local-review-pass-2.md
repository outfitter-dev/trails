# Local Review Pass 2

Date: 2026-05-08
Scope: Independent follow-up review after pass-1 fixes and restack.

## Result

No remaining P0/P1/P2 findings.

## Branch-Local Release Gates

All package-affecting branches pass the repo changeset gate:

```text
TRL-661: @ontrails/permits, @ontrails/trails
TRL-662: @ontrails/tracing
TRL-663: @ontrails/drizzle, @ontrails/hono, @ontrails/vite
TRL-664: @ontrails/cli, @ontrails/config, @ontrails/drizzle, @ontrails/hono, @ontrails/http, @ontrails/logging, @ontrails/mcp, @ontrails/observe, @ontrails/store
TRL-665: @ontrails/cli, @ontrails/core, @ontrails/drizzle, @ontrails/hono, @ontrails/http, @ontrails/logtape, @ontrails/mcp, @ontrails/observe, @ontrails/store
TRL-639: @ontrails/cli, @ontrails/commander, @ontrails/trails
TRL-640: @ontrails/trails
```

## Stack-Tip Verification

The final stack tip passed:

```bash
bun scripts/adr.ts map
bun scripts/adr.ts check
bun run typecheck
bun run test
bun run lint
bun run lint:ast-grep
bun run build
bun run format:check
bun run check
bun run publish:check
bun scripts/vocab-cutover-audit.ts --rule connector-term
bun scripts/vocab-cutover-audit.ts --rule legacy-extracted-adapter-subpath
bun run vocab:rewrite -- --list-rules
git diff --check
```

`bun run check` remains a Warden PASS with the existing 23 warnings.

## Residual Classification

`@ontrails/cli/commander` remains only in accepted buckets:

- `docs/migration/connector-to-adapter.md` migration guidance.
- `docs/adr/0029-connector-extraction-and-the-with-packaging-model.md`
  historical ADR context.
- `docs/releases/beta15.md` release history.
- `.agents/plans/v1/**` local historical planning.

`commander.*connector` / `connector.*commander` remains only in accepted ADR and
changelog history. Current-facing Commander guidance teaches
`@ontrails/commander`.

`changeset publish` / `npm publish` appears only as the explicit prohibition in
`docs/migration/connector-to-adapter.md`. No merge-queue wording appears in
current docs, changesets, package manifests, or source.

## Notes

No real publish command was run. No Graphite submit has run yet. No merge queue
label was added.
