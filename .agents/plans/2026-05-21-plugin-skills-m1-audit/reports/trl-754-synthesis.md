# TRL-754 Synthesis And Execution Stack

Date: 2026-05-21
Branch: `trl-754-synthesize-plugin-audits-into-an-executable-refresh-stack`
Scope: synthesize `TRL-745`, `TRL-742`, `TRL-743`, and `TRL-744` into an exact M2/M3/M4 implementation stack and tracker refresh.

## Executive Summary

M1 confirms the Trails plugin/skills ecosystem should be refreshed through an audit-first stack, not by editing everything at once. The repo plugin source is the right canonical source, but it is incomplete against current package/API/doctrine facts and it is not what the local global skill paths currently expose.

The implementation stack should proceed in this order:

1. `TRL-746` refreshes the main `trails` skill entrypoint so first-load guidance is correct and concise.
2. `TRL-747` refreshes deep references, templates, and examples from source-backed package/API facts.
3. `TRL-748` refreshes non-main skill surfaces: agent profile, rules, advisory skills, and hook copy.
4. `TRL-749` defines plugin metadata policy and adds sync/check commands.
5. `TRL-750` adds a check-first installed skill drift path for local agents/Claude/Codex skill roots.
6. `TRL-751` improves Claude plugin hook detection and guidance, consuming metadata/drift checks without mutating global skill paths.
7. `TRL-752` dogfoods the refreshed bundle in a fresh consumer project.
8. `TRL-753` documents and executes the release/republish path when M2/M3/M4 gates are green.

New follow-up issue created:

- `TRL-755` - refresh adjacent public-docs drift found during the plugin audit. This keeps public README/API cleanup out of the plugin-only implementation stack while preserving the finding.
  URL: <https://linear.app/outfitter/issue/TRL-755/refresh-public-docs-drift-found-during-plugin-skills-audit>

## Source Reports

- `TRL-745`: `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md`
- `TRL-742`: `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md`
- `TRL-743`: `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md`
- `TRL-744`: `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md`

## Finding To Owner Map

| Finding | Severity | Evidence source | Owner |
| --- | --- | --- | --- |
| Main skill only shows Hono for HTTP and omits `@ontrails/http/bun` | P2 | `TRL-745`, `TRL-742` | `TRL-746`, `TRL-747` |
| Main skill/package orientation omits `pino`, `wayfinder`, and complete package taxonomy | P2 | `TRL-745` | `TRL-746`, `TRL-747` |
| Error taxonomy copies omit `VersionNotSupportedError` | P1 | `TRL-742` | `TRL-747`; public docs follow-up `TRL-755` |
| Active plugin architecture says surface map instead of `TopoGraph`/lock terminology | P1 | `TRL-742` | `TRL-747`; public docs follow-up `TRL-755` |
| Resource guidance omits `ResourceContext.config` and `unmockable` | P1 | `TRL-742` | `TRL-747`, with `plugin/rules/patterns.md` copy in `TRL-748` if needed |
| Testing reference omits `expectedMatch`, `createHttpHarness`, and `testSurfaceParity` | P2 | `TRL-745`, `TRL-742` | `TRL-747` |
| Composition template teaches string-generic crossing and `Promise.all` fan-out | P2 | `TRL-742` | `TRL-747` |
| `trail-engineer` uses stale Warden diagnostic names | P2 | `TRL-742` | `TRL-748` |
| Clark calibration maps annotations/tags to `metadata` instead of `meta` | P2 | `TRL-742` | `TRL-748` |
| Installed global `/Users/mg/.agents/skills/trails` is stale and Claude path symlinks to it | P1 | `TRL-743` | `TRL-750`, release docs in `TRL-753` |
| Plugin version metadata policy is undefined (`0.3.0` plugin vs `1.0.0-beta.18` framework target) | P1 | `TRL-743`, `TRL-744` | `TRL-749` |
| Hook startup copy can resolve to stale global `trails` skill, only greps root `package.json`, and has stale `blaze:` install wording | P1/P2 | `TRL-744`, `TRL-742`, `TRL-743` | `TRL-748` copy, `TRL-751` behavior, `TRL-750` drift check, `TRL-753` precedence |
| Hook lacks Warden nudge/version guidance/Codex parity statement | P2/P3 | `TRL-744` | `TRL-751`, with `TRL-749` and `TRL-750` dependencies |
| Getting-started says `topo()` builds a collection | P3 | `TRL-742` | `TRL-747` |

