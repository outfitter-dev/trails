# Goal Plan: plugin-skills-refresh-stack

Date: 2026-05-21
Status: Ready for execution

## Objective

Execute the Trails Plugin & Skills One-Stop Shop implementation stack from the merged M1 audit: refresh the public source docs and plugin skill bundle, add metadata and installed-skill drift checks, improve hook guidance, dogfood the result, and prepare the plugin release path without publishing unless explicitly approved.

This stack starts with `TRL-755` because public docs are part of the source-of-truth surface that the plugin refresh will lean on. It also uses the lowest branch to archive the completed M1 packet and keep Linear paths current.

PatchOS beta.15 -> beta.18 dogfood is now an additional upstream evidence source for this stack. It does not change the nine-branch plugin stack order, but it sharpens `TRL-752` and `TRL-753` and produced adjacent v1 follow-up issues: `TRL-757`, `TRL-758`, `TRL-759`, and `TRL-760`.

## Completion Condition

The goal is complete only when:

- The nine-branch Graphite stack exists in this order:
  1. `TRL-755`
  2. `TRL-746`
  3. `TRL-747`
  4. `TRL-748`
  5. `TRL-749`
  6. `TRL-750`
  7. `TRL-751`
  8. `TRL-752`
  9. `TRL-753`
- The completed M1 audit packet has been moved from `.agents/plans/2026-05-21-plugin-skills-m1-audit/` to `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/` on the lowest branch, and Linear references that need the report paths have been updated or commented with the archived path.
- `TRL-755` fixes the public-docs drift called out by M1, or explicitly documents any package-table incompleteness as intentional.
- `TRL-746` through `TRL-748` make the repo plugin skill, references, templates, examples, agent, rules, advisory skills, and hook copy current.
- `TRL-749` and `TRL-750` add check-first metadata and installed-skill drift tooling with tests.
- `TRL-751` improves hook detection/guidance without global mutation or noisy non-Trails output.
- `TRL-752` dogfoods the refreshed bundle in a disposable consumer project and commits a dogfood report.
- `TRL-753` documents the release/republish path and runs dry/read-only release checks; actual publish/registry/marketplace/global-skill mutation happens only with explicit operator approval.
- PatchOS-derived adjacent issues are logged and cross-referenced, and this stack records whether they block plugin release or remain deferred follow-ups.
- Local review runs before remote submission and stops only when P0/P1/P2 findings are fixed.
- PRs are submitted with high-quality bodies, marked ready only after local review and CI are clean, and post-ready remote review resolves P0/P1/P2 feedback.
- Required verification passes, or skipped checks are explained in `RETRO.md`.
- `RETRO.md` has final tracker, branch/PR, review, verification, forbidden-action, remaining-risk, and archive-readiness state, and the final transcript reports the proof.

## Non-Goals

