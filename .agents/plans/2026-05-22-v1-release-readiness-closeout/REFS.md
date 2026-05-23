# References: v1-release-readiness-closeout

## Tracked / Portable Sources

- `AGENTS.md` - repo workflow, Graphite, Bun, Linear, release, Warden, and subagent rules.
- `.agents/plans/PLANNING.md` - project-specific goal planning preferences.
- `docs/adr/0048-trail-versioning-v3.md` - current trail-versioning doctrine for marker and force audits.
- `docs/releases/stable-cutover.md` - stable release checklist that may need pending-force gate updates.
- `docs/releases/beta15.md` - existing beta line release notes and migration entrypoint.
- `docs/migration/trailhead-to-surface.md` - focused migration guide to link from beta.15 to beta.18 guide.
- `docs/migration/connector-to-adapter.md` - focused migration guide to link from beta.15 to beta.18 guide.
- `docs/migration/logging-to-observe.md` - observability/logging migration source.
- `docs/migration/layer-evolution.md` - focused migration source.
- `docs/migration/topograph-artifact-family.md` - Topographer artifact-family migration source.
- `packages/testing/package.json` - export map, peer dependency, and changeset impact for `TRL-757`.
- `packages/testing/src/index.ts` - current root export surface for `@ontrails/testing`.
- `packages/testing/src/types.ts` - current surface-specific type import risk.
- `packages/testing/src/all.ts` - current `testAllEstablished` surface harness coupling.
- `packages/testing/src/harness-http.ts`, `packages/testing/src/harness-cli.ts`, `packages/testing/src/harness-mcp.ts`, `packages/testing/src/surface-parity.ts` - likely subpath owners.
- `plugin/skills/trails/references/testing-patterns.md` - plugin testing guidance to update after `TRL-757`.
- `plugin/skills/trails/references/architecture.md` - Topographer wording target for `TRL-758`.
- `plugin/skills/trails/references/cli-surface.md` - CLI command guidance target.
- `README.md`, `docs/index.md`, `docs/api-reference.md`, `docs/testing.md`, `docs/topo-store.md` - public docs affected by the sprint.

## Untracked / Local-Only Sources

- `/Users/mg/patch/.agents/plans/2026-05-21-patchos-trails-modernization/TRAILS-UPSTREAM-RETRO.md` - downstream dogfood evidence for `TRL-757` through `TRL-760`. Use as input only; summarize load-bearing details in tracked docs/reports.
- `.claude/worktrees/` - unrelated local untracked worktree state observed during planning; ignore unless the executor intentionally uses that worktree.

## Copied Or Summarized Sources

- None yet. During execution, summarize any PatchOS-retro-only details that become load-bearing in `reports/` or the migration guide.

## Tracker Records

- `TRL-767` - pending force events as v1 stable cutover gate; Todo; v1 Release Prep; branch `trl-767-audit-pending-force-events-as-a-v1-stable-cutover-gate`.
- `TRL-766` - version marker failure UX and bounded Zod diagnostics; Todo; v1 Release Prep; branch `trl-766-audit-version-marker-failure-ux-and-bounded-zod-diagnostics`.
- `TRL-756` - v1 doctrine and lexicon drift audit; Todo; v1 Release Prep; branch `trl-756-audit-v1-doctrine-and-lexicon-drift-after-versioning-m3`.
- `TRL-757` - split `@ontrails/testing` surface harnesses behind subpaths; Todo; v1 Release Prep; branch `trl-757-split-ontrailstesting-surface-harnesses-behind-subpaths`.
- `TRL-758` - clarify Topographer artifact CLI workflow and retired topo commands; Todo; v1 Release Prep; branch `trl-758-clarify-topographer-artifact-cli-workflow-and-retired-topo`.
- `TRL-759` - beta channel install policy and version bump cadence; Todo; v1 Release Prep; branch `trl-759-document-beta-channel-install-policy-and-version-bump`.
- `TRL-760` - beta.15 to beta.18 downstream migration guide; Todo; v1 Release Prep; branch `trl-760-add-beta15-to-beta18-downstream-migration-guide`.
- `TRL-765` - related versioning derivation pipeline audit; out of scope unless included audits prove stable cutover is blocked by it.
- `TRL-508` - codemod/trailworks migration path; explicitly out of scope.

## PRs / Branches

- No open PRs at planning time.
- `main` at planning time: `df16dfb33 docs: archive plugin skills refresh plan (#569)`.
- Previously merged PR #569 archived the plugin skills refresh packet.

## Prior Plans

- `.agents/plans/2026-05-21-plugin-skills-refresh-stack/` - archived by PR #569; no longer active.
- `.scratch/2026-05-12-topograph-query-docs-stack/PLAN.md` - historical Topographer artifact-family planning; use only as background if current docs/code are ambiguous.
- `.scratch/2026-05-05-merge-readiness/fix-plan.md` - historical example of detailed goal packet style; not a source of truth for this work.

## Validation Commands

- `gt sync --no-interactive` - update local Graphite/main state before branching.
- `git status --short --branch` - confirm current branch and local dirt.
- `gt log --stack --reverse --no-interactive` - verify local stack order.
- `gh pr list --state open --json number,title,headRefName,isDraft,url` - verify no conflicting open PRs.
- `bun apps/trails/bin/trails.ts --help` - verify top-level CLI command grammar.
- `bun apps/trails/bin/trails.ts topo --help` - verify retired topo subcommands are not advertised.
- `bun run docs:links` - relative Markdown link integrity.
- `bun run docs:snippets` - README snippet typecheck.
- `bun run docs:api-examples` - public API example gate.
- `bun run typecheck` - repo typecheck.
- `bun run test` - repo test suite.
- `bun run build` - repo build.
- `bun run check` - broad repo gate.
- `bun run publish:check` - dry-run pack/publish readiness without registry mutation.
- `bun run publish:registry-check` - read-only registry/dist-tag preflight.
- `git diff --check` - whitespace/conflict marker guard.