## Recommended Stack

### M2 Branch 1: `TRL-746`

Branch: `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop`

Purpose: make `plugin/skills/trails/SKILL.md` the accurate first-load briefing.

File targets:

- `plugin/skills/trails/SKILL.md`

Required updates:

- Keep first-screen flow: `trail()` -> `blaze` -> `topo()` -> `surface()` -> `run()` -> `testAll()`.
- Qualify WebSocket as planned, not shipped, mirroring `README.md:7` and `README.md:131`.
- Teach HTTP as Hono plus Bun-native `@ontrails/http/bun` over the shared `@ontrails/http` route/fetch kernel.
- Add a compact package orientation that names current package groups and routes details to references.
- Include `@ontrails/pino` and shell-only `@ontrails/wayfinder` without implying nonexistent wayfinder trails.
- Mention `createHttpHarness()` and `testSurfaceParity()` in the testing paragraph.
- Keep `metadata.trails.version: 1.0.0-beta.18` unchanged in M2. `TRL-749` is the sole owner for later metadata policy changes or restack follow-up.

Acceptance criteria:

- No active `trailhead`, connector, or transport vocabulary appears in first-screen guidance.
- Main skill references current package/source maps from `TRL-745`.
- Main skill routes deep content to reference files rather than becoming a long manual.
- `bun run warden:skills:check`, `bun run format:check`, and `git diff --check` pass.

### M2 Branch 2: `TRL-747`

Branch: `trl-747-refresh-trails-skill-references-templates-and-examples`

Purpose: update deep skill references, templates, and examples so agents can execute from them without rediscovering the audit.

File targets:

- `plugin/skills/trails/references/architecture.md`
- `plugin/skills/trails/references/getting-started.md`
- new `plugin/skills/trails/references/http-surface.md`
- `plugin/skills/trails/references/contract-patterns.md`
- `plugin/skills/trails/references/testing-patterns.md`
- `plugin/skills/trails/references/error-taxonomy.md`
- `plugin/skills/trails/references/common-pitfalls.md`
- `plugin/skills/trails/references/migration-checklist.md`
- `plugin/skills/trails/templates/*.md`
- `plugin/skills/trails/examples/*.md`

Required updates:

- Rebuild architecture package table from `docs/architecture.md` and package export maps.
- Replace active surface-map wording with `TopoGraph`, `TopoGraphEntry`, lock manifest, and `topo.lock`.
- Add HTTP reference covering `deriveHttpRoutes`, `deriveOpenApiSpec`, `@ontrails/http/fetch`, `@ontrails/http/bun`, and Hono.
- Refresh getting-started install guidance for CLI, MCP, Hono HTTP, Bun-native HTTP, and testing.
- Add `VersionNotSupportedError` to plugin error taxonomy and avoid hand-counting classes when owner-derived wording is safer.
- Add `ResourceContext.config` and `unmockable: { reason }`.
- Add `expectedMatch`, `createHttpHarness()`, and `testSurfaceParity()`.
- Prefer trail-object `crosses` and typed `ctx.cross(trail, input)` where in scope; keep string IDs as an escape hatch.
- Replace `Promise.all([ctx.cross(...)])` examples with batch `ctx.cross([...])` where the example is intended to teach concurrent crossing.
- Add HTTP/Bun example coverage or update existing migration examples to show an HTTP surface.

Acceptance criteria:

- All examples import current package names.
- No current-facing reference calls topo a collection except in explicit historical contrast.
- Snippets/docs checks pass where available; otherwise document what was manually verified.
- `bun run warden:skills:check`, `bun run format:check`, and `git diff --check` pass.

### M2 Branch 3: `TRL-748`

Branch: `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook`

Purpose: make non-main plugin guidance match current doctrine after the main skill and references are refreshed.

File targets:

- `plugin/agents/trail-engineer.md`
- `plugin/rules/lexicon.md`
- `plugin/rules/patterns.md`
- `plugin/hooks/detect-trails.sh` message text only
- `plugin/skills/trails-*/*`
- `.claude/skills/clark/references/calibrate.md`
- generated Clark/Codex wrapper only through existing sync command if required

Required updates:

- Replace stale Warden labels with current manifest IDs or point to generated Warden guide instead of copying names.
- Update resource copy that omits `config` or `unmockable`.
- Update Clark calibration from `metadata` to `meta` for the trail field.
- Replace hook `blaze:` command wording with plain shell-command guidance.
- Rewrite the SessionStart "Load the `trails` skill" wording so it names repo-bundled/current skill context where possible and does not silently route agents to stale global guidance.
- Keep hook behavior changes for `TRL-751`; this branch should only adjust copy unless tests force tiny behavior-safe cleanup.

Acceptance criteria:

- `bun run warden:agents:check`, `bun run clark:check`, `bun run warden:skills:check`, `bun run format:check`, and `git diff --check` pass.
- Hook message remains concise and non-mutating.

### M3 Branch 4: `TRL-749`

Branch: `trl-749-add-plugin-metadata-sync-and-drift-checks`

Purpose: define and enforce metadata policy before hooks warn about drift.

File targets:

- `.claude-plugin/marketplace.json`
- `plugin/.claude-plugin/plugin.json`
- `plugin/skills/trails/SKILL.md`
- `package.json` scripts if adding check/sync commands
- proposed script: `scripts/sync-plugin-metadata.ts`
- proposed tests: `scripts/__tests__/sync-plugin-metadata.test.ts`
- proposed package scripts: `plugin:metadata:check` and `plugin:metadata:sync`

Required updates:

- Decide whether plugin semver is independent from Trails framework target version.
- If independent, expose both clearly: plugin version and `metadata.trails.version`.
- Add a check command that fails on policy violations without writing.
- Add a sync/update command only if the source of truth is clear.
- Make errors actionable and avoid warnings for expected independent versions.
- Add focused `bun test scripts/__tests__/sync-plugin-metadata.test.ts` coverage for independent-version, synchronized-version, and drift cases.

Acceptance criteria:

- One check command detects drift.
- One sync/update path exists if policy requires generated metadata.
- Existing generated Warden checks still pass.
- The command can be consumed by `TRL-751` without duplicating policy logic.
- `bun test scripts/__tests__/sync-plugin-metadata.test.ts`, `bun run warden:skills:check`, `bun run format:check`, and `git diff --check` pass.

### M3 Branch 5: `TRL-750`

Branch: `trl-750-add-local-installed-trails-skill-synccheck-path`

Purpose: prevent local/global installed skills from silently diverging from repo plugin source.

File targets:

- proposed script: `scripts/check-installed-trails-skill.ts`
- proposed tests: `scripts/__tests__/check-installed-trails-skill.test.ts`
- proposed package script: `plugin:installed-skill:check`
- `plugin/README.md`
- root README install section if needed

Required updates:

- Compare `plugin/skills/trails` to local installed skill paths when present.
- Report copied versus symlinked state.
- Report missing files, stale vocabulary hits, and `metadata.trails.version` drift.
- Treat `$HOME/.config/codex/skills/trails` as optional/absent, not assumed.
- Support a dry check by default.
- Require explicit operator action for any local/global mutation.
- Add focused `bun test scripts/__tests__/check-installed-trails-skill.test.ts` coverage for copied, symlinked, missing, stale, and matching skill roots.

Acceptance criteria:

- Fresh local check can detect the audited stale installed-skill state via portable skill roots such as `~/.agents/skills/trails`.
- Claude symlink to `.agents` path is reported clearly.
- No absolute Matt-machine paths are hardcoded as defaults for external consumers.
- Verification documents that no hook auto-syncs global skills.
- `bun test scripts/__tests__/check-installed-trails-skill.test.ts`, `bun run format:check`, and `git diff --check` pass.

### M3 Branch 6: `TRL-751`

Branch: use Linear's generated branch name, currently `trl-751-improve-trails-plugin-hooks-for-project-detection-and`.

Purpose: improve Claude plugin startup guidance without noisy or mutating behavior.

Dependencies:

- Should consume version policy from `TRL-749`.
- Should reference/check installed-skill drift through `TRL-750`, not reimplement sync.
- Should keep copy language from `TRL-748`.

File targets:

- `plugin/hooks/detect-trails.sh`
- `plugin/hooks/hooks.json` only if schema needs adjustment
- proposed fixtures: `plugin/hooks/__fixtures__/detect-trails/`
- proposed tests: `scripts/__tests__/detect-trails-hook.test.ts`
- `plugin/README.md`

Required updates:

- Detect likely Trails projects through dependency keys, `package.json.trails.module`, `trails.config.*`, `.trails/`, and guarded topo-source conventions.
- Stay silent outside likely Trails projects.
- Use local/project CLI wording where discoverable.
- Suggest non-mutating Warden probes such as `trails warden --lock cached --no-lock-mutation`.
- Warn about version drift only through `TRL-749` policy.
- Document Claude hook support separately from Codex; do not promise Codex parity until verified.
- When emitting skill-load guidance, use the wording from `TRL-748` and pair it with `TRL-750` drift check/`TRL-753` precedence status; do not imply the global skill is current.
- Add focused fixture coverage for at least: non-Trails package, `@ontrails/*` dependency, `package.json.trails.module`, root `trails.config.ts`, root `.trails/`, and guarded `src/app.ts`.

Acceptance criteria:

- Hook smoke tests cover Trails and non-Trails fixtures.
- No hidden source or global installed-skill mutation.
- Hook output is concise and actionable.
- `bun test scripts/__tests__/detect-trails-hook.test.ts`, `bun run format:check`, and `git diff --check` pass.

### M4 Branch 7: `TRL-752`

Branch: `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke`

Purpose: prove the refreshed bundle can guide a new consumer project.

Work location and artifacts:

- Use `.trails-tmp/plugin-dogfood/` or a disposable tempdir for the consumer project. Do not commit the generated consumer project.
- Commit or attach a dogfood report at `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-752-dogfood.md`.
- Clean generated runtime state after the smoke, or record why it was preserved for debugging.

Required smoke:

- Fresh install/scaffold path.
- Simple trail with input/output/examples.
- CLI via `@ontrails/commander`.
- MCP via `@ontrails/mcp`.
- HTTP via Hono or `@ontrails/http/bun`.
- Resource with `mock` or documented `unmockable`.
- `testAll()` and surface harness where practical.
- Warden check.
- Installed-skill currentness check from `TRL-750`.

Acceptance criteria:

- Smoke app typechecks and tests pass.
- Any guidance gap is fixed before release or filed as a follow-up.
- Dogfood report records plugin version, skill target version, package versions, and exact commands.
- Dogfood report records typecheck/test/Warden results, installed-skill check result, cleanup state, and any skipped command with reason.

### M4 Branch 8: `TRL-753`

Branch: `trl-753-republish-trails-plugin-and-document-the-release-path`

Purpose: release the refreshed plugin/skills bundle through the configured distribution path.

Dependencies:

- `TRL-746` through `TRL-752`.

Stop rules:

- Do not publish, mutate a registry, mutate marketplace state, run `npx skills outfitter-dev/trails` against a real global install target, or mutate global installed skill paths without explicit operator approval at execution time.
- First run dry-run/read-only checks where available, including metadata checks, installed-skill checks, generated Warden checks, and release docs review.
- Probe `npx skills outfitter-dev/trails` only in a disposable or explicitly approved target; if that is not available, mark the behavior externally/manual blocked.