- Do not publish the plugin, mutate a registry, mutate marketplace state, run `npx skills outfitter-dev/trails` against a real global install target, or mutate global installed skill paths without explicit operator approval at execution time.
- Do not treat the installed/global `trails` skill as doctrine. It is known to have been stale; inspect it only as a drift-check target.
- Do not implement unrelated Trails framework behavior beyond the plugin/docs/tooling surfaces named in the issues.
- Do not absorb adjacent PatchOS-derived framework issues into this plugin stack unless Matt explicitly expands scope. `TRL-757`, `TRL-758`, `TRL-759`, and `TRL-760` are tracked follow-ups that this stack should reference and dogfood against, not silently implement wholesale.
- Do not broaden `TRL-755` into a public docs rewrite. Fix the audited drift and keep larger docs IA decisions explicit.
- Do not merge. Do not add merge queue labels.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-21-plugin-skills-refresh-stack/PLAN.md`
4. `.agents/plans/2026-05-21-plugin-skills-refresh-stack/REFS.md`
5. `.agents/plans/2026-05-21-plugin-skills-refresh-stack/RETRO.md`
6. M1 audit packet at `.agents/plans/2026-05-21-plugin-skills-m1-audit/` before archive, then `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/` after Phase 1.
7. PatchOS upstream retro if accessible in the operator's PatchOS checkout; otherwise use the summarized PatchOS findings in this packet's `RETRO.md`.
8. Linear project `Trails Plugin & Skills One-Stop Shop`
9. Linear issues: `TRL-755`, `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751`, `TRL-752`, `TRL-753`
10. Adjacent PatchOS-derived follow-ups: `TRL-757`, `TRL-758`, `TRL-759`, `TRL-760`

## Branch Order

Bottom to top:

| Order | Issue | Branch |
| --- | --- | --- |
| 1 | `TRL-755` | `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit` |
| 2 | `TRL-746` | `trl-746-refresh-the-main-trails-skill-into-the-canonical-one-stop` |
| 3 | `TRL-747` | `trl-747-refresh-trails-skill-references-templates-and-examples` |
| 4 | `TRL-748` | `trl-748-refresh-plugin-agent-rules-advisory-skills-and-hook` |
| 5 | `TRL-749` | `trl-749-add-plugin-metadata-sync-and-drift-checks` |
| 6 | `TRL-750` | `trl-750-add-local-installed-trails-skill-synccheck-path` |
| 7 | `TRL-751` | `trl-751-improve-trails-plugin-hooks-for-project-detection-and` |
| 8 | `TRL-752` | `trl-752-dogfood-refreshed-trails-plugin-with-a-fresh-consumer-smoke` |
| 9 | `TRL-753` | `trl-753-republish-trails-plugin-and-document-the-release-path` |

## Work Plan

### Phase 0: Sync And Baseline

Intent:

- Ensure the executor starts after the M1 audit stack has landed on `main`.

Actions:

- Run `gt sync`.
- Check out `main`.
- Confirm `main` includes PR #558 or later.
- Confirm the M1 audit PRs #554 through #558 are merged.
- Confirm the worktree is clean.
- Record baseline in `RETRO.md`.

Verification:

- `git status --short --branch`
- `git log -1 --oneline`
- `gt log --stack --reverse --no-interactive`
- `gh pr list --repo outfitter-dev/trails --state open --json number,title,headRefName,isDraft,mergeable,updatedAt`

Done when:

- Baseline is clean and M1 is merged.

### Phase 1: `TRL-755` Public Docs And M1 Packet Cleanup

Intent:

- Fix audited public-docs drift first, and archive the completed M1 packet before building the plugin refresh on top of it.

Actions:

- Create the bottom branch `trl-755-refresh-public-docs-drift-found-during-plugin-skills-audit`.
- Move `.agents/plans/2026-05-21-plugin-skills-m1-audit/` to `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`.
- Update this packet's `REFS.md` or `RETRO.md` if any M1 report path changes during archive.
- Update Linear issue descriptions or add comments for `TRL-746` through `TRL-753` and `TRL-755` so agents know the M1 reports now live under `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`.
- Fix audited public docs:
  - `README.md` Topographer wording from surface-map language to current TopoGraph/lock terminology.
  - `README.md` package table completeness or a clear statement that the table is intentionally curated.
  - `docs/api-reference.md` error taxonomy to include `VersionNotSupportedError` if the page remains the public class list.
- Cross-check PatchOS-derived `TRL-758` while editing Topographer public wording. Do not implement CLI diagnostics here unless the stack scope is explicitly expanded.
- Preserve historical ADR/migration mentions when explicitly historical.

Verification:

- `rg -n "Surface maps|SurfaceMap|VersionNotSupportedError|@ontrails/config|@ontrails/permits|@ontrails/drizzle|@ontrails/vite|@ontrails/wayfinder" README.md docs/api-reference.md`
- `bun run format:check`
- `git diff --check`

Done when:

- Public docs no longer contradict M1's package/error/topograph findings, and the completed M1 packet is archived.

### Phase 2: `TRL-746` Main Skill Refresh

Intent:

- Make `plugin/skills/trails/SKILL.md` the accurate first-load briefing for agents building with Trails.

Actions:

- Preserve the first-screen teaching flow: `trail()` -> `blaze` -> `topo()` -> `surface()` -> `run()` -> `testAll()`.
- Qualify WebSocket as planned, not shipped.
- Teach HTTP as Hono plus Bun-native `@ontrails/http/bun` over the shared `@ontrails/http` route/fetch kernel.
- Add compact package orientation for current package groups, including `@ontrails/pino` and shell-only `@ontrails/wayfinder`.
- Mention `createHttpHarness()` and `testSurfaceParity()` at first-load level.
- Keep `metadata.trails.version: 1.0.0-beta.18` unchanged unless `TRL-749` has already landed an explicit policy change on the stack.

Verification:

- `rg -n "trailhead|connector|transport|@ontrails/http/bun|@ontrails/pino|@ontrails/wayfinder|createHttpHarness|testSurfaceParity|WebSocket" plugin/skills/trails/SKILL.md`
- `bun run warden:skills:check`
- `bun run format:check`
- `git diff --check`

Done when:

- First-load guidance is correct, concise, and points to deep references for detail.

### Phase 3: `TRL-747` References, Templates, And Examples

Intent:

- Update deep plugin guidance so agents have enough current examples to build correctly.

Actions:

- Refresh:
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
- Rebuild architecture/package guidance from current docs and package export maps.
- Replace active surface-map wording with `TopoGraph`, `TopoGraphEntry`, lock manifest, and `topo.lock`.
- Add HTTP reference coverage for `deriveHttpRoutes`, `deriveOpenApiSpec`, `@ontrails/http/fetch`, `@ontrails/http/bun`, and Hono.
- Add `VersionNotSupportedError`, `ResourceContext.config`, `unmockable`, `expectedMatch`, `createHttpHarness()`, and `testSurfaceParity()` guidance.
- Add a note that surface-specific testing helpers may move behind subpaths in `TRL-757`; until that lands, plugin guidance should describe the current root imports accurately and avoid promising an isolation boundary that does not exist yet.
- Prefer trail-object `crosses` and typed `ctx.cross(trail, input)` where in scope; keep string IDs as escape hatch.
- Replace `Promise.all([ctx.cross(...)])` teaching examples with batch `ctx.cross([...])` where the goal is concurrent crossing.

Verification:

- `bun run warden:skills:check`
- `bun run format:check`
- `git diff --check`
- Snippet/API example checks if available; otherwise record the manual snippet check in `RETRO.md`.

Done when:

- Deep references/templates/examples are current and progressive.

### Phase 4: `TRL-748` Agent, Rules, Advisory Skills, And Hook Copy

Intent:

- Refresh non-main plugin guidance after the main skill and references are current.

Actions:

- Update:
  - `plugin/agents/trail-engineer.md`
  - `plugin/rules/lexicon.md`
  - `plugin/rules/patterns.md`
  - `plugin/hooks/detect-trails.sh` message text only unless tiny behavior-safe cleanup is forced
  - advisory skill entrypoints under `plugin/skills/trails-*`
  - `.claude/skills/clark/references/calibrate.md`
- Replace stale Warden labels with current manifest IDs or generated Warden guide references.
- Update resource copy for `ResourceContext.config` and `unmockable`.
- Update Clark calibration from `metadata` to `meta`.
- Replace hook `blaze:` command wording with plain shell-command guidance.
- Make startup "load the trails skill" wording avoid stale global skill ambiguity.
- Run sync commands if generated Clark/Warden guidance changes.

Verification:

- `bun run warden:agents:check`
- `bun run clark:check`
- `bun run warden:skills:check`
- `bun run format:check`
- `git diff --check`

Done when:

- Advisory surfaces no longer contradict current repo doctrine.

### Phase 5: `TRL-749` Plugin Metadata Policy And Checks

Intent:

- Define and enforce plugin metadata/version policy before hooks warn about drift.

Actions:

- Decide and document whether plugin semver `0.3.0` is independent from Trails framework target `1.0.0-beta.18`.
- If independent, expose both values clearly.
- Make the policy answer the PatchOS question: which Trails package line is this skill verified against, and how does an operator notice when package docs/skills are stale relative to the registry channel?
- Add check-first tooling:
  - proposed script: `scripts/sync-plugin-metadata.ts`
  - proposed tests: `scripts/__tests__/sync-plugin-metadata.test.ts`
  - proposed package scripts: `plugin:metadata:check` and `plugin:metadata:sync`
- Check `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, and `plugin/skills/trails/SKILL.md`.
- Add a sync/update command only if source of truth is clear.
- Make errors actionable and avoid warning merely because independent versions differ.

