---
created: "2026-06-01T17:30:00-04:00"
updated: "2026-06-01T17:47:00-04:00"
status: staged-outside-worktree
eventual_repo_packet: ".agents/plans/2026-06-01-agent-trust-stable-cutover-integrity"
---

# Goal Prompt

Paste this into the executor once the packet has been copied into the dedicated
execution worktree.

````text
/goal

Use the current delegated Codex worktree as cwd. First run `pwd -P` and treat
that resolved path as authoritative. Do not execute from the coordinator's
primary worktree.

You are executing the Trails Agent Trust / Stable Cutover Integrity stack. First read `.agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/{PLAN.md,REFS.md,RETRO.md}` plus `AGENTS.md`, `docs/adr/0048-trail-versioning-v3.md`, and `.agents/plans/PLANNING.md`.

Objective: build one Graphite stack that makes Trails' trust loop reliable for agents/release reviewers: no silent version-marker semantic collisions; Warden catches unsupported marker schemas early; `trails doctor` reports actionable pending-force evidence; Regrade preserves Warden scan-target truth; adapter catalog wildcard exports work; capstone is a read-only checkpoint verdict over existing evidence.

Preflight before any write: run `git status --short`, `git diff --stat`, `git worktree list --porcelain`, `gt log --no-interactive`, and open-PR query. This cwd must be a dedicated worktree on a real Graphite-tracked branch, preferably first branch `trl-772-make-version-markers-account-for-or-reject-zod-validation`; do not proceed from detached HEAD. Do not run `gt sync` unless explicitly authorized after live-state inspection.

Stack order: TRL-772, TRL-773, TRL-770, TRL-769, conditional TRL-771, TRL-878, TRL-877, conditional TRL-872, then a tracked/read-only checkpoint verdict branch only after creating/choosing its Linear issue or confirming a non-issue branch with Matt. Use exact Linear branch names and `gt create` for children. Use Graphite for source-control writes; stage specific files before `gt modify -c -m`. Do not use `gt absorb`. Dry-run `gt submit --stack --draft --restack --no-edit --no-interactive` before real submit. Do not merge, queue, publish, or mutate registry state. Subagents must not run git/gt/PR/Linear write commands.

Critical boundary: the checkpoint first slice is read-only and evidence-based. It must not mutate git, Graphite, GitHub, Linear, source files, lockfiles, generated artifacts, or run broad shell gates as its own behavior. Verdict vocabulary is separate from rule severity: pass/caution/block/reroute.

Loop: report checkpoint, files changed, commands run with results, remaining work, blocker status, and next checkpoint. Keep `RETRO.md` current after meaningful changes, review rounds, verification, PR submission, ready-for-review, and handoff. Final completion is invalid unless `RETRO.md` has final branch/PR/review/CI/verification/forbidden-action state.

Validation: use narrow tests per branch, then broaden at the tip. Expected focused checks include version-marker, topographer derive, Warden trail-versioning rules, Trails doctor/version lifecycle/survey, Regrade report, adapter-kit catalog/check, Warden adapter-check, and Trails adapter-check tests. Before draft submission run lint, lint:ast-grep, format:check, typecheck, test, build, check, publish:check, and git diff --check unless a skipped check is explicitly justified in `RETRO.md`. Run ADR and Warden guide sync/check commands when those surfaces change.

Stop and ask if main/Linear/PR state invalidates the order, TRL-772 requires broad Zod support rather than bounded rejection, checkpoint pressure wants mutation/autofix/shell-runner behavior, TRL-771 sprawls into broad exception governance, P0/P1/P2 review debt remains after four post-ready turns, or secrets/production/publish/merge actions are needed.
````

## Copy-In Step

Before using the prompt, copy the staged packet into the execution worktree:

```bash
pwd -P
mkdir -p .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity
cp -R /Users/mg/.agents/plans/trails/2026-06-01-agent-trust-stable-cutover-integrity/. .agents/plans/2026-06-01-agent-trust-stable-cutover-integrity/
```

After that copy, the in-worktree packet becomes the active source of truth.
