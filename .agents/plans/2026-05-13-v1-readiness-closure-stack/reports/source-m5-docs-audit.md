# M5 Docs And Examples V1 Readiness Audit

Date: 2026-05-12
Issue: TRL-636
Branch: `trl-636-audit-docs-and-examples-for-v1-readiness`

## Summary

The docs are directionally current after the TopoGraph vocabulary sweep: active
core docs use `surface`, teach CLI/MCP/HTTP as shipped, describe WebSocket as
planned, and point readers at the current TopoGraph artifact-family names.

There is one high-priority v1-readiness blocker:

- A fresh generated project currently cannot run `bun install` outside the
  monorepo because `@ontrails/commander@^1.0.0-beta.15` returns npm 404.

There are three M5 hygiene gaps that should be handled before v1:

- README snippet verification covers only `packages/tracing/README.md`.
- Relative Markdown link integrity is not gated and several real broken links
  exist.
- Public API `@example` coverage is sparse and ungated, especially on surface
  package entrypoints.

## Inventory

Consumer-facing inventory checked:

| Category | Count | Status |
| --- | ---: | --- |
| Core docs | 8 | Current enough for v1, with fresh-start caveat below |
| Migration docs | 5 | Current; historical retired vocabulary is intentional |
| Package/app/adapter READMEs | 21 | Broadly current, but snippet verification is too narrow |
| Accepted ADRs | 47 | `bun scripts/adr.ts check` passed, but one broken relative link was found |
| Draft ADRs | 11 | Several broken relative links and intentionally stale draft vocabulary |

Core docs checked:

| Doc | Accuracy | Completeness | Recency / Notes |
| --- | --- | --- | --- |
| `docs/getting-started.md` | Partial | Good path shape | Fresh generated install fails on unpublished `@ontrails/commander` |
| `docs/architecture.md` | Good | Good | Shipped/planned surface posture matches current docs |
| `docs/lexicon.md` | Good | Good | Includes current TopoGraph vocabulary and retired vocabulary table |
| `docs/why-trails.md` | Good | Good | WebSocket described as planned, not shipped |
| `docs/testing.md` | Partial | Partial | Describes CLI/MCP harnesses; HTTP harness is still missing from testing package |
| `docs/warden.md` | Good | Good | Current enough; generated Warden guide checks are separate |
| `docs/api-reference.md` | Good | Good | Explicitly says WebSocket has no public package/API yet |
| `docs/index.md` | Good | Good | Surface index correctly marks CLI/MCP/HTTP shipped and WebSocket planned |

Migration docs checked:

| Doc | Accuracy | Completeness | Recency / Notes |
| --- | --- | --- | --- |
| `docs/migration/topograph-artifact-family.md` | Good | Good | Current artifact-family cutover guide |
| `docs/migration/trailhead-to-surface.md` | Good | Good | Historical `trailhead` terms are contextual |
| `docs/migration/layer-evolution.md` | Good | Good | No active blocker found |
| `docs/migration/logging-to-observe.md` | Good | Good | Historical vocabulary is contextual |
| `docs/migration/connector-to-adapter.md` | Good | Good | Explicitly warns against `changeset publish` / `npm publish` |

Package/app/adapter README set checked:

```text
packages/tracing/README.md
packages/logtape/README.md
packages/wayfinder/README.md
packages/core/README.md
packages/config/README.md
packages/permits/README.md
packages/oxlint-plugin/README.md
packages/mcp/README.md
packages/cli/README.md
packages/observe/README.md
packages/testing/README.md
packages/http/README.md
packages/warden/README.md
packages/topographer/README.md
packages/store/README.md
adapters/commander/README.md
adapters/hono/README.md
adapters/vite/README.md
adapters/drizzle/README.md
apps/trails/README.md
apps/trails-demo/README.md
```

README conclusion: the set is discoverable and mostly current, but the only
automated TypeScript snippet coverage is `packages/tracing/README.md`.

ADR set checked:

- Accepted ADRs: 47 numbered docs. `bun scripts/adr.ts check` returned
  `0 errors, 0 warnings`.
- Draft ADRs: 11 docs. Drafts intentionally preserve more speculative and
  historical vocabulary, but broken links should still be fixed or guarded.

## Fresh-Start Smoke

Command:

```bash
tmp=$(mktemp -d /tmp/trails-docs-smoke.XXXXXX)
bun apps/trails/bin/trails.ts create docs-smoke \
  --dir "$tmp" \
  --surfaces cli mcp http \
  --verify \
  --output json
cd "$tmp/docs-smoke"
bun install
```

Scaffold result:

```json
{
  "created": [
    "package.json",
    "tsconfig.json",
    ".gitignore",
    "oxlint.config.ts",
    ".oxfmtrc.jsonc",
    ".trails/.gitignore",
    "src/app.ts",
    "src/trails/hello.ts",
    "src/cli.ts",
    "src/mcp.ts",
    "src/http.ts",
    "__tests__/examples.test.ts",
    "lefthook.yml"
  ],
  "dir": "/tmp/trails-docs-smoke.qHcwkB/docs-smoke",
  "name": "docs-smoke"
}
```

Failure:

```text
bun install v1.3.12 (700fc117)
Resolving dependencies
Resolved, downloaded and extracted [211]
error: GET https://registry.npmjs.org/@ontrails%2fcommander - 404
error: @ontrails/commander@^1.0.0-beta.15 failed to resolve
```

Registry spot checks:

```text
npm view @ontrails/core version --json
"1.0.0-beta.15"

npm view @ontrails/commander version --json
E404 Not Found

npm view @ontrails/hono version --json
"1.0.0-beta.15"
```

Conclusion: the fresh-start path cannot currently get past dependency
installation when the generated project includes the CLI surface.

Follow-up: TRL-707.

## Snippet Verification

Command:

```bash
bun run docs:snippets
```

Output:

```text
$ bun scripts/check-readme-snippets.ts
README snippet typecheck passed for: packages/tracing/README.md
```

Conclusion: the snippet checker works, but its allowlist is too narrow for v1.
It verifies 1 of 21 package/app/adapter READMEs.

Follow-up: TRL-708.

## Relative Link Integrity

Ad hoc scan:

```bash
bun --eval '/* scan relative Markdown links under docs/, packages/, apps/, adapters/ */'
```

Scope: 111 Markdown files, excluding `CHANGELOG.md`.

Real broken links found:

| Source | Broken target | Why it breaks |
| --- | --- | --- |
| `docs/adr/0025-composition-testing.md` | `../../testing.md` | Resolves to missing root `testing.md`; likely intended `../testing.md` |
| `docs/adr/drafts/20260331-direct-invocation.md` | `0027-visibility-and-filtering.md` | Resolves inside `docs/adr/drafts/` instead of accepted ADR path |
| `docs/adr/drafts/20260331-external-trailheads-as-trails.md` | `0027-visibility-and-filtering.md` | Same accepted-ADR path issue |
| `docs/adr/drafts/20260331-pack-resources.md` | `0029-connector-extraction-and-the-with-packaging-model.md` | Resolves inside drafts instead of accepted ADR path |
| `docs/adr/drafts/20260401-compiled-pack-trailhead.md` | `0029-connector-extraction-and-the-with-packaging-model.md` | Same accepted-ADR path issue |
| `docs/adr/drafts/20260409-resource-bundles.md` | `0029-connector-extraction-and-the-with-packaging-model.md` | Same accepted-ADR path issue |
| `docs/adr/drafts/20260401-declarative-search.md` | `20260409-derivetrail-and-trail-factories.md` | Target file does not exist |
| `docs/adr/drafts/20260409-resource-bundles.md` | `20260409-derivetrail-and-trail-factories.md` | Target file does not exist |

The ad hoc scan also produced one false positive in `docs/surfaces/http.md`
from a code snippet containing `app.get(route.path, async (c)`. A production
checker should parse Markdown fences and skip code blocks.