Verification:

- `bun test scripts/__tests__/sync-plugin-metadata.test.ts`
- `bun run warden:skills:check`
- `bun run format:check`
- `git diff --check`

Done when:

- A read-only metadata check detects policy violations, and hook/release work can consume the policy.

### Phase 6: `TRL-750` Installed Skill Drift Check

Intent:

- Prevent local/global installed Trails skills from silently diverging from repo plugin source.

Actions:

- Add check-first tooling:
  - proposed script: `scripts/check-installed-trails-skill.ts`
  - proposed tests: `scripts/__tests__/check-installed-trails-skill.test.ts`
  - proposed package script: `plugin:installed-skill:check`
- Compare `plugin/skills/trails` with installed skill paths when present.
- Report symlink versus copy state, missing files, stale vocabulary hits, and `metadata.trails.version` drift.
- Treat Codex-home skill path as optional/absent.
- Keep sync/mutation as explicit operator action; no startup hook auto-sync.
- Document local development strategy without hardcoding Matt-only paths as external defaults.

Verification:

- `bun test scripts/__tests__/check-installed-trails-skill.test.ts`
- `bun run plugin:installed-skill:check` if added
- `bun run format:check`
- `git diff --check`

Done when:

- The checker can detect the audited stale local state without mutating global paths.