Required updates:

- Verify generated Warden guidance is current.
- Verify local installed skill path is current or intentionally decoupled.
- Verify Claude runtime precedence when repo plugin and global skill share the `trails` name.
- Document `npx skills outfitter-dev/trails` behavior or mark it externally blocked if it cannot be safely tested.
- Update `plugin/README.md`, root install docs, and release runbook.
- Record what changed since plugin `0.3.0`.

Acceptance criteria:

- Plugin metadata is synchronized and checked.
- Fresh dogfood is green.
- Release/republish step is complete only after explicit operator approval, or explicitly blocked on manual/external action.
- Linear gets final status with plugin version, framework target version, and deferred follow-ups.

## Follow-Up Issue

`TRL-755` was created for adjacent public docs drift discovered by the M1 audit.

Evidence routed to `TRL-755`:

- `README.md:150` uses "Surface maps" for Topographer in current-facing package prose.
- `README.md:142-155` omits current package entries such as `@ontrails/config`, `@ontrails/permits`, `@ontrails/drizzle`, `@ontrails/vite`, and shell-only `@ontrails/wayfinder`.
- `docs/api-reference.md:56-62` omits `VersionNotSupportedError` from the public error taxonomy list while `packages/core/src/errors.ts` exports and registers it.

Keep `TRL-755` separate from plugin refresh unless M2 implementation naturally touches public docs and can do so without broadening the plugin PRs.

## Completed Linear Refresh

Completed during M1; see `RETRO.md` Tracker Mutations for issue update/comment evidence.

- M1 completion comments were added to `TRL-745`, `TRL-742`, `TRL-743`, `TRL-744`, and `TRL-754`.
- `TRL-746` description was updated with exact M1 findings and file targets from this synthesis.
- `TRL-747` description was updated with exact reference/template/example file targets and acceptance criteria.
- `TRL-748` description was updated with agent/rules/advisory/hook-message targets, including Clark calibration.
- `TRL-749` description was updated to require a policy decision before check/sync behavior.
- `TRL-750` description was updated to require check-first behavior and observed local paths.
- `TRL-751` description was updated to split Claude hook support from Codex unknowns and consume `TRL-749`/`TRL-750`.
- `TRL-752` description was updated with explicit `@ontrails/http/bun`, `VersionNotSupportedError`, installed-skill currentness checks, dogfood artifact path, and cleanup state.
- `TRL-753` description was updated with runtime precedence, `npx skills` behavior, stop rules, and final status expectations.
- `TRL-755` is linked from `RETRO.md` and the relevant M1 comments.

## Verification For M2/M3

Minimum verification expected by implementation stack:

- `bun run warden:skills:check`
- `bun run warden:agents:check`
- `bun run clark:check`
- `bun run format:check`
- `git diff --check`

Additional verification by branch:

- `TRL-747`: snippet/API example checks if available; otherwise document manual snippet checks.
- `TRL-749`: metadata check command and sync command dry run/check mode.
- `TRL-750`: installed-skill drift check against the current stale local paths without mutation.
- `TRL-751`: hook smoke tests over Trails and non-Trails fixtures.
- `TRL-752`: fresh consumer typecheck/test/Warden smoke.
- `TRL-753`: release dry run or explicit external/manual blocker.

## Deferred Or Unknown

- Claude runtime precedence between repo plugin skill and global skill remains unknown; `TRL-753` owns verification.
- `npx skills outfitter-dev/trails` install behavior remains unknown because running it may mutate global state; `TRL-753` owns safe verification.
- Codex plugin hook parity is unknown; `TRL-751` should document Claude support separately and only file a Codex hook spike if a real hook surface is found.
- Registry/publish state was not checked in M1, by design.
- No implementation, publish, registry, merge, merge-queue, or global skill mutation occurred during M1.