Follow-up: TRL-709.

## Vocabulary Recency

Command:

```bash
rg -n "trailhead|SurfaceMap|_surface\\.json|surface_map|serialized_lock|\\.trails/config/local|\\.trails/trails\\.db|\\.trails/dev/|\\.trails/generated/|npm publish|changeset publish" \
  docs packages apps adapters \
  --glob '*.md' \
  --glob '!**/CHANGELOG.md'
```

Conclusion: active core docs are clean enough. Hits are concentrated in:

- retired-vocabulary tables and migration guides;
- historical release notes;
- accepted ADR history;
- draft ADRs that intentionally preserve old speculative terminology;
- migration snippets showing "before" states.

No new follow-up filed solely for vocabulary drift because TRL-653 and TRL-702
already cover the active TopoGraph/surface cutover guard.

## Public API `@example` Coverage

Command:

```bash
rg -n "@example" packages apps adapters --glob '*.ts'
```

Representative existing examples:

- `packages/core/src/trail.ts`
- `packages/core/src/topo.ts`
- `packages/core/src/run.ts`
- `packages/core/src/contour.ts`
- `packages/core/src/type-utils.ts`
- `packages/testing/src/all.ts`
- `packages/testing/src/context.ts`
- `packages/testing/src/scenario.ts`
- `packages/config/src/define-config.ts`
- `packages/topographer/src/workspace-topos.ts`

Representative missing high-value `@example` coverage:

- `packages/cli/src/index.ts`: `deriveCliCommands`, `deriveFlags`, `output`,
  discovery helpers.
- `packages/http/src/index.ts`: `deriveHttpRoutes`, `deriveHttpMethod`,
  `deriveOpenApiSpec`.
- `packages/mcp/src/index.ts`: `deriveMcpTools`, `surface`, `createServer`,
  `connectStdio`.
- `adapters/commander/src/index.ts`: `surface`, `createProgram`,
  `toCommander`.
- `adapters/hono/src/index.ts`: `surface`, `createApp`.

Conclusion: the project needs a public export inventory and a v1-minimum
example coverage bar rather than ad hoc `@example` additions.

Follow-up: TRL-710.

## Migration Guide Recommendation

Do not consolidate migration docs before v1. The current split is useful:

- `trailhead-to-surface` explains the transport vocabulary cutover.
- `topograph-artifact-family` explains the artifact-family cutover.
- `layer-evolution`, `logging-to-observe`, and `connector-to-adapter` each own a
  distinct historical migration.

Recommended improvement: add a short migration index or table in `docs/index.md`
or `docs/migration/README.md` after the link-integrity checker lands. Do not
merge the guides into one long document.

## Filed Follow-Ups

| Issue | Priority | Purpose |
| --- | --- | --- |
| [TRL-707](https://linear.app/outfitter/issue/TRL-707/fix-fresh-start-install-blocker-for-generated-cli-projects) | High | Fix the fresh generated project install blocker caused by missing `@ontrails/commander` on npm. |
| [TRL-708](https://linear.app/outfitter/issue/TRL-708/expand-readme-typescript-snippet-verification-beyond-tracing) | Medium | Expand README TypeScript snippet verification beyond `packages/tracing/README.md`. |
| [TRL-709](https://linear.app/outfitter/issue/TRL-709/add-markdown-link-integrity-check-for-docs-and-readmes) | Medium | Add a code-fence-aware relative Markdown link integrity check. |
| [TRL-710](https://linear.app/outfitter/issue/TRL-710/create-public-api-example-coverage-inventory-and-gate) | Medium | Create and gate public API `@example` coverage for the v1 minimum surface. |

## Verification Commands

```bash
bun run docs:snippets
bun scripts/adr.ts check
bun run check
bun run format:check
git diff --check
```

`bun run check`, `bun run format:check`, and `git diff --check` are recorded in
the branch retro after this report.
