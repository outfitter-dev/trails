---
created: 2026-05-21T21:29:29Z
updated: 2026-05-22T20:49:43Z
description: Reference index for the M1 plugin/skills audit. Lists repo guidance files, Linear tracker URLs for the project parent and all M1/M2/M3/M4 issues, source artifacts to audit (plugin skill/agent/rules/hooks, package manifests, docs), key CLI commands, and known starting signals from pre-execution inspection.
impl_status: implemented
linear:
  - TRL-741
  - TRL-742
  - TRL-743
  - TRL-744
  - TRL-745
  - TRL-746
  - TRL-747
  - TRL-748
  - TRL-749
  - TRL-750
  - TRL-751
  - TRL-752
  - TRL-753
  - TRL-754
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - plugin/skills/trails/SKILL.md
  - plugin/agents/trail-engineer.md
  - plugin/rules/lexicon.md
  - plugin/rules/patterns.md
  - plugin/hooks/detect-trails.sh
  - .claude/skills/
  - .agents/skills/
  - .claude-plugin/marketplace.json
  - plugin/.claude-plugin/plugin.json
  - README.md
  - docs/lexicon.md
  - docs/architecture.md
  - docs/contributing/language-styleguide.md
  - docs/contributing/code-standards.md
  - docs/warden.md
  - docs/adr/README.md
  - apps/trails/bin/trails.ts
---

# References: plugin-skills-m1-audit

> Note: absolute `/Users/mg/...` paths in this reference file are machine-local evidence from the M1 audit environment. They are not portable defaults for future implementation; use repo-relative paths or `$HOME`-relative skill roots when turning findings into scripts/docs.

## Repo Guidance

- `AGENTS.md` - Trails repo operating guidance, Graphite workflow, lexicon, Warden rule index, and release/testing expectations.
- `.agents/plans/PLANNING.md` - repo-local goal-planning conventions, including tracked packets, Graphite rules, local review, remote review, and stop rules.

## Tracker Records

- Project: `Trails Plugin & Skills One-Stop Shop`
  - URL: `https://linear.app/outfitter/project/trails-plugin-and-skills-one-stop-shop-9912d0c573e7`
- Parent:
  - `TRL-741` - `https://linear.app/outfitter/issue/TRL-741/project-trails-plugin-and-skills-one-stop-shop`
- M1:
  - `TRL-745` - `https://linear.app/outfitter/issue/TRL-745/audit-plugin-coverage-for-current-packages-adapters-and-subpaths`
  - `TRL-742` - `https://linear.app/outfitter/issue/TRL-742/audit-repo-plugin-and-skills-against-current-trails-doctrine`
  - `TRL-743` - `https://linear.app/outfitter/issue/TRL-743/audit-installed-and-distributed-trails-skill-surfaces`
  - `TRL-744` - `https://linear.app/outfitter/issue/TRL-744/audit-trails-plugin-hook-opportunities-and-integration-points`
  - `TRL-754` - `https://linear.app/outfitter/issue/TRL-754/synthesize-plugin-audits-into-an-executable-refresh-stack`
- Downstream issues to refresh from M1 evidence:
  - `TRL-746` - main Trails skill refresh.
  - `TRL-747` - references/templates/examples refresh.
  - `TRL-748` - agent/rules/advisory skills/hook messaging refresh.
  - `TRL-749` - plugin metadata sync and drift checks.
  - `TRL-750` - local installed skill sync/check path.
  - `TRL-751` - plugin hook project detection and version guidance.
  - `TRL-752` - fresh consumer dogfood smoke.
  - `TRL-753` - plugin republish and release path.

## Source Artifacts

