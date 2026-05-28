---
created: 2026-05-21T21:29:29Z
updated: 2026-05-22T20:49:43Z
description: Detailed execution plan for M1 of the Trails Plugin & Skills One-Stop Shop project. Defines objective, completion conditions, non-goals, source-of-truth reading order, phased work plan (sync, stack creation, TRL-745 through TRL-754), tracker plan, source-control and retro discipline, validation ladder, local review contract, and stop/pause rules.
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
  - .agents/plans/archive/2026-05-21-plugin-skills-m1-audit/REFS.md
  - .agents/plans/archive/2026-05-21-plugin-skills-m1-audit/RETRO.md
  - README.md
  - docs/lexicon.md
  - docs/architecture.md
  - docs/contributing/language-styleguide.md
  - docs/contributing/code-standards.md
  - docs/warden.md
  - docs/adr/README.md
---

# Goal Plan: plugin-skills-m1-audit

- **Date:** 2026-05-21
- **Status:** Ready for execution

> Note: this packet intentionally records Matt's local checkout and installed-skill roots as point-in-time M1 evidence. Treat `/Users/mg/...` paths as audit coordinates, not portable implementation defaults; downstream scripts and docs should use repo-relative paths or `$HOME`-relative skill roots.

## Objective

Execute M1 of the Trails Plugin & Skills One-Stop Shop project: build a current, evidence-backed truth map for the repo plugin, installed skill surfaces, package/subpath coverage, and hook opportunities, then synthesize those findings into precise Linear updates and a ready implementation stack for M2/M3.

This is an audit and planning sprint. The goal is to make the next implementation run obvious, not to refresh the plugin content yet.

## Completion Condition

The goal is complete only when:

- Four source-backed audit reports exist under `.agents/plans/2026-05-21-plugin-skills-m1-audit/reports/`:
  - `trl-745-package-coverage.md`
  - `trl-742-repo-plugin-doctrine.md`
  - `trl-743-distribution-surfaces.md`
  - `trl-744-hook-opportunities.md`
- `reports/trl-754-synthesis.md` exists and turns the audit findings into an exact M2/M3 execution stack, with issue IDs, branch names, file targets, acceptance criteria, and verification expectations.
- Linear project `Trails Plugin & Skills One-Stop Shop` is current:
  - `TRL-742`, `TRL-743`, `TRL-744`, `TRL-745`, and `TRL-754` have comments linking to their report paths and summarizing findings.
  - Downstream issues `TRL-746` through `TRL-753` have been updated where the audits reveal stale scope, missing file targets, or incorrect assumptions.
  - Any newly discovered follow-up has a focused Linear issue, or is explicitly recorded in `RETRO.md` as deferred/out of scope with a reason.
- A local review of the audit packet and synthesis has run before remote submission, and every P0/P1/P2 report or tracker gap has been fixed.
- The five-branch audit stack has been submitted as draft or ready according to the source-control plan, with high-quality PR bodies if PRs are created.
- `git diff --check`, `bun run format:check`, `bun run warden:skills:check`, `bun run warden:agents:check`, and `bun run clark:check` pass, or any skipped check is justified in `RETRO.md`.
- No plugin refresh implementation, publish, registry mutation, merge, merge queue label, or global installed skill mutation occurred.
- `RETRO.md` has final tracker, branch/PR, review, verification, forbidden-action, remaining-risk, and archive-readiness state, and the final transcript reports the proof.

## Non-Goals