### Phase 7: `TRL-751` Hook Detection And Version Guidance

Intent:

- Improve Claude plugin startup guidance without noisy or mutating behavior, and document Codex parity as unknown unless verified.

Actions:

- Update:
  - `plugin/hooks/detect-trails.sh`
  - `plugin/hooks/hooks.json` only if schema needs adjustment
  - proposed fixtures: `plugin/hooks/__fixtures__/detect-trails/`
  - proposed tests: `scripts/__tests__/detect-trails-hook.test.ts`
  - `plugin/README.md`
- Detect likely Trails projects through dependency keys, `package.json.trails.module`, `trails.config.*`, `.trails/`, and guarded topo-source conventions.
- Stay silent outside likely Trails projects.
- Suggest non-mutating Warden probes only when actionable.
- Warn about version drift only through `TRL-749` policy.
- Consume installed-skill drift checks from `TRL-750`; do not reimplement sync.
- Keep startup skill-load copy aligned with `TRL-748`.

Verification:

- `bun test scripts/__tests__/detect-trails-hook.test.ts`
- `bun run format:check`
- `git diff --check`

Done when:

- Hook output is tested, quiet outside Trails projects, and explicit about Claude versus Codex support.

### Phase 8: `TRL-752` Dogfood Smoke

Intent:

- Prove the refreshed plugin/skill bundle can guide a fresh agent through building with Trails from scratch.

Actions:

- Use `.trails-tmp/plugin-dogfood/` or a disposable tempdir. Do not commit the generated consumer project.
- Commit a dogfood report at `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/trl-752-dogfood.md`.
- Exercise:
  - install/scaffold path
  - simple trail with input/output/examples
  - CLI via `@ontrails/commander`
  - MCP via `@ontrails/mcp`
  - HTTP via Hono or `@ontrails/http/bun`
  - resource with `mock` or documented `unmockable`
  - `testAll()` plus `createHttpHarness()` or `testSurfaceParity()` where practical
  - Warden check
  - docs guidance for common errors including `VersionNotSupportedError`
  - local installed skill currentness check from `TRL-750`
  - PatchOS-retro checks: explicit MCP include-list safety, output schemas, resource mocks or `unmockable`, error taxonomy normalization, opt-in observe/tracing that keeps CLI/MCP output clean, `trails compile` / `trails validate`, and package install policy (`@beta` or explicit beta.N versus accidental `latest`)
- Record whether adjacent PatchOS-derived issues `TRL-757` through `TRL-760` block plugin release or remain deferred follow-ups.
- Clean generated runtime state, or record why it was preserved.

Verification:

- Dogfood app typecheck/test/Warden commands, recorded in the dogfood report.
- `bun run format:check`
- `git diff --check`

Done when:

- Fresh dogfood is green, or every failed/skipped smoke is recorded with the smallest next action.

### Phase 9: `TRL-753` Release Path And Dry Run

Intent:

- Document and prepare the release/republish path after the refreshed plugin is dogfooded.

Actions:

- Verify generated Warden guidance is current.
- Verify local installed skill path is current or intentionally decoupled.
- Verify Claude runtime precedence when repo plugin and global skill share `trails`, if safely possible.
- Document `npx skills outfitter-dev/trails` behavior only in a disposable/approved target; otherwise mark externally/manual blocked.
- Update `plugin/README.md`, root install docs, and release runbook.
- Record what changed since plugin `0.3.0`.
- Include `TRL-755` status in final project update.
- Coordinate with `TRL-759`: release/install docs must not imply `latest` is the current beta. If the repo remains on the beta track with `latest` intentionally lagging, tell consumers to use explicit beta.N pins or the `beta` dist-tag.
- Do not publish or mutate registries/marketplace/global installs unless Matt explicitly approves during the run.

Verification:

- `bun run plugin:metadata:check` if added.
- `bun run plugin:installed-skill:check` if added.
- `bun run warden:skills:check`
- `bun run warden:agents:check`
- `bun run clark:check`
- `bun run format:check`
- `git diff --check`
- Release dry-run or explicit manual/external blocker recorded in `RETRO.md`.

Done when:

- The plugin is release-ready or explicitly blocked on an operator-only external action.

## Validation Ladder

Minimum per-branch checks:

- `bun run format:check`
- `git diff --check`

Generated guidance checks whenever touched:

- `bun run warden:skills:sync`
- `bun run warden:agents:sync`
- `bun run warden:skills:check`
- `bun run warden:agents:check`
- `bun run clark:check`

Targeted tests:

- `bun test scripts/__tests__/sync-plugin-metadata.test.ts`
- `bun test scripts/__tests__/check-installed-trails-skill.test.ts`
- `bun test scripts/__tests__/detect-trails-hook.test.ts`

Stack-tip checks after implementation:

- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run build`
- `bun run check`
- `git diff --check`

Release/dogfood checks:

- `bun run publish:check` only if package/plugin release packaging assumptions are touched and it is useful as a dry check.
- No `bun run publish:packages`, marketplace publish, registry mutation, `npx skills` mutation, or global installed skill mutation without explicit approval.

## Local Review

Run at least three local review passes from the stack tip before remote submission:

1. Skill/docs doctrine: public docs, main skill, references, examples, package taxonomy, error/resource/testing/composition guidance.
2. Tooling/hooks safety: metadata policy/checks, installed-skill checker, hook detection, no global mutation, no noisy non-Trails behavior.
3. Dogfood/release readiness: smoke report, release runbook, stop rules, local/global install guidance, operator-only actions.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary
- Findings with P0/P1/P2/P3 severity and evidence
- Prompt To Fix With AI for each actionable finding

Fix all P0/P1/P2 findings bottom-up before submitting or marking ready.

## Source-Control Rules

- Use Graphite.
- Create the full local chain up front if useful, but do not submit or push empty branches.
- This packet is pre-seeded on `main` via PR #559. `TRL-755` inherits it automatically; commit only branch-local archive/path-reference updates there.
- Main agent owns all source-control writes.
- Subagents may edit files and run checks but must not run `git`/`gt` write commands.
- Do not use `gt absorb`.
- Do not add merge queue labels.
- Do not merge.

## Tracker Plan

- Keep `TRL-755` in the project as the base public-docs/source-truth cleanup; do not move it out unless a live Linear/project owner decision changes.
- Ensure the Linear dependency chain is represented:
  - `TRL-755` blocks `TRL-746`
  - `TRL-746` blocks `TRL-747`
  - `TRL-747` blocks `TRL-748`
  - `TRL-748` blocks `TRL-749`
  - `TRL-749` blocks `TRL-750`
  - `TRL-750` blocks `TRL-751`
  - `TRL-751` blocks `TRL-752`
  - `TRL-752` blocks `TRL-753`
- Update issue bodies/comments if M1 report paths move to archive.
- Leave final project status update in Linear at the end of `TRL-753`.

## Remote Review

- Submit draft PRs only after implementation, local verification, and local review are clean/P3-only.
- PR bodies must include context, changes, verification, risk/rollout notes, and Linear links.
- Mark ready only after CI and local review are clean/P3-only.
- After ready, check CI, unresolved review threads, and code-review bot/agent summaries.
- Record numeric review scores, prose summaries, prompt-to-fix text, and fix outcomes in `RETRO.md`.
- Resolve all P0/P1/P2 feedback from the owning lower branch upward.
- Treat pending Graphite mergeability by itself as service lag when GitHub checks/review are otherwise clean.

## Stop / Pause Rules

Stop and ask if:

- The M1 audit stack is not actually present on `main`.
- A public API or doctrine decision is required beyond the M1 findings and issue bodies.
- The work requires publish, registry mutation, marketplace mutation, `npx skills` mutation, global installed skill mutation, secrets, or credentials without explicit approval.
- A hook would need to mutate files or run noisy checks by default.
- Linear writes are unavailable and tracker references cannot be corrected after archiving M1.
- Verification fails for unrelated reasons after one focused retry.
- More than four post-ready remote-review turns pass and P2+ feedback remains unresolved.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state was fetched after M1 merge.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are avoided as load-bearing inputs.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