- `plugin/skills/trails/SKILL.md` - canonical repo plugin skill entrypoint to audit.
- `plugin/skills/trails/references/**` - deep framework guidance for agents.
- `plugin/skills/trails/templates/**` - generated or reusable scaffolding examples.
- `plugin/skills/trails/examples/**` - examples that should match current Trails APIs.
- `plugin/skills/trails-*/*` - advisory skills bundled with the plugin.
- `plugin/agents/trail-engineer.md` - plugin agent profile.
- `plugin/rules/**` - plugin rule guidance.
- `plugin/hooks/**` - plugin integration hooks.
- `.claude/skills/**` - repo-tracked Claude skill surfaces.
- `.agents/skills/**` - repo-tracked Codex/agent skill surfaces.
- `.claude-plugin/marketplace.json` - marketplace metadata.
- `plugin/.claude-plugin/plugin.json` - plugin manifest metadata.
- `README.md` - public package and usage overview.
- `docs/lexicon.md` - canonical vocabulary.
- `docs/architecture.md` - framework architecture.
- `docs/contributing/language-styleguide.md` - public/contributor language rules.
- `docs/contributing/code-standards.md` - code-shape and documentation conventions.
- `docs/warden.md` - Warden user guidance.
- `docs/adr/README.md` and accepted ADRs - architectural decisions to align with.
- `packages/*/package.json` - package names, versions, exports, and dependencies.
- `apps/trails/bin/trails.ts` - CLI entrypoint for live help and command inventory.

## Commands

- `gt sync` - refresh local Graphite state before branch work.
- `git status --short --branch` - branch and dirtiness baseline.
- `gt log --stack --reverse --no-interactive` - stack order proof.
- `gh pr list --repo outfitter-dev/trails --state open --json number,title,headRefName,isDraft,mergeable,reviewDecision,updatedAt` - current open PR/collision state.
- `fd package.json packages apps plugin -E node_modules -E .turbo` - workspace package map.
- `jq -r '.name + " " + .version' packages/*/package.json` - package/version map.
- `jq '.exports // empty' packages/*/package.json` - public export map.
- `bun apps/trails/bin/trails.ts --help` - live CLI command inventory.
- `bun apps/trails/bin/trails.ts warden guide --manifest` - live Warden manifest/guidance source.
- `bun run warden:skills:check` - generated skill guidance drift check.
- `bun run warden:agents:check` - generated agent guidance drift check.
- `bun run clark:check` - Clark generated profile drift check.
- `bun run format:check` - markdown and repo formatting check.
- `git diff --check` - whitespace/conflict-marker check.

## Known Starting Signals

- Local planning observed `main` clean with Graphite showing only `main`; executor must re-run after `gt sync`.
- Linear M1 issues are currently `TRL-742`, `TRL-743`, `TRL-744`, `TRL-745`, and `TRL-754`, with `TRL-754` as the synthesis capstone.
- Previous inspection found `/Users/mg/.agents/skills/trails` and `/Users/mg/.config/claude/skills/trails` loading stale global Trails guidance with trailhead-era language. Treat that as a starting hypothesis and re-verify in `TRL-743`.
- Previous inspection found repo plugin metadata at version `0.3.0` and `plugin/skills/trails/SKILL.md` `metadata.trails.version` at `1.0.0-beta.18`. Re-verify in `TRL-743`.
- Previous inspection found `@ontrails/http` exporting `./bun`; ensure `@ontrails/http/bun` is covered in `TRL-745`.
- Previous inspection found all non-private `@ontrails/*` package versions at `1.0.0-beta.18`; re-verify package versions in `TRL-745`.
- Previous inspection found current `trails --help` commands including `compile`, `completions`, `create`, `deprecate`, `diff`, `doctor`, `guide`, `revise`, `run`, `survey`, `topo`, `validate`, `warden`, `add`, and `draft`; re-verify in `TRL-742`.

## Report Paths

- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md` - package/subpath truth map and plugin coverage matrix.
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md` - repo plugin/skills doctrine audit.
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md` - installed/distributed skill surface matrix.
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md` - hook/integration opportunity audit.
- `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-754-synthesis.md` - M2/M3 issue refresh and implementation stack recommendation.