- Do not implement M2/M3/M4 plugin refresh work in this goal. Updating issue bodies and adding audit reports is in scope; changing the plugin guidance itself is not.
- Do not republish the plugin or mutate any marketplace, npm, or registry state.
- Do not mutate `~/.agents/skills/trails`, `~/.config/claude/skills/trails`, or other global installed skill paths. Inspect them read-only for `TRL-743`.
- Do not treat the installed/global `trails` skill as doctrine. It is known to be stale; use it only as an audited artifact.
- Do not rely on ignored `.scratch/` or local-only notes as source of truth unless the necessary evidence is copied or summarized into this tracked packet.
- Do not merge. Do not add merge queue labels.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-21-plugin-skills-m1-audit/PLAN.md`
4. `.agents/plans/2026-05-21-plugin-skills-m1-audit/REFS.md`
5. Linear project: `Trails Plugin & Skills One-Stop Shop`
6. Linear issues: `TRL-741`, `TRL-742`, `TRL-743`, `TRL-744`, `TRL-745`, `TRL-754`
7. Downstream Linear issues to refresh from the synthesis: `TRL-746`, `TRL-747`, `TRL-748`, `TRL-749`, `TRL-750`, `TRL-751`, `TRL-752`, `TRL-753`
8. Current repo docs and code:
   - `README.md`
   - `AGENTS.md`
   - `docs/lexicon.md`
   - `docs/architecture.md`
   - `docs/contributing/language-styleguide.md`
   - `docs/contributing/code-standards.md`
   - `docs/warden.md`
   - `docs/adr/README.md`
   - accepted ADRs in `docs/adr/`
   - package `package.json` files and public export maps
   - `plugin/**`
   - `.claude/skills/**`
   - `.agents/skills/**` where tracked in this repo

## Work Plan

### Phase 0: Sync And Baseline

Intent:

- Ensure the executor starts from current `main` and records the live repo/PR/Linear state before auditing.

Actions:

- Run `gt sync`, then confirm branch and worktree cleanliness.
- List open PRs and Graphite stack state.
- Record the baseline in `RETRO.md`, including any existing plan-packet changes.
- Confirm the M1 Linear issues are still assigned to milestone `M1: Audit and truth map` and that `TRL-754` is blocked by `TRL-742`, `TRL-743`, `TRL-744`, and `TRL-745`.

Verification:

- `git status --short --branch`
- `gt log --stack --reverse --no-interactive`
- `gh pr list --repo outfitter-dev/trails --state open --json number,title,headRefName,isDraft,mergeable,reviewDecision,updatedAt`

Done when:

- `RETRO.md` names the starting branch, stack state, open PRs, and any collision risks.

### Phase 1: Create The Local Audit Stack

Intent:

- Keep M1 reviewable as one report-producing PR per audit issue, with synthesis last.

Actions:

- From current `main`, create the local Graphite stack in this bottom-to-top order:
  1. `TRL-745` - `trl-745-audit-plugin-coverage-for-current-packages-adapters-and`
  2. `TRL-742` - `trl-742-audit-repo-plugin-and-skills-against-current-trails-doctrine`
  3. `TRL-743` - `trl-743-audit-installed-and-distributed-trails-skill-surfaces`
  4. `TRL-744` - `trl-744-audit-trails-plugin-hook-opportunities-and-integration`
  5. `TRL-754` - `trl-754-synthesize-plugin-audits-into-an-executable-refresh-stack`
- It is fine to create the local branch chain up front. Do not submit or push empty branches.
- Commit this plan packet on the lowest branch, either as its own docs commit or with the first report.
- Main agent owns all `git` and `gt` writes. Subagents may inspect, edit report files, and run checks, but must not run source-control write commands.

Verification:

- `gt log --stack --reverse --no-interactive`
- `git branch --show-current`

Done when:

- The five local branches exist in order and no empty branch has been submitted.

### Phase 2: `TRL-745` Package And Subpath Truth Map

Intent:

- Establish the live package, adapter, subpath, and CLI/export facts that the plugin should teach.

Actions:

- Inventory current public packages and key subpaths:
  - `@ontrails/core`
  - `@ontrails/cli`
  - `@ontrails/commander`
  - `@ontrails/mcp`
  - `@ontrails/http`
  - `@ontrails/http/bun`
  - `@ontrails/hono`
  - `@ontrails/store`
  - `@ontrails/drizzle`
  - `@ontrails/config`
  - `@ontrails/permits`
  - `@ontrails/observe`
  - `@ontrails/tracing`
  - `@ontrails/logtape`
  - `@ontrails/pino`
  - `@ontrails/testing`
  - `@ontrails/topographer`
  - `@ontrails/warden`
  - `@ontrails/wayfinder`
  - `@ontrails/vite`
- Compare package truth against:
  - root `README.md`
  - package READMEs
  - `plugin/skills/trails/**`
  - `plugin/agents/trail-engineer.md`
  - `plugin/rules/**`
- Capture missing, stale, or confusing coverage in `reports/trl-745-package-coverage.md`.
- For each finding, include evidence: path, line, quoted text or command summary, and the downstream issue that should absorb it.

Verification:

- `fd package.json packages apps plugin -E node_modules -E .turbo`
- `jq -r '.name + " " + .version' packages/*/package.json`
- `jq '.exports // empty' packages/*/package.json`
- `bun apps/trails/bin/trails.ts --help`
- `rg -n "@ontrails/(core|cli|commander|mcp|http|hono|store|drizzle|config|permits|observe|tracing|logtape|pino|testing|topographer|warden|wayfinder|vite)|http/bun|Bun-native|adapter|surface|facet" README.md docs packages plugin .claude .agents`

Done when:

- `reports/trl-745-package-coverage.md` contains a package/subpath matrix, plugin coverage gaps, and exact downstream issue routing.

### Phase 3: `TRL-742` Repo Plugin Doctrine Audit

Intent:

- Compare the repo-tracked plugin and skill bundle against current Trails doctrine and code reality.

Actions:

- Audit:
  - `plugin/skills/trails/SKILL.md`
  - `plugin/skills/trails/references/**`
  - `plugin/skills/trails/templates/**`
  - `plugin/skills/trails/examples/**`
  - `plugin/skills/trails-*/*`
  - `plugin/agents/trail-engineer.md`
  - `plugin/rules/**`
  - `plugin/hooks/**`
  - tracked `.claude/skills/**` and `.agents/skills/**` surfaces in this repo
- Compare against current doctrine:
  - lexicon and language style
  - trail/blaze/topo/surface/resource/layer/cross/signal/contour grammar
  - adapters/facets/package taxonomy
  - Warden generated guidance and rule IDs
  - current CLI commands and surface names
- Use `qmd` for local documentation search when it helps with semantic docs lookup, and `rg` for exact stale vocabulary sweeps.
- Capture all findings in `reports/trl-742-repo-plugin-doctrine.md`.
- Route each finding to one of:
  - M2 main skill refresh (`TRL-746`)
  - M2 references/templates/examples refresh (`TRL-747`)
  - M2 agent/rules/advisory skill refresh (`TRL-748`)
  - M3 metadata/drift/hook items (`TRL-749`, `TRL-750`, `TRL-751`)
  - M4 dogfood/release items (`TRL-752`, `TRL-753`)
  - new follow-up issue

Verification:

- `bun run warden:skills:check`
- `bun run warden:agents:check`
- `bun run clark:check`
- `bun apps/trails/bin/trails.ts warden guide --manifest`
- `rg -n "trailhead|transport|connector|topo\\.show|metadata|route|handler|impl|registry|middleware|service|dependency|follow" plugin .claude .agents README.md docs`

Done when:

- `reports/trl-742-repo-plugin-doctrine.md` names stale doctrine, missing doctrine, current-good areas, and downstream issue routing with source-backed evidence.

### Phase 4: `TRL-743` Installed And Distributed Surface Audit

Intent:

- Map every place a Trails plugin/skill can be loaded from and identify drift between repo truth, local installs, and distribution metadata.

Actions:

- Inspect read-only:
  - repo plugin source: `plugin/**`
  - marketplace manifests: `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`
  - local installed skill surfaces such as `/Users/mg/.agents/skills/trails` and `/Users/mg/.config/claude/skills/trails`
  - Codex-visible and Claude-visible symlink/copy paths where discoverable
  - README or plugin install instructions for Claude Code, Codex, Cursor, and local development
  - plugin version metadata versus `metadata.trails.version` and current package versions
- Do not mutate global installed paths.
- Produce a distribution matrix in `reports/trl-743-distribution-surfaces.md`.
- Identify whether M3 should implement sync, check, symlink, or explicit decoupling behavior.

Verification:

- `ls -la plugin/skills/trails /Users/mg/.agents/skills/trails /Users/mg/.config/claude/skills/trails`
- `readlink /Users/mg/.config/claude/skills/trails || true`
- `diff -qr plugin/skills/trails /Users/mg/.agents/skills/trails || true`
- `rg -n "version|metadata\\.trails|Claude|Codex|Cursor|install|plugin|skills/trails" README.md plugin .claude-plugin .agents .claude`

Done when:

- `reports/trl-743-distribution-surfaces.md` documents every known load surface, whether it is repo-owned or global/local, how it currently drifts, and exactly which follow-up issue owns correction.

### Phase 5: `TRL-744` Hook And Integration Audit

Intent:

- Identify hook opportunities that make Trails agent support feel native without becoming noisy, surprising, or mutating broad surfaces.

Actions:

- Audit current and possible hooks around:
  - Claude plugin `SessionStart` detection in `plugin/hooks/detect-trails.sh`
  - version mismatch detection between plugin `metadata.trails.version` and installed `@ontrails/core`
  - project detection via `package.json`, `trails.config.ts`, `.trails/`, and package imports
  - Warden nudges or commands
  - command suggestions after errors
  - local development/dogfood hooks inside this repo
  - Codex versus Claude hook differences
- Evaluate noise risk, mutation risk, portability, and implementation difficulty.
- Produce `reports/trl-744-hook-opportunities.md` with a prioritized recommendation set.

Verification:

- `fd . plugin/hooks .claude .agents -E node_modules`
- `sed -n '1,220p' plugin/hooks/detect-trails.sh`
- `rg -n "hook|SessionStart|detect-trails|warden|metadata\\.trails|@ontrails/core|trails.config|\\.trails|PreToolUse|PostToolUse|Stop" plugin .claude .agents README.md docs`

Done when:

- `reports/trl-744-hook-opportunities.md` distinguishes must-have M3 checks from optional ideas, and names exact files or scripts likely to change later.

### Phase 6: `TRL-754` Synthesis And Linear Refresh

Intent:

- Convert the four audits into an executable M2/M3 plan and remove ambiguity from downstream Linear issues.

Actions:

- Read all four reports.
- Write `reports/trl-754-synthesis.md` with:
  - concise findings by domain;
  - exact stack recommendation for M2/M3, bottom to top;
  - which issues should be implemented one-PR-per-issue;
  - file targets and expected diff shape per issue;
  - verification ladder for the implementation stack;
  - explicit deferred follow-ups and why they are not in the next stack.
- Update Linear:
  - Comment on `TRL-742`, `TRL-743`, `TRL-744`, `TRL-745`, and `TRL-754` with report path and key findings.
  - Refresh descriptions or acceptance criteria for `TRL-746` through `TRL-753` when the audits supply concrete file targets, verification commands, or scope corrections.
  - Create focused follow-up issues for real discoveries that are outside M2/M3 but should not be lost.
  - Update `TRL-741` parent/project issue with an M1 summary comment.
- Do not mark issues Done unless the corresponding branch has merged. If this stack is only submitted, use comments and PR links to show state.

Verification:

- Linear issue comments or mutation summaries are recorded in `RETRO.md`.
- `reports/trl-754-synthesis.md` maps every P0/P1/P2 audit finding to an issue, an in-goal fix, or an explicit deferral.
- Downstream issues are executable without chat history.

Done when:

- The M2/M3 execution path is clear enough that a future `/goal` can build it without rediscovering M1.

## Tracker Plan

- Project: `Trails Plugin & Skills One-Stop Shop`
- Parent issue: `TRL-741`
- M1 issues in this goal:
  - `TRL-745`
  - `TRL-742`
  - `TRL-743`
  - `TRL-744`
  - `TRL-754`
- Downstream issues to refresh from synthesis:
  - M2: `TRL-746`, `TRL-747`, `TRL-748`
  - M3: `TRL-749`, `TRL-750`, `TRL-751`
  - M4 context only unless audit findings force clarification: `TRL-752`, `TRL-753`
- Dependency shape:
  - `TRL-742`, `TRL-743`, `TRL-744`, and `TRL-745` block `TRL-754`.
  - `TRL-754` should block implementation work in M2/M3 until its synthesis is complete.
- Follow-up creation rule:
  - Create a new issue only for a concrete discovery with a clear owner, scope, and acceptance criteria.
  - Record speculative or low-confidence ideas in `RETRO.md`, not Linear.

## Source-Control Plan

- Branching model: Graphite.
- Branch order, bottom to top:
  1. `trl-745-audit-plugin-coverage-for-current-packages-adapters-and`
  2. `trl-742-audit-repo-plugin-and-skills-against-current-trails-doctrine`
  3. `trl-743-audit-installed-and-distributed-trails-skill-surfaces`
  4. `trl-744-audit-trails-plugin-hook-opportunities-and-integration`
  5. `trl-754-synthesize-plugin-audits-into-an-executable-refresh-stack`
- Commit shape:
  - one report-producing commit per branch is enough;
  - keep Linear/tracker comment summaries in `RETRO.md`;
  - keep `RETRO.md` updates on the top synthesis branch when they summarize whole-stack state.
- PR strategy:
  - submit as draft after local audit reports and verification are clean;
  - mark ready only after local review is clean/P3-only, PR bodies are clear, and checks pass;
  - do not merge.
- Cleanup before merge:
  - before a future merge, final-update `RETRO.md`;
  - after merge, move the packet to `.agents/plans/archive/` in a closeout branch if this repo convention is being followed.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful tracker, report, verification, local review, remote review, CI, PR-body, or packaging state changes.
- For stacked work, touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state, tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted report proof:
  - `test -f .agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-745-package-coverage.md`
  - `test -f .agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-742-repo-plugin-doctrine.md`
  - `test -f .agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-743-distribution-surfaces.md`
  - `test -f .agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-744-hook-opportunities.md`
  - `test -f .agents/plans/2026-05-21-plugin-skills-m1-audit/reports/trl-754-synthesis.md`
- Generated guidance checks:
  - `bun run warden:skills:check`
  - `bun run warden:agents:check`
  - `bun run clark:check`
- Docs/format checks:
  - `bun run format:check`
  - `git diff --check`
- Full repo check:
  - Not required for reports-only branches.
  - If the executor changes source, plugin hooks, generated guidance, package files, or scripts, run `bun run check` and any narrower relevant tests.

## Local Review

Run local review before submitting or marking ready. The review focus is audit correctness and downstream executability, not code behavior.

- Lane 1: evidence integrity - every report claim has a path, quote, command summary, or explicit unknown.
- Lane 2: tracker alignment - every M1 finding routes to the right Linear issue, new issue, or explicit deferral.
- Lane 3: implementation readiness - M2/M3 issues are precise enough for an executor to implement without redoing the audit.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt to fix: concise prompt for each actionable finding

Fix all P0/P1/P2 findings before remote submission or final handoff. Summarize each round and its fix outcome in `RETRO.md`.

For remote code-review bots/agents, also record summary scores, prose summaries, prompt-to-fix blocks, and whether any score below 5/5 reflects current unresolved debt, stale feedback, or an explicitly rejected recommendation.

## Progress Reporting

After each execution turn, report:

- Current checkpoint
- What changed
- What was verified
- Command/output summary
- What remains
- Blocker status
- Next checkpoint

## Stop / Pause Rules

Stop and ask if:

- The M1 Linear graph or branch names differ from this plan in a way that changes stack order.
- The audits reveal a doctrine/API decision that must be settled before downstream issues can be made executable.
- The work would require mutating global installed skill paths, publishing the plugin, changing package releases, or touching registries.
- The executor would need to implement plugin/source changes rather than documenting and routing them.
- Linear writes are unavailable and tracker truth cannot be updated.
- Verification fails for unrelated repo reasons after one focused retry.
- A code-review bot/agent error persists after rerun or cannot be explained.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state was fetched during planning.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are avoided as load-bearing inputs.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
