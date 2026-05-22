# Execution Retro: plugin-skills-refresh-stack

Date started: 2026-05-21
Date finalized: 2026-05-22
Status: Complete through remote review; not merged or published
Plan: `.agents/plans/2026-05-21-plugin-skills-refresh-stack/PLAN.md`
Goal: `.agents/plans/2026-05-21-plugin-skills-refresh-stack/GOAL.md`

Use this as the durable execution ledger. For stacked work, this should normally be the last meaningful file touched before local completion, draft submission, ready-for-review, remote review closeout, release handoff, merge readiness, archive, or final handoff.

## Execution Summary

- Objective: Execute the Trails Plugin & Skills One-Stop Shop refresh stack from public docs cleanup through release readiness.
- Final outcome: Nine-branch stack implemented, locally reviewed, submitted, marked ready, CI-green, and remote-review clean. No merge or publish action was performed.
- Final branch / stack tip: `trl-753-republish-trails-plugin-and-document-the-release-path`.
- Final PR range: #560 through #568.
- Final tracker state: `TRL-755`, `TRL-746` through `TRL-753` moved to `In Review` with PR links; Linear project status update `65348777-49ee-4ce2-b1d7-455f121b6730` posted.
- Final verification state: local targeted checks and full repo checks passed; GitHub CI green on all nine PRs; Greptile success on #560-#566 and #568, neutral/no-review-needed on #567; unresolved review-thread count is 0 on every PR.
- Remaining risks / P3s: release/runbook snapshot literals need normal release-cycle maintenance; raw scaffold cleanliness and published CLI `compile`/`validate` availability remain tracked release-readiness risks; `TRL-757` through `TRL-760` stay follow-ups.
- Archive state: M1 audit packet archived at `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`; active packet paths and Linear comments point to the archive.

## Branch / PR / Issue Ledger

| Order | Issue | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `TRL-755` | `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit` | <https://github.com/outfitter-dev/trails/pull/560> | Ready; CI/Greptile clean | Public docs drift and M1 packet archive |
| 2 | `TRL-746` | `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop` | <https://github.com/outfitter-dev/trails/pull/561> | Ready; CI/Greptile clean | Main skill entrypoint |
| 3 | `TRL-747` | `trl-747-refresh-trails-skill-references-templates-and-examples` | <https://github.com/outfitter-dev/trails/pull/562> | Ready; CI/Greptile clean | Deep references/templates/examples |
| 4 | `TRL-748` | `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook` | <https://github.com/outfitter-dev/trails/pull/563> | Ready; CI/Greptile clean | Agent/rules/advisory/hook copy |
| 5 | `TRL-749` | `trl-749-add-plugin-metadata-sync-and-drift-checks` | <https://github.com/outfitter-dev/trails/pull/564> | Ready; CI/Greptile clean | Metadata policy/checks |
| 6 | `TRL-750` | `trl-750-add-local-installed-trails-skill-synccheck-path` | <https://github.com/outfitter-dev/trails/pull/565> | Ready; CI/Greptile clean | Installed skill drift check |
| 7 | `TRL-751` | `trl-751-improve-trails-plugin-hooks-for-project-detection-and` | <https://github.com/outfitter-dev/trails/pull/566> | Ready; CI/Greptile clean | Hook detection/version guidance |
| 8 | `TRL-752` | `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke` | <https://github.com/outfitter-dev/trails/pull/567> | Ready; CI green, Greptile neutral | Dogfood smoke |
| 9 | `TRL-753` | `trl-753-republish-trails-plugin-and-document-the-release-path` | <https://github.com/outfitter-dev/trails/pull/568> | Ready; CI/Greptile clean | Release path/dry run |

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
| 2026-05-22 11:54 EDT | `TRL-753` | Moved to `In Progress` for execution. | Linear issue update returned successfully; `startedAt=2026-05-22T15:54:35Z`. |
| 2026-05-22 12:00 EDT | `TRL-753` | Added release-runbook and dry/read-only check evidence comment, including external/manual blockers and dogfood risks. | Comment `eb57e690-531f-4b04-9c27-06518a12938e`. |
| 2026-05-22 12:50 EDT | `TRL-755`, `TRL-746` through `TRL-753` | Moved all nine issues to `In Review` and attached PR links #560 through #568. | Linear issue update payloads returned successfully. |
| 2026-05-22 12:50 EDT | Linear project | Posted final on-track project update with PR list, CI/review state, Graphite service-lag note, and forbidden-action audit. | Status update `65348777-49ee-4ce2-b1d7-455f121b6730`. |

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

