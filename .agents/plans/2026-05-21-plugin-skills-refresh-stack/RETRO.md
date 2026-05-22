# Execution Retro: plugin-skills-refresh-stack

Date started: 2026-05-21
Date finalized: pending
Status: Seeded for execution
Plan: `.agents/plans/2026-05-21-plugin-skills-refresh-stack/PLAN.md`
Goal: `.agents/plans/2026-05-21-plugin-skills-refresh-stack/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally be the last meaningful file touched before local completion, draft submission, ready-for-review, remote review closeout, release handoff, merge readiness, archive, or final handoff.

## Execution Summary

- Objective: Execute the Trails Plugin & Skills One-Stop Shop refresh stack from public docs cleanup through release readiness.
- Final outcome:
- Final branch / stack tip:
- Final PR range:
- Final tracker state:
- Final verification state:
- Remaining risks / P3s:
- Archive state:

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `TRL-755` | `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit` | | Local commit | Public docs drift and M1 packet archive |
| 2 | `TRL-746` | `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop` | | Local commit | Main skill entrypoint |
| 3 | `TRL-747` | `trl-747-refresh-trails-skill-references-templates-and-examples` | | Local commit | Deep references/templates/examples |
| 4 | `TRL-748` | `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook` | | In progress | Agent/rules/advisory/hook copy |
| 5 | `TRL-749` | `trl-749-add-plugin-metadata-sync-and-drift-checks` | | Planned | Metadata policy/checks |
| 6 | `TRL-750` | `trl-750-add-local-installed-trails-skill-synccheck-path` | | Planned | Installed skill drift check |
| 7 | `TRL-751` | `trl-751-improve-trails-plugin-hooks-for-project-detection-and` | | Planned | Hook detection/version guidance |
| 8 | `TRL-752` | `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke` | | Planned | Dogfood smoke |
| 9 | `TRL-753` | `trl-753-republish-trails-plugin-and-document-the-release-path` | | Planned | Release path/dry run |

## Planning Discoveries

| Discovery | Evidence | Decision | Impact |
| --- | --- | --- | --- |
| M1 audit stack landed before this packet was written. | `main` at `20564d6bc docs: synthesize plugin audit stack (#558)`. | Start next work from current `main`. | Avoids planning against stale report paths. |
| `TRL-755` is best kept in the plugin project. | M1 synthesis routes public docs drift to `TRL-755`; docs serve as plugin source truth. | Use `TRL-755` as bottom branch instead of moving it out. | Public docs are cleaned before plugin docs consume them. |
| Completed M1 packet still lives active under `.agents/plans/2026-05-21-plugin-skills-m1-audit/`. | `fd` on current `main`. | Archive it on the lowest branch and update Linear paths. | Keeps active plan directory clean. |
| PatchOS beta.15 -> beta.18 dogfood produced upstream evidence after this packet was seeded. | Operator-local PatchOS retro if accessible; summarized findings here cover `@ontrails/testing`, CLI help, registry posture, package install policy, skill freshness, Topographer workflow, MCP include-list safety, resource mocks, error taxonomy, observe/tracing adoption, and migration docs. | Keep the plugin stack order unchanged, but add PatchOS as dogfood evidence and file adjacent v1 follow-up issues. | `TRL-752` and `TRL-753` get sharper evidence; unrelated framework work is tracked without bloating this stack. |

## Deferred / Follow-Up Discoveries

| Issue | Discovery | Why Out Of Goal | Link |
| --- | --- | --- | --- |
| `TRL-757` | `@ontrails/testing` root export statically reaches surface harnesses and HTTP types, so root contract helpers can drag optional surface packages into downstream type graphs. | Framework package-boundary fix, not plugin refresh work. | <https://linear.app/outfitter/issue/TRL-757/split-ontrailstesting-surface-harnesses-behind-subpaths> |
| `TRL-758` | Topographer consumer workflow is already `trails compile` / `trails validate`; remaining work is docs/diagnostics around retired `trails topo ...` shapes and stale Topographer wording. | Adjacent CLI/docs ergonomics issue; plugin stack should reference but not implement wholesale. | <https://linear.app/outfitter/issue/TRL-758/clarify-topographer-artifact-cli-workflow-and-retired-topo-commands> |
| `TRL-759` | `beta` dist-tag is current at beta.18, while sampled `latest` dist-tags still point at beta.16; consumers need explicit beta install/version-bump policy. | Release policy/docs work beyond plugin republish mechanics. | <https://linear.app/outfitter/issue/TRL-759/document-beta-channel-install-policy-and-version-bump-cadence> |
| `TRL-760` | No one-stop beta.15 -> beta.18 downstream migration guide exists; PatchOS had to stitch the path from scattered docs/changelogs/skills. | Migration docs likely need a separate rewind/worktree investigation. | <https://linear.app/outfitter/issue/TRL-760/add-beta15-to-beta18-downstream-migration-guide> |

## Tracker Mutations

| Time | Tracker Item | Mutation | Evidence |
| --- | --- | --- | --- |
| 2026-05-21 | `TRL-755` through `TRL-753` | Planning packet seeded from current Linear issue bodies and M1 synthesis. | This packet. |
| 2026-05-21 17:43 EDT | `TRL-746` through `TRL-753` | Added Linear blocked-by chain matching the planned stack order: `TRL-755` -> `TRL-746` -> `TRL-747` -> `TRL-748` -> `TRL-749` -> `TRL-750` -> `TRL-751` -> `TRL-752` -> `TRL-753`. | Linear update payloads returned successfully. |
| 2026-05-21 17:43 EDT | `TRL-741` | Added comment linking this goal packet and explaining why `TRL-755` remains the bottom branch. | Comment `621411c3-bb6b-4642-a9b3-68b082ddc3e8` |
| 2026-05-21 17:44 EDT | `TRL-755` | Added comment naming the bottom-branch responsibility to archive the M1 packet and update downstream report-path references. | Comment `07128048-0e76-42df-9691-fc15d78c8939` |
| 2026-05-21 17:45 EDT | `TRL-752` | Updated dogfood report path to this packet and noted pre/post archive M1 synthesis paths. | Linear issue update payload returned successfully. |
| 2026-05-21 18:17 EDT | `TRL-757` through `TRL-760` | Filed four adjacent PatchOS-derived upstream follow-ups for testing subpaths, Topographer CLI/docs ergonomics, beta channel policy, and beta.15 -> beta.18 migration docs. | Linear create payloads returned successfully. |
| 2026-05-21 18:18 EDT | `TRL-741`, `TRL-749`, `TRL-750`, `TRL-752`, `TRL-753` | Added PatchOS retro comments tying the new evidence back to plugin metadata, installed-skill drift, dogfood, and release/install docs. | Linear comment payloads returned successfully. |
| 2026-05-21 18:18 EDT | `TRL-747`, `TRL-752`, `TRL-753`, `TRL-749`, `TRL-750` | Added related-issue links to PatchOS-derived follow-ups where relevant. | Linear update payloads returned successfully. |
| 2026-05-22 11:09 EDT | `TRL-755` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:09:03Z`. |
| 2026-05-22 11:09 EDT | `TRL-755`, `TRL-746` through `TRL-753` | Added archive-path comments pointing M1 report consumers at `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`. | Comment IDs: `63a1644e-651d-4ed3-8068-25fd86955b44`, `1b2125f5-e08f-4769-9d0f-052bb266d2dc`, `8e161197-540e-4e99-a4bc-4ad0d4bb07a3`, `c123afa3-1e8b-4474-af22-a0c7f5a28541`, `c5923cbd-86e2-4ee2-847c-02d46a875247`, `171cccfe-2bc7-4a46-aee2-593ac8c49cf9`, `82ebbb07-ec2a-46de-b5ce-701cd15a8a41`, `c60e53f5-02ef-46b2-931d-2f17f45b2243`, `9e124e67-ca4f-4445-8070-77ed33a09df8`. |
| 2026-05-22 11:14 EDT | `TRL-746` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:13:59Z`. |
| 2026-05-22 11:15 EDT | `TRL-747` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:15:10Z`. |
| 2026-05-22 11:22 EDT | `TRL-748` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:22:59Z`. |
| 2026-05-22 11:26 EDT | `TRL-749` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:26:15Z`. |
| 2026-05-22 11:33 EDT | `TRL-750` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:33:20Z`. |
| 2026-05-22 11:39 EDT | `TRL-751` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:39:33Z`. |
| 2026-05-22 11:44 EDT | `TRL-752` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:44:21Z`. |
| 2026-05-22 11:53 EDT | `TRL-752` | Added dogfood evidence comment. | Comment `ca4f6b4a-4a28-4cc7-853b-8dd3c38c4998`. |

## Execution Log

```text
YYYY-MM-DD HH:MM TZ - <branch/issue/checkpoint>
- Changed:
- Verified:
- Result:
- Next:
- Blockers:

2026-05-22 11:06 EDT - main / Phase 0 baseline
- Changed: no repo files changed for baseline yet; pre-existing local modification observed in `.agents/plans/2026-05-21-plugin-skills-refresh-stack/GOAL.md` and left untouched.
- Verified: `gt sync` returned `ok synced`; `gt checkout main` returned `Already on main.`; `git log -1 --oneline` returned `e2982ad81 docs: add plugin skills refresh plan (#559)`; `gt log --stack --reverse --no-interactive` showed only current `main` at `e2982ad81`; `gh pr view 559 ...` showed PR #559 merged at `2026-05-22T14:42:38Z` with merge commit `e2982ad81ffae525591a9ea7c73d431071336804`; PRs #554 through #558 were verified merged with merge commits `a2a92b9a`, `a5e40f10`, `0411bb8c`, `8763f9e6`, and `20564d6b`; `gh pr list --state open ...` returned `[]`.
- Linear: read project `Trails Plugin & Skills One-Stop Shop`, issues `TRL-755`, `TRL-746` through `TRL-753`, and follow-ups `TRL-757` through `TRL-760`; dependency chain and follow-up relationships match the packet.
- Result: start condition satisfied: M1 audit stack and refresh packet are on `main`. Baseline is clean except for the pre-existing `GOAL.md` user edit, which is out of scope for this execution ledger unless Matt says otherwise.
- Next: create bottom branch `TRL-755`, archive the completed M1 packet, update stale M1 report-path references, and apply public README/API docs drift fixes.
- Blockers: none.

2026-05-22 11:10 EDT - trl-755 / Phase 1 public docs and M1 archive
- Changed: created branch `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit`; moved `.agents/plans/2026-05-21-plugin-skills-m1-audit/` to `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`; updated refresh-stack `REFS.md` known starting state to point at the archive; completed the README package table by adding `@ontrails/vite`, `@ontrails/config`, `@ontrails/permits`, `@ontrails/drizzle`, and shell-only `@ontrails/wayfinder`; changed README Topographer copy from surface-map wording to `TopoGraph`/lock wording; added `VersionNotSupportedError` to `docs/api-reference.md`.
- Linear: moved `TRL-755` to `In Progress`; added archive-path comments to `TRL-755` and `TRL-746` through `TRL-753`.
- Verified: `rg -n "Surface maps|SurfaceMap|VersionNotSupportedError|@ontrails/config|@ontrails/permits|@ontrails/drizzle|@ontrails/vite|@ontrails/wayfinder" README.md docs/api-reference.md` returned expected new package/error hits and no `Surface maps`/`SurfaceMap` hits; `bun run format:check` passed; `git diff --check` passed.
- Result: `TRL-755` implementation and tracker/archive-path update are locally complete and committed on the branch.
- Next: stage only `TRL-755`-owned changes (excluding the pre-existing `GOAL.md` edit), commit with Graphite, then create `TRL-746`.
- Blockers: none.

2026-05-22 11:14 EDT - trl-746 / Phase 2 main skill refresh
- Changed: created branch `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop`; updated `plugin/skills/trails/SKILL.md` to qualify WebSocket as planned, add compact package orientation for current surface/infrastructure/observability/ecosystem packages, teach Hono and Bun-native HTTP as peer HTTP materializers, mention `@ontrails/pino` and shell-only `@ontrails/wayfinder`, add `createHttpHarness()` and `testSurfaceParity()`, correct `ResourceContext.config`/`unmockable` first-load resource guidance, and add `VersionNotSupportedError` with the current 17 fixed-category error count.
- Linear: moved `TRL-746` to `In Progress`.
- Verified: `rg -n "trailhead|connector|transport|@ontrails/http/bun|@ontrails/pino|@ontrails/wayfinder|createHttpHarness|testSurfaceParity|WebSocket|VersionNotSupportedError|17 fixed|ResourceContext|unmockable" plugin/skills/trails/SKILL.md` returned expected current terms and no retired `trailhead`/`connector`/`transport` hits; `bun run warden:skills:check` passed; `bun run format:check` passed; `git diff --check` passed.
- Result: `TRL-746` implementation is locally complete pending commit/branch checkpoint.
- Next: commit `TRL-746`, then create `TRL-747` for deep references/templates/examples.
- Blockers: none.

2026-05-22 11:21 EDT - trl-747 / Phase 3 references templates examples
- Changed: created branch `trl-747-refresh-trails-skill-references-templates-and-examples`; added `plugin/skills/trails/references/http-surface.md`; updated deep architecture, getting-started, contract-patterns, testing-patterns, error-taxonomy, common-pitfalls, migration-checklist, composition/trail templates, and composition/Express examples; added the HTTP reference link to `plugin/skills/trails/SKILL.md`.
- Scope covered: current package/subpath map including `@ontrails/http/bun`, `@ontrails/pino`, and shell-only `@ontrails/wayfinder`; TopoGraph/topo.lock wording; Hono plus Bun-native HTTP; `deriveHttpRoutes`, `deriveOpenApiSpec`, `@ontrails/http/fetch`, `createHttpHarness()`, `testSurfaceParity()`, `expectedMatch`, `VersionNotSupportedError`, `ResourceContext.config`, `unmockable`, trail-object crossing, and batch `ctx.cross([...])`.
- Linear: moved `TRL-747` to `In Progress`.
- Verified: targeted `rg` returned expected new guidance and no retired `SurfaceMap`/surface-map/`trailhead`/`connector`/`transport`/`Promise.all` hits in plugin references/templates/examples; `bun run warden:skills:check` passed; `bun run format:check` passed; `git diff --check` passed; `bun run docs:links` passed for 118 files; `bun run docs:snippets` passed for 21 README files; `bun run docs:api-examples` passed public API example coverage.
- Result: `TRL-747` implementation is locally complete pending commit/branch checkpoint.
- Next: commit `TRL-747`, then create `TRL-748` for agent/rules/advisory skill/hook copy and Clark calibration.
- Blockers: none.

2026-05-22 11:25 EDT - trl-748 / Phase 4 agent rules advisory hook copy
- Changed: created branch `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook`; updated `plugin/agents/trail-engineer.md` to reference current generated Warden guidance and rule IDs; updated `plugin/rules/patterns.md` resource copy for `ResourceContext.config` and `unmockable`; changed `plugin/hooks/detect-trails.sh` message text from stale global-skill/blaze-command wording to repo-bundled/current skill guidance and plain shell-command install copy; updated `.claude/skills/clark/references/calibrate.md` from trail `metadata` to `meta`; changed `plugin/skills/trails-error-format/SKILL.md` from transport wording to surface wording.
- Linear: moved `TRL-748` to `In Progress`.
- Verified: targeted stale-copy `rg` showed only acceptable remaining hits in lexicon "not this" rows, actual source filenames, or advisory non-trail metadata language; `bun run warden:agents:check` passed; `bun run clark:check` passed; `bun run warden:skills:check` passed; `bun run format:check` passed; `git diff --check` passed.
- Result: `TRL-748` implementation is locally complete pending commit/branch checkpoint.
- Next: commit `TRL-748`, then create `TRL-749` for plugin metadata policy/check tooling.
- Blockers: none.

2026-05-22 11:34 EDT - trl-749 / Phase 5 plugin metadata policy and sync checks
- Changed: created branch `trl-749-add-plugin-metadata-sync-and-drift-checks`; added `scripts/sync-plugin-metadata.ts`; added `scripts/__tests__/sync-plugin-metadata.test.ts`; added root scripts `plugin:metadata:sync` and `plugin:metadata:check`; documented the plugin/framework version policy in `plugin/README.md`.
- Policy: `plugin/.claude-plugin/plugin.json.version` owns the Claude plugin version; `packages/core/package.json.version` owns the Trails framework target version for the bundled `trails` skill; `.claude-plugin/marketplace.json` and `plugin/skills/trails/SKILL.md` hold derived copies. Plugin version `0.3.0` and framework target `1.0.0-beta.18` are intentionally allowed to differ.
- Linear: moved `TRL-749` to `In Progress`.
- Verified: `bun test scripts/__tests__/sync-plugin-metadata.test.ts` passed 4 tests/13 assertions; `bun run plugin:metadata:check` passed; `bun test scripts/__tests__/sync-plugin-metadata.test.ts scripts/__tests__/sync-skill-warden-guide.test.ts scripts/__tests__/sync-agents-warden-guide.test.ts` passed 12 tests/37 assertions; `bun run warden:skills:check` passed; `bun run format:check` passed after targeted formatting/key-order fix; `git diff --check` passed.
- Result: `TRL-749` implementation is locally complete pending commit/branch checkpoint.
- Next: commit `TRL-749`, then create `TRL-750` for installed-skill drift checking.
- Blockers: none.

2026-05-22 11:38 EDT - trl-750 / Phase 6 installed skill drift check
- Changed: created branch `trl-750-add-local-installed-trails-skill-synccheck-path`; added read-only `scripts/check-installed-trails-skill.ts`; added `scripts/__tests__/check-installed-trails-skill.test.ts`; added root script `plugin:installed-skill:check`; documented local skill drift checking in `plugin/README.md`.
- Behavior: default candidates are `$HOME/.agents/skills/trails`, `$HOME/.config/claude/skills/trails`, and optional `$HOME/.config/codex/skills/trails`; the checker reports copy/symlink/missing state, file drift, stale vocabulary, and `metadata.trails.version` drift. It never mutates installed skill files.
- Linear: moved `TRL-750` to `In Progress`; corrected the branch name to Linear's recommended `trl-750-add-local-installed-trails-skill-synccheck-path` before committing work.
- Verified: `bun test scripts/__tests__/check-installed-trails-skill.test.ts` passed 5 tests/16 assertions; `bun run plugin:installed-skill:check` intentionally exited 1 and detected the audited local stale state: `.agents/skills/trails` is a drifted copy with 13 file drift items and 5 stale vocabulary hits, Claude is a symlink to that stale copy, and Codex home is an absent optional path; `bun run format:check` passed after targeted formatter cleanup; `git diff --check` passed.
- Result: `TRL-750` implementation is locally complete pending commit/branch checkpoint; the current machine's installed skill remains unchanged by design.
- Next: commit `TRL-750`, then create `TRL-751` for hook detection and version guidance.
- Blockers: none.

2026-05-22 11:41 EDT - trl-751 / Phase 7 hook detection and version guidance
- Changed: created branch `trl-751-improve-trails-plugin-hooks-for-project-detection-and`; expanded `plugin/hooks/detect-trails.sh`; added fixture coverage under `plugin/hooks/__fixtures__/detect-trails/`; added `scripts/__tests__/detect-trails-hook.test.ts`; documented Claude `SessionStart` hook behavior and Codex-parity caveat in `plugin/README.md`.
- Behavior: the hook stays silent outside likely Trails projects; detects `@ontrails/*` dependency keys, `package.json.trails.module`, root `trails.config.*`, root `.trails/`, and guarded topo source files; suggests only non-mutating Warden probes when a project-local, script, or PATH `trails` command is discoverable; points installed/global skill freshness to the `TRL-750` checker instead of mutating or syncing.
- Linear: moved `TRL-751` to `In Progress`.
- Verified: `bun test scripts/__tests__/detect-trails-hook.test.ts` passed 7 tests/18 assertions; `bun run format:check` passed after targeted test formatting; `git diff --check` passed.
- Result: `TRL-751` implementation is locally complete pending commit/branch checkpoint.
- Next: commit `TRL-751`, then create `TRL-752` for disposable dogfood and report.
- Blockers: none.

2026-05-22 11:52 EDT - trl-752 / Phase 8 disposable dogfood
- Changed: created branch `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke`; added `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/trl-752-dogfood.md`.
- Dogfood scope: scaffolded `.trails-tmp/plugin-dogfood/` with `bun run trails create plugin-dogfood --dir .trails-tmp --starter entity --surfaces cli mcp http --json`; installed registry packages; added a disposable resource-backed greeting trail with `mock`; expanded disposable tests to cover `testAllEstablished`, `testSurfaceParity`, `createCliHarness`, `createMcpHarness`, and `createHttpHarness`; cleaned `.trails-tmp/plugin-dogfood/` after the smoke.
- Findings: raw scaffold tests passed, but raw scaffold typecheck failed on optional `ctx.cross`, and raw lint/format failed on generated code shape. Disposable repairs got the app green. Published `@ontrails/trails@1.0.0-beta.18` exposed `warden` but not `compile`/`validate`; current local repo CLI exposed and passed `compile`/`validate`.
- Linear: moved `TRL-752` to `In Progress`; added dogfood evidence comment `ca4f6b4a-4a28-4cc7-853b-8dd3c38c4998`.
- Verified: dogfood `bun install` passed; repaired app `bun run typecheck`, `bun run test` (17 tests/34 assertions), `bun run build`, `bun run lint`, and `bun run format:check` passed; CLI smoke commands returned expected JSON; published `trails warden --lock cached --no-lock-mutation` passed with 0 errors/4 expected warnings; local current `trails compile` and `trails validate` passed; repo `bun run plugin:metadata:check` passed; repo `bun run plugin:installed-skill:check` expected-failed read-only for stale local install.
- Result: `TRL-752` implementation/report is locally complete pending repo checks and commit.
- Next: run repo `format:check`/`git diff --check`, commit `TRL-752`, then create `TRL-753` for release path/dry-run docs.
- Blockers: none, but scaffold cleanliness and published CLI command availability are release-readiness risks for `TRL-753`.
```

## Local Review Log

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## Remote Review

| PR | CI State | Review Scores / Summaries | Unresolved Threads | Fix Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## Verification Log

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short --branch` | Baseline: `## main...origin/main` plus pre-existing modified `GOAL.md`. | Left untouched. |
| `gt log --stack --reverse --no-interactive` | Baseline passed. | Current branch `main` at `e2982ad81 docs: add plugin skills refresh plan (#559)`. |
| `bun run warden:skills:check` | `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749` passed. | `bun scripts/sync-skill-warden-guide.ts --check`. |
| `bun run warden:agents:check` | `TRL-748` passed. | `bun scripts/sync-agents-warden-guide.ts --check`. |
| `bun run clark:check` | `TRL-748` passed. | Clark Codex custom-agent wrapper is up to date. |
| `bun run plugin:metadata:check` | `TRL-749` passed. | Plugin manifest, marketplace manifest, framework target version, and skill frontmatter are synchronized under the documented two-source policy. |
| `bun test scripts/__tests__/sync-plugin-metadata.test.ts` | `TRL-749` passed. | 4 tests, 13 assertions. |
| `bun test scripts/__tests__/check-installed-trails-skill.test.ts` | `TRL-750` passed. | 5 tests, 16 assertions. |
| `bun run plugin:installed-skill:check` | `TRL-750` expected-failed on current machine. | Read-only check detected stale `.agents/skills/trails`, Claude symlink to that stale copy, and absent optional Codex home skill path. No files were mutated. |
| `bun test scripts/__tests__/detect-trails-hook.test.ts` | `TRL-751` passed. | 7 tests, 18 assertions. |
| Dogfood `bun install` | `TRL-752` passed. | Registry install succeeded for scaffolded package ranges at `1.0.0-beta.18`. |
| Dogfood `bun run typecheck` | `TRL-752` passed after disposable repair. | Raw scaffold failed first on optional `ctx.cross`; report records the gap. |
| Dogfood `bun run test` | `TRL-752` passed after disposable repair. | 17 tests, 34 assertions; includes `testAllEstablished`, `testSurfaceParity`, CLI/MCP/HTTP harnesses, and resource mock. |
| Dogfood `bun run build` | `TRL-752` passed after disposable repair. | `tsc -b`. |
| Dogfood `bun run lint` | `TRL-752` passed after disposable repair. | Raw scaffold failed first on generated lint shape; report records the gap. |
| Dogfood `bun run format:check` | `TRL-752` passed after disposable repair. | Raw scaffold failed first; report records the gap. |
| Dogfood `trails warden --lock cached --no-lock-mutation` | `TRL-752` passed with warnings. | Published `@ontrails/trails@1.0.0-beta.18` returned PASS, 0 errors, 4 expected warnings. |
| Dogfood local `trails compile` / `trails validate` | `TRL-752` passed. | Current repo CLI passed; published `@ontrails/trails@1.0.0-beta.18` did not expose these commands. |
| `bun run typecheck` | | |
| `bun run test` | | |
| `bun run lint` | | |
| `bun run build` | | |
| `bun run check` | | |
| `bun run format:check` | `TRL-755`, `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751` passed. | 0 warnings, 0 errors after targeted formatting/key-order fix for new script tests. |
| `git diff --check` | `TRL-755`, `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751` passed. | No whitespace/conflict-marker errors. |

## Forbidden-Action Audit

| Action | Status | Notes |
| --- | --- | --- |
| Merge | | |
| Publish / registry mutation | | |
| Marketplace mutation | | |
| `npx skills` mutation | | |
| Global installed skill mutation | | |
| Merge queue label | | |
| `gt absorb` | | |
| Source-control writes by subagents | | |

## Final State

- Completed:
- Remaining risks:
- Skipped checks:
- Archive readiness:
