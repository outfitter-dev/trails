# References: plugin-skills-refresh-stack

## Repo Guidance

- `AGENTS.md` - Trails repo guidance, Graphite workflow, lexicon, Warden rule index, and release/testing expectations.
- `.agents/plans/PLANNING.md` - repo-local goal-planning conventions.

## M1 Audit Sources

Before Phase 1 archive:

- `.agents/plans/2026-05-21-plugin-skills-m1-audit/PLAN.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/RETRO.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md`
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-754-synthesis.md`

After Phase 1 archive:

- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/PLAN.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/RETRO.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md`
- `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/reports/trl-754-synthesis.md`

## Downstream Dogfood Evidence

- PatchOS beta.15 -> beta.18 modernization retro - operator-local evidence from the PatchOS repo. If the PatchOS checkout is accessible, fetch `TRAILS-UPSTREAM-RETRO.md` from that repo; otherwise use the summarized PatchOS findings in this packet's `RETRO.md`. Relevant evidence areas: package install policy, skill freshness, testing helper boundaries, Topographer workflow, MCP include-list safety, resource mocks, error taxonomy, observe/tracing adoption, and migration docs.

## Tracker Records

- Project: `Trails Plugin & Skills One-Stop Shop`
- `TRL-755` - public docs drift base branch.
- `TRL-746` - main Trails skill refresh.
- `TRL-747` - references/templates/examples refresh.
- `TRL-748` - agent/rules/advisory skill/hook copy refresh.
- `TRL-749` - plugin metadata sync and drift checks.
- `TRL-750` - local installed skill sync/check path.
- `TRL-751` - plugin hooks for project detection and version guidance.
- `TRL-752` - fresh consumer dogfood.
- `TRL-753` - plugin release path and dry run.

Adjacent PatchOS-derived v1 follow-ups:

- `TRL-757` - split `@ontrails/testing` surface harnesses behind subpaths.
- `TRL-758` - clarify Topographer artifact CLI workflow and retired topo commands.
- `TRL-759` - document beta channel install policy and version bump cadence.
- `TRL-760` - add beta.15 to beta.18 downstream migration guide.

## Source Artifacts

- `README.md` - public package table and install docs.
- `docs/api-reference.md` - public error taxonomy list.
- `docs/architecture.md` - current package taxonomy source.
- `docs/lexicon.md` - vocabulary source.
- `docs/contributing/language-styleguide.md` - language/field names.
- `plugin/skills/trails/SKILL.md` - main skill entrypoint.
- `plugin/skills/trails/references/**` - deep skill docs.
- `plugin/skills/trails/templates/**` - copyable templates.
- `plugin/skills/trails/examples/**` - example snippets.
- `plugin/agents/trail-engineer.md` - plugin agent profile.
- `plugin/rules/**` - plugin rules.
- `plugin/hooks/**` - Claude plugin hooks.
- `.claude/skills/clark/references/calibrate.md` - Clark calibration vocabulary.
- `.claude-plugin/marketplace.json` - marketplace metadata.
- `plugin/.claude-plugin/plugin.json` - plugin manifest metadata.
- `packages/*/package.json` and `adapters/*/package.json` - package/version/export maps.
- `packages/core/src/errors.ts` - error taxonomy owner.
- `packages/testing/**` - testing helpers and surface harnesses.
- `scripts/publish.ts` and `scripts/check-registry-preflight.ts` - beta dist-tag and registry posture checks.
- `.changeset/pre.json` - current prerelease channel source (`tag: beta`).
- `docs/releases/stable-cutover.md` and `docs/adr/0047-stable-release-line-discipline.md` - release-channel doctrine and runbook.

## Commands

- `gt sync` - refresh local Graphite state.
- `git status --short --branch` - branch/dirtiness baseline.
- `gt log --stack --reverse --no-interactive` - stack order proof.
- `bun run warden:skills:sync` - regenerate skill Warden guide when needed.
- `bun run warden:agents:sync` - regenerate agent Warden guide when needed.
- `bun run warden:skills:check` - skill guidance drift check.
- `bun run warden:agents:check` - agent guidance drift check.
- `bun run clark:check` - Clark generated wrapper drift check.
- `bun test scripts/__tests__/sync-plugin-metadata.test.ts` - metadata policy tests.
- `bun test scripts/__tests__/check-installed-trails-skill.test.ts` - installed skill drift checker tests.
- `bun test scripts/__tests__/detect-trails-hook.test.ts` - hook detection tests.
- `bun run typecheck` - full typecheck.
- `bun run test` - full test suite.
- `bun run lint` - lint.
- `bun run build` - build.
- `bun run check` - repo aggregate check.
- `bun run format:check` - formatting check.
- `git diff --check` - whitespace/conflict marker check.

## Known Starting State

- Current `main` after `gt sync`: `20564d6bc docs: synthesize plugin audit stack (#558)`.
- The M1 audit packet was merged under `.agents/plans/2026-05-21-plugin-skills-m1-audit/`; Phase 1 archives it under `.agents/plans/archive/2026-05-21-plugin-skills-m1-audit/`.
- `TRL-755` remains in the plugin project and is intentionally included as the base branch.
- `TRL-753` explicitly forbids publish/registry/marketplace/global-skill mutation without approval; preserve that stop rule.

## Planned Report Paths

- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-1-skill-docs.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-2-tooling-hooks.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/local-review-round-3-dogfood-release.md`
- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/reports/trl-752-dogfood.md`