2026-05-22 11:56 EDT - trl-753 / Phase 9 release path and dry-run docs
- Changed: created branch `trl-753-republish-trails-plugin-and-document-the-release-path`; added `docs/releases/plugin-release.md`; linked it from `docs/index.md`, `plugin/README.md`, and root `README.md`.
- Release path: documented plugin/framework version independence, external mutation stop rules, preflight checks, dogfood gate, changes since plugin `0.3.0`, manual/external checks, publication handoff, `TRL-755` inclusion, and `TRL-757` through `TRL-760` disposition. `npx skills`, Claude marketplace mutation, Claude runtime precedence, and global skill refresh are explicitly manual/external blocked without approval.
- Linear: moved `TRL-753` to `In Progress`.
- Verified: `bun run plugin:metadata:check` passed; `bun run plugin:installed-skill:check` expected-failed read-only for stale installed skill state; `bun run warden:skills:check` passed; `bun run warden:agents:check` passed; `bun run clark:check` passed; targeted script tests passed 16 tests/47 assertions; `bun run docs:links` passed for 119 files; `bun run format:check` passed; `bun run publish:check` passed all package pack checks; `bun run publish:registry-check` passed for dist-tag `beta` with `beta=1.0.0-beta.18`; `git diff --check` passed.
- Result: `TRL-753` implementation is locally complete pending commit. No publish, marketplace mutation, `npx skills` mutation, global skill mutation, merge, merge queue label, or `gt absorb` occurred.
- Next: commit `TRL-753`, then run stack-tip checks and the required local review passes before remote draft submission.
- Blockers: no implementation blocker. External/manual release actions remain blocked by stop rule until operator approval.

2026-05-22 12:04 EDT - stack tip / vocabulary check retry
- Changed: amended vocabulary-audit fixes onto owning branches without `gt absorb`: `README.md` on `TRL-755`, `plugin/skills/trails/SKILL.md` on `TRL-746`, `scripts/check-installed-trails-skill.ts` and its test on `TRL-750`, and `docs/index.md` on `TRL-753`; added review reports under this packet's `reports/` directory.
- Verified: initial `bun run check` failed only in `vocab:audit` for stale terms introduced by docs/tooling and then in `format:check` for the drift-checker test formatting; after bottom-up amendments, `bun test scripts/__tests__/check-installed-trails-skill.test.ts` passed 5 tests/16 assertions and full `bun run check` passed.
- Result: check failure was resolved with scoped branch-owner amendments. Restacked branch commits are now `3a0814564`, `e29dc768b`, `01acd9b65`, `b4bc87ac0`, `f7fd343b4`, `b54eeac42`, `1536d4be9`, `477434f2d`, `f8eda849c` before final ledger amend.
- Next: complete local review reports, commit ledger/review artifacts on the stack tip, then submit draft PR stack.
- Blockers: none.

2026-05-22 12:07 EDT - stack tip / validation and local review
- Changed: added local review reports: `reports/local-review-round-1-skill-docs.md`, `reports/local-review-round-2-tooling-hooks.md`, and `reports/local-review-round-3-dogfood-release.md`.
- Verified: `bun run plugin:metadata:check` passed; `bun run plugin:installed-skill:check` expected-failed read-only with stale local/global skill copies; `bun run warden:skills:check`, `bun run warden:agents:check`, `bun run clark:check`, targeted script tests, `bun run typecheck`, `bun run test`, `bun run lint`, `bun run build`, `bun run check`, `bun run format:check`, and `git diff --check` all passed at the final stack tip. Local review scores: skill/docs doctrine 5/5; tooling/hooks safety 4/5 with one P3 readability note; dogfood/release readiness 4/5 with one P3 release-handoff note.
- Result: no unresolved local P0/P1/P2 findings. P3 notes are style/operational polish and do not block draft submission.
- Next: commit ledger/review artifacts and submit the nine-branch stack as drafts.
- Blockers: none.

2026-05-22 12:48 EDT - stack tip / remote review closeout
- Changed: submitted review-fix restack after remote-review fixes on `TRL-747`, `TRL-749`, and `TRL-750`; posted PR audit comments on #561 through #568 explaining fixed review feedback; moved Linear issues to `In Review`; posted Linear project status update; submitted this ledger-only closeout on the top branch.
- Verified: final v4 local checks passed: targeted script tests (18 tests, 54 assertions), `bun run plugin:metadata:check`, `bun run warden:skills:check`, `bun run docs:links`, `bun run format:check`, `git diff --check`, and full `bun run check`. GitHub CI passed on #560 through #568. Greptile passed on #560 through #566 and #568; #567 returned neutral/no-review-needed. GraphQL review-thread query returned 0 unresolved active threads on every PR.
- Result: all P0/P1/P2 local and remote findings are resolved. Remaining notes are P3/maintenance only. Graphite mergeability is complete on #560 and pending above it, treated as service lag because GitHub checks and reviews are clean.
- Next: hand off for human merge/release decision; do not merge or publish from this goal.
- Blockers: none for the requested build/review/submit objective. Release publication remains operator-approved external action only.
```

## Local Review Log

| Round | Scope / Lanes | Report Paths | P0/P1/P2 Result | Fix Commits / Notes |
| --- | --- | --- | --- | --- |
| 1 | Skill/docs doctrine | `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-1-skill-docs.md` | Clean: no P0/P1/P2/P3 findings; score 5/5. | No fixes required. |
| 2 | Tooling/hooks safety | `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-2-tooling-hooks.md` | Clean for P0/P1/P2; one P3 readability note; score 4/5. | No blocking fix. Stale-term fragments are intentional under the repo vocab audit. |
| 3 | Dogfood/release readiness | `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-3-dogfood-release.md` | Clean for P0/P1/P2; one P3 release-handoff note; score 4/5. | No blocking fix. Dogfood risks remain documented release handoff checks. |

## Remote Review

| PR | CI State | Review Scores / Summaries | Unresolved Threads | Fix Notes |
| --- | --- | --- | --- | --- |
| #560 | Green | Greptile 5/5: docs-only public README/API drift and M1 archive verified. | 0 | No fixes required. |
| #561 | Green | Greptile 5/5: main skill refresh accurate, WebSocket planned, HTTP quick-start current. | 0 | Fixed v2 quick-start to use `surface(graph, { port: 3000 })`; PR audit comment posted. |
| #562 | Green | Greptile 5/5: references/templates/examples current, HTTP reference copyable, trail-object crossing consistent. | 0 | Fixed getting-started import, Fetch Kernel usage, common-pitfalls imports, and composition quick-reference placeholders; PR audit comment posted. |
| #563 | Green | Greptile 5/5: agent/rules/hook/advisory vocabulary and Warden IDs current. | 0 | Fixed public-output wording to public MCP/HTTP trails; PR audit comment posted. |
| #564 | Green | Greptile 5/5: metadata policy/check/sync solid; P3 note on `--root`/frontmatter edge cases. | 0 | Fixed post-sync diagnostics so the CLI prints remaining drift and exits non-zero; PR audit comment posted. |
| #565 | Green | Greptile 5/5: installed-skill checker read-only and covered. | 0 | Fixed stale-vocabulary fixture to exercise singular `connector`; PR audit comment posted. |
| #566 | Green | Greptile 5/5: hook is read-only, scoped, and covered by hermetic tests. | 0 | Fixed earlier false-positive/CLI-guidance issues and verified again in v4; PR audit comment posted. |
| #567 | Green | Greptile neutral/no-review-needed on v4; prior 5/5 summary documented dogfood report accuracy. | 0 | Fixed absolute local path in dogfood report; PR audit comment posted. |
| #568 | Green | Greptile 5/5: release runbook and cross-links are docs-only and stop rules preserved; P3 maintenance note for dated release literals. | 0 | Fixed dogfood gate wording to active packet/latest-report convention; PR audit comment posted. |

## Verification Log

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short --branch` | Baseline: `## main...origin/main` plus pre-existing modified `GOAL.md`. | Left untouched. |
| `gt log --stack --reverse --no-interactive` | Final submitted stack shape passed. | #560 through #567 remained in their clean submitted review-fix versions; #568 contains the top-branch release runbook and ledger-only closeout. Pre-ledger-closeout lower commits: `3a0814564`, `698e32bd0`, `18ecbf5ec`, `898e3a05c`, `0fd6730be`, `528042633`, `1e475fdff`, `41d84d7ae`. |
| `bun run warden:skills:check` | Final stack-tip passed. | `bun scripts/sync-skill-warden-guide.ts --check`. |
| `bun run warden:agents:check` | Final stack-tip passed. | `bun scripts/sync-agents-warden-guide.ts --check`. |
| `bun run clark:check` | Final stack-tip passed. | Clark Codex custom-agent wrapper is up to date. |
| `bun run plugin:metadata:check` | Final stack-tip passed. | Plugin manifest, marketplace manifest, framework target version, and skill frontmatter are synchronized under the documented two-source policy. |
| `bun test scripts/__tests__/sync-plugin-metadata.test.ts scripts/__tests__/check-installed-trails-skill.test.ts scripts/__tests__/detect-trails-hook.test.ts` | Final stack-tip passed. | 18 tests, 54 assertions after hook fixture and review-fix coverage. |
| `bun test scripts/__tests__/check-installed-trails-skill.test.ts` | Final retry passed. | 5 tests, 16 assertions after vocab/format cleanup. |
| `bun run plugin:installed-skill:check` | Expected-failed read-only on current machine. | Detected stale `.agents/skills/trails`, Claude symlink to that stale copy, and absent optional Codex home skill path. No files were mutated. |
| Dogfood `bun install` | `TRL-752` passed. | Registry install succeeded for scaffolded package ranges at `1.0.0-beta.18`. |
| Dogfood `bun run typecheck` | `TRL-752` passed after disposable repair. | Raw scaffold failed first on optional `ctx.cross`; report records the gap. |
| Dogfood `bun run test` | `TRL-752` passed after disposable repair. | 17 tests, 34 assertions; includes `testAllEstablished`, `testSurfaceParity`, CLI/MCP/HTTP harnesses, and resource mock. |
| Dogfood `bun run build` | `TRL-752` passed after disposable repair. | `tsc -b`. |
| Dogfood `bun run lint` | `TRL-752` passed after disposable repair. | Raw scaffold failed first on generated lint shape; report records the gap. |
| Dogfood `bun run format:check` | `TRL-752` passed after disposable repair. | Raw scaffold failed first; report records the gap. |
| Dogfood `trails warden --lock cached --no-lock-mutation` | `TRL-752` passed with warnings. | Published `@ontrails/trails@1.0.0-beta.18` returned PASS, 0 errors, 4 expected warnings. |
| Dogfood local `trails compile` / `trails validate` | `TRL-752` passed. | Current repo CLI passed; published `@ontrails/trails@1.0.0-beta.18` did not expose these commands. |
| `bun run docs:links` | `TRL-747`, `TRL-753` passed. | Latest run passed for 119 files. |
| `bun run publish:check` | `TRL-753` passed. | Read-only pack checks passed for all non-private packages; private `@ontrails/oxlint-plugin` skipped. |
| `bun run publish:registry-check` | `TRL-753` passed. | Read-only registry preflight passed for dist-tag `beta`; all public packages reported `beta=1.0.0-beta.18`. |
| `bun run typecheck` | Final stack-tip passed. | 22 successful packages. |
| `bun run test` | Final stack-tip passed. | 37 successful package tasks; final run reported `@ontrails/trails` 345 pass / 0 fail and full turbo success. |
| `bun run lint` | Final stack-tip passed. | 23 successful tasks, 0 warnings/errors. |
| `bun run build` | Final stack-tip passed. | 22 successful packages. |
| `bun run check` | Final v4 stack-tip passed after focused retries. | First run caught vocabulary/format issues; remote review later prompted bottom-up fixes on #562/#564/#565. Final run passed lint, ast-grep, vocab audit, format, typecheck, docs links/snippets/API examples, error taxonomy, scaffold versions, Warden agents/skills, Clark, Trails Warden, and dead-code checks. |
| `bun run format:check` | Final stack-tip passed. | 839 matched files formatted; 0 warnings/errors. |
| `git diff --check` | Final stack-tip passed. | No whitespace/conflict-marker errors. |
| GitHub PR checks #560-#568 | Passed. | CI green on every PR. Graphite mergeability passed on #560 and remained pending above it as service lag. |
| Greptile Review #560-#568 | Passed or neutral. | Success on #560-#566 and #568; neutral/no-review-needed on #567. No bot error comments remain. |
| GitHub review-thread GraphQL query | Passed. | Unresolved active thread count was 0 on every PR. |

