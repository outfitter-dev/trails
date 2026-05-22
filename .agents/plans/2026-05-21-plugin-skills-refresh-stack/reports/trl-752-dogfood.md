# TRL-752 Dogfood Report

Date: 2026-05-22
Branch: `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke`

## Target

- Plugin version: `0.3.0` from `plugin/.claude-plugin/plugin.json`.
- Bundled `trails` skill target: `metadata.trails.version: 1.0.0-beta.18`.
- Dogfood project: `.trails-tmp/plugin-dogfood/` (cleaned after smoke).
- Package install source: registry install from scaffolded package ranges.

## Scaffold And Install

Command:

```bash
rm -rf .trails-tmp/plugin-dogfood
mkdir -p .trails-tmp
bun run trails create plugin-dogfood --dir .trails-tmp --starter entity --surfaces cli mcp http --json
cd .trails-tmp/plugin-dogfood
bun install
```

Result:

- Scaffold created `package.json`, `src/app.ts`, entity/search/onboard trails, CLI/MCP/HTTP entrypoints, `__tests__/examples.test.ts`, and `lefthook.yml`.
- Registry install succeeded in 2.50s.
- Installed package line:
  - `@ontrails/core`, `@ontrails/cli`, `@ontrails/commander`, `@ontrails/hono`, `@ontrails/http`, `@ontrails/mcp`, `@ontrails/testing`, `@ontrails/warden`: `1.0.0-beta.18`.
  - `zod`: `4.4.3`.

## Raw Scaffold Findings

The raw scaffold was useful but not green without edits:

- `bun run test` passed the generated tests before extra dogfood edits: 10 tests, 16 assertions.
- `bun run typecheck` failed on generated `src/trails/onboard.ts` because `ctx.cross` is optional on `TrailContext`.
- `bun run lint` failed on generated trail examples for `arrow-body-style`, `sort-keys`, and `prefer-spread`.
- `bun run format:check` failed on the fresh scaffold.

Interpretation: plugin guidance now teaches the safer composition/resource style, but the CLI scaffold generator still emits stale shapes. This is not fixed in this branch because `TRL-752` is a dogfood/report branch, but it should be treated as a release-readiness risk before broad plugin promotion.

## Disposable App Repairs For Smoke

To continue the smoke, the disposable app was adjusted locally:

- Changed `entity.onboard` to import the `entity.add` trail object, declare `crosses: [add]`, and guard `ctx.cross` before calling it.
- Added `src/resources/greeting-store.ts` with `resource('store.greetings', { create, mock })`.
- Added `src/trails/greeting.ts` with `resources: [greetingStore]`, input/output schemas, and an example.
- Added the resource module to `topo(...)` so `resource-exists` validation passes.
- Expanded tests to run `testAllEstablished(app)`, `testSurfaceParity(app)`, `createCliHarness()`, `createMcpHarness()`, and `createHttpHarness()`.
- Ran `bun run format:fix`, then manually simplified scaffolded arrow-body returns that Ultracite reported but did not rewrite.

## Smoke Results

Commands after disposable repairs:

```bash
bun run typecheck
bun run test
bun run build
bun run lint
bun run format:check
bun src/cli.ts entity show --input-json '{"id":"1"}'
bun src/cli.ts greeting create --input-json '{"name":"Dogfood"}'
```

Results:

- `bun run typecheck`: passed.
- `bun run test`: passed 17 tests, 34 assertions.
- `bun run build`: passed.
- `bun run lint`: passed, 0 warnings and 0 errors.
- `bun run format:check`: passed.
- CLI surface smoke:
  - `entity show` returned `{ "id": "1", "name": "Example" }`.
  - `greeting create` returned `{ "id": "1", "message": "Hello, Dogfood!", "name": "Dogfood" }`.
- MCP and HTTP surfaces were exercised through `createMcpHarness()` and `createHttpHarness()`.
- `testSurfaceParity(app)` passed across CLI, MCP, and HTTP examples.

## Warden And Topo

Published package command:

```bash
bunx --bun --package @ontrails/trails@1.0.0-beta.18 trails warden --lock cached --no-lock-mutation
```

Result: PASS with 0 errors and 4 warnings:

- `permit.writeWithoutPermit` for `entity.add`.
- `permit.writeWithoutPermit` for `greeting.create`.
- `permit.writeWithoutPermit` for `entity.onboard`.
- `signal-graph-coaching` for unused `entity.updated`.

These warnings are expected for the generated entity starter plus the dogfood write trail. They are actionable teaching material, not blocker errors.

Published `@ontrails/trails@1.0.0-beta.18` did not expose `compile` or `validate` in `bunx --bun --package @ontrails/trails@1.0.0-beta.18 trails --help`; `compile` and `validate` returned `unknown command`.

Current local repo CLI did expose them and passed after compile:

```bash
bun apps/trails/bin/trails.ts compile
bun apps/trails/bin/trails.ts validate
```

Result:

- `compile`: wrote `.trails/trails.lock` and `.trails/topo.lock` with 5 trails, 1 resource, and 1 signal.
- `validate`: passed with matching `committedHash` and `currentHash`, `stale: false`.

Interpretation: plugin docs that mention `trails compile` / `trails validate` match the current repo but are ahead of the currently resolved published CLI. This is aligned with the existing `TRL-758`/`TRL-759` release-channel follow-up risk.

## Plugin Checks

Commands from repo root:

```bash
bun run plugin:metadata:check
bun run plugin:installed-skill:check
```

Results:

- `plugin:metadata:check`: passed.
- `plugin:installed-skill:check`: expected failure on this machine, read-only:
  - `$HOME/.agents/skills/trails` is a drifted copy with 13 file drift items and 5 stale vocabulary hits.
  - `$HOME/.config/claude/skills/trails` is a symlink to that stale copy.
  - `$HOME/.config/codex/skills/trails` is absent and optional.

## Docs Guidance Spot Checks

Confirmed refreshed plugin guidance covers:

- `VersionNotSupportedError` in `plugin/skills/trails/SKILL.md` and `references/error-taxonomy.md`.
- `createHttpHarness()` and `testSurfaceParity()` in HTTP/testing references.
- `unmockable` guidance in testing/common-pitfalls references.
- Hono and Bun-native HTTP guidance in main skill and `references/http-surface.md`.
- Beta-channel evidence via `.changeset/pre.json` (`tag: beta`) and release docs.

## Cleanup

`.trails-tmp/plugin-dogfood/` was removed after the smoke:

```bash
rm -rf .trails-tmp/plugin-dogfood
test ! -e .trails-tmp/plugin-dogfood
```

Result: cleaned. No generated consumer project files are committed.

## Release Readiness Notes

- Plugin bundle dogfood succeeded after repairing disposable app code to match refreshed guidance.
- Raw scaffold output is not yet typecheck/lint/format clean. That is a concrete release-readiness risk for first-run consumer experience.
- Published `@ontrails/trails@1.0.0-beta.18` does not expose `compile`/`validate`, while current repo CLI does. Release docs in `TRL-753` should avoid implying published CLI support until the release path closes that gap.
- Existing follow-ups remain relevant:
  - `TRL-757`: testing root-import/subpath isolation remains deferred.
  - `TRL-758`: Topographer compile/validate workflow and retired topo commands remain deferred but release-relevant.
  - `TRL-759`: beta install/channel policy remains release-relevant.
  - `TRL-760`: beta.15 -> beta.18 migration guide remains deferred.