## Forbidden-Action Audit

| Action | Status | Notes |
| --- | --- | --- |
| Merge | Not performed | No merge or merge queue action. |
| Publish / registry mutation | Not performed | Only read-only `publish:check` and `publish:registry-check` ran. |
| Marketplace mutation | Not performed | Marketplace actions documented as external/manual blocked. |
| `npx skills` mutation | Not performed | README/runbook warn that this mutates local skill installs. |
| Global installed skill mutation | Not performed | `plugin:installed-skill:check` was read-only and expected-failed. |
| Merge queue label | Not performed | No merge queue label or queue action. |
| `gt absorb` | Not performed | Bottom-up fixes used `gt modify --into`; no `gt absorb`. |
| Source-control writes by subagents | Not performed | No subagents were dispatched. |

## Final State

- Completed: `TRL-755` public docs and M1 archive; `TRL-746` main skill refresh; `TRL-747` references/templates/examples/HTTP guidance; `TRL-748` agent/rules/advisory/hook copy and Clark calibration; `TRL-749` metadata policy/check/sync tooling; `TRL-750` installed-skill drift checker; `TRL-751` hook detection/guidance; `TRL-752` disposable dogfood and report; `TRL-753` release runbook/dry-run docs.
- Remaining risks: raw scaffold typecheck/lint/format cleanliness and published CLI `compile`/`validate` availability remain release-readiness risks from dogfood; runbook/version literals need normal release-cycle refresh; `TRL-757` through `TRL-760` remain tracked follow-ups.
- Skipped checks: no required local validation ladder checks were skipped. External mutation checks were intentionally not run: no publish, registry mutation, marketplace mutation, `npx skills` mutation, or global installed-skill mutation was approved.
- Archive readiness: active M1 packet removed from `.agents/plans/`; archived copy exists under `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`; refresh packet and Linear comments reference the archive.
