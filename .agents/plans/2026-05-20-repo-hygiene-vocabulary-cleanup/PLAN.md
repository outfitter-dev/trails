# Goal Plan: repo-hygiene-vocabulary-cleanup

Date: 2026-05-20
Status: Ready for execution

## Objective

Run a Linear-first cleanup sprint for Trails repo hygiene, then execute a small Graphite stack that starts with the known route-vocabulary and markdown-wrap issues and may expand only when the executor has concrete Linear evidence for additional well-scoped cleanup.

This is intentionally not the `trails migrate` / `TRL-508` implementation path. `TRL-508` remains a planning issue until its CLI/API and ownership model are settled.

## Completion Condition

The goal is complete only when:

- Linear has been audited first and the audit result is recorded in `RETRO.md`.
- Known executable issues have one PR per issue where practical:
  - `TRL-733` route phrasing fix.
  - `TRL-734` route-vocabulary audit.
  - `TRL-616` constrained markdown hard-wrap cleanup.
- Any additional stack items added by the executor have a real Linear issue, exact branch name, acceptance criteria, and evidence that they are cleanup-sized and not deferred design work.
- Tracker-only hygiene discovered during the audit is completed or explicitly deferred in `RETRO.md`; `TRL-351` should be rechecked and likely moved from Todo to Backlog if still conditional.
- Local review runs before remote submission and stops only when the latest pass is clean or P3-only.
- PRs are submitted as draft, PR bodies are high quality, CI and review are checked, PRs are marked ready only after local review and CI are clean, and post-ready remote review feedback is worked through for P2 and above.
- `RETRO.md` has final tracker, PR, review, verification, forbidden-action, remaining-risk, and archive-readiness state.
- The final transcript reports branch/PR status, Linear mutations, changed artifacts, verification commands/results, skipped checks, unresolved P3s/risks, and confirms no merge, publish, registry mutation, or merge queue label occurred.

## Non-Goals

- Do not implement `TRL-508` or start the `trails migrate` codemod path.
- Do not implement deferred activation follow-ups, Cloudflare/Vercel runtime adapters (`TRL-303`, `TRL-304`), Workbench/capability-model ideas, or broad product features.
- Do not turn `TRL-616` into an all-history rewrite. Exclude `.agents/plans/archive/**`, `.agents/notes/**`, `.scratch/**`, generated files, changelogs, and old historical docs unless the Linear audit explicitly proves they are current-facing and worth including.
- Do not change public APIs, package exports, release/versioning, or publishable package behavior.
- Do not use the local `trails` skill for execution guidance; it has been stale/confusing in earlier runs. Use `AGENTS.md`, tracked docs, Linear, and live source instead.
- Do not merge. Do not publish. Do not mutate the npm registry. Do not add merge queue labels.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `.agents/plans/PLANNING.md`
3. `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/PLAN.md`
4. `.agents/plans/2026-05-20-repo-hygiene-vocabulary-cleanup/REFS.md`
5. Linear issues:
   - `TRL-733`
   - `TRL-734`
   - `TRL-616`
   - `TRL-351`
   - `TRL-508` only to confirm it remains out of implementation scope
6. Current open PRs, especially PR #531, only to understand repo state and avoid collisions.

## Work Plan

### Phase 0: Sync And Baseline

Intent:

- Ensure the executor starts from current `main` and does not plan against stale branch state.

Actions:

- Run `gt sync`.
- Confirm current branch and worktree cleanliness.
- List open GitHub PRs and Graphite-visible stacks.
- Record the baseline in `RETRO.md`.

Verification:

- `git status --short --branch`
- `gt log --stack`
- `gh pr list --repo outfitter-dev/trails --state open --json number,title,headRefName,isDraft,mergeable,reviewDecision,updatedAt`

Done when:

- `RETRO.md` names the current branch, open PRs, and any branch/PR collision risk.

### Phase 1: Linear-First Audit

Intent:

- Frontload tracker truth before branches are created, so the stack can expand responsibly rather than opportunistically.

Actions:

- Query all `TRL` issues in `Todo`, `In Progress`, and `Backlog`.
- For each issue that looks cleanup-sized, classify it in `RETRO.md` as one of:
  - executable in this stack;
  - tracker-only hygiene;
  - planning-only;
  - deferred design/post-1.0;
  - out of scope.
- Recheck `TRL-351`. If no inline contour caller needs the permissive fallback and no implementation pressure exists, move it from `Todo` to `Backlog` and leave a comment or mutation note.
- Recheck `TRL-508` and confirm it remains Backlog/planning-only, not part of this sprint.
- Update any stale issue body/status/priority/milestone where the audit reveals concrete drift.
- Create focused follow-up issues only for real discoveries outside this goal. Put discoveries in `RETRO.md` first; do not create speculative catch-all issues.

Verification:

- Linear issue list/export or tool results recorded in `RETRO.md`.
- `RETRO.md` contains a classification table for candidate issues.

Done when:

- The executor can justify every planned PR by issue ID, branch name, and acceptance criteria.

### Phase 2: Known Branch Stack Setup

Intent:

- Create the known one-issue-per-PR skeleton after Linear is truthful, without pushing empty branches.

Actions:

- Create local Graphite branches from current `main`, bottom to top:
  1. `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`
  2. `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
  3. `trl-616-audit-markdown-files-for-hard-line-wraps`
- If Phase 1 identifies additional cleanup that belongs in the stack, add it only after:
  - updating or creating the Linear issue;
  - recording the exact branch name;
  - placing it in stack order based on dependencies;
  - explaining in `RETRO.md` why it is cleanup-sized and not deferred design.
- Commit this packet on the lowest branch in the stack.

Verification:

- `gt log --stack --reverse`
- `git branch --show-current`

Done when:

- Stack order is visible locally and no empty branches have been pushed/submitted.

### Phase 3: `TRL-733` Route Phrasing

Intent:

- Remove the concrete loose CLI `route` wording that triggered the cleanup issue.

Actions:

- Update the TSDoc/comment around `packages/cli/src/build.ts:1134` so it does not describe a CLI command as a route.
- Search nearby CLI docs/comments for the same misuse and fix only same-scope wording.
- Keep this branch narrow.

Verification:

- `rg -n "trail or route|route into a CLI command|CLI.*route|route.*CLI" packages/cli/src docs/surfaces/cli.md docs/contributing/language-styleguide.md`
- `bun run format:check`
- `git diff --check`

Done when:

- `TRL-733` has a focused diff and no active CLI wording treats `route` as a CLI primitive.

### Phase 4: `TRL-734` Route Vocabulary Audit

Intent:

- Make current-facing route vocabulary consistent: `route` is HTTP-flavored unless explicitly mentioned as a retired/misused term.

Actions:

- Audit current-facing docs, agent guidance, and source comments with targeted searches.
- Likely inspect and, if needed, edit:
  - `docs/contributing/language-styleguide.md`
  - `.claude/skills/clark/SKILL.md`
  - `.claude/skills/clark/references/calibrate.md`
  - `apps/trails-demo/src/trails/onboard.ts`
  - `apps/trails-demo/README.md`
  - `docs/surfaces/http.md`
  - HTTP ADRs where `route` is legitimate and should remain.
- Preserve legitimate HTTP route terminology.
- Preserve teaching mentions that explicitly say `route` is wrong for composition or trail/blaze naming.
- File follow-up issues for any bigger vocabulary drift that is not safe to fix in this cleanup branch.

Verification:

- `rg -n "\\broute\\b|\\broutes\\b|Route" packages apps docs README.md AGENTS.md .claude .agents`
- Targeted review report in `RETRO.md` or `reports/route-vocabulary-audit.md`.
- `bun run format:check`
- `git diff --check`

Done when:

- The audit is recorded and current-facing non-HTTP route drift is fixed or filed as follow-up.

### Phase 5: `TRL-616` Constrained Markdown Hard-Wrap Cleanup

Intent:

- Improve current-facing markdown maintainability without rewriting historical planning archives.

Actions:

- Scope included files to current-facing tracked docs:
  - `README.md`
  - `AGENTS.md`
  - `docs/**/*.md`
  - `.claude/**/*.md`
  - current `.agents` guidance files such as `.agents/plans/PLANNING.md` if needed
- Exclude by default:
  - `.agents/plans/archive/**`
  - `.agents/notes/**`
  - `.scratch/**`
  - changelogs
  - generated sections/files
  - code blocks, tables, lists, generated Warden guide blocks, and intentionally wrapped examples
- Use a conservative/manual approach. Do not run a broad formatter that rewrites code blocks or tables.
- If the scope is too large, split into follow-up issues instead of making an enormous PR.

Verification:

- A documented detector command or script invocation recorded in `RETRO.md`.
- Manual spot check of representative files.
- `bun run format:check`
- `git diff --check`

Done when:

- Current-facing markdown hard wraps are materially reduced in the scoped files, with no table/code/generated damage.

### Phase 6: Local Review

Intent:

- Catch drift before remote review and preserve the planning pattern that has worked well.

Actions:

- Run at least three local review passes from the stack tip unless the stack stays tiny and the executor records why fewer are enough.
- Prefer independent lanes:
  - route vocabulary correctness;
  - markdown diff safety;
  - Linear/branch/PR readiness.
- Ask reviewers for:
  - overall score `n/5`;
  - prose summary;
  - P0/P1/P2/P3 findings;
  - prompt-to-fix text for actionable findings.
- Fix P0/P1/P2 findings on the lowest owning branch, restack, and rerun relevant checks.
- Record all local review reports under `reports/` and summarize in `RETRO.md`.

Verification:

- Latest local review pass is clean or P3-only.
- `RETRO.md` records each round and fix outcome.

Done when:

- No local P0/P1/P2 findings remain.

### Phase 7: Submit, Ready, And Remote Review

Intent:

- Package the stack cleanly and run the normal remote review loop.

Actions:

- Submit the stack as draft PRs with high-quality bodies:
  - context;
  - linked Linear issue;
  - what changed;
  - verification;
  - risk/rollout notes;
  - no changeset rationale if package contents are untouched.
- Do not add merge queue labels.
- Keep PRs draft until CI and local review are clean.
- Mark ready after CI/local review are clean.
- After ready, wait for remote code-review bots/agents and CI.
- Work through all P0/P1/P2 feedback bottom-up.
- Capture summary scores, prose summaries, and "Prompt To Fix With AI" blocks when available.
- If Graphite mergeability remains pending while GitHub checks/reviews are clean and GitHub reports mergeable, record it as external service lag rather than spinning.
- Stop after a maximum of four post-ready remote-review turns and report status if P2+ feedback remains.

Verification:

- `gh pr view <n> --json state,isDraft,mergeable,statusCheckRollup,reviewDecision`
- Unresolved review thread query/check.
- `RETRO.md` remote review log complete.

Done when:

- PRs are ready for Matt to merge, or the final report names exact blockers and smallest next action.

## Tracker Plan

Known in-goal issues:

| Issue | Role | Branch | Initial status |
| --- | --- | --- | --- |
| `TRL-733` | PR 1, narrow route phrasing fix | `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106` | Backlog |
| `TRL-734` | PR 2, route vocabulary audit | `trl-734-audit-route-vocabulary-across-packages-consider-reserving` | Backlog |
| `TRL-616` | PR 3, constrained markdown hard-wrap cleanup | `trl-616-audit-markdown-files-for-hard-line-wraps` | Backlog |

Tracker-only audit candidates:

| Issue | Expected handling |
| --- | --- |
| `TRL-351` | Recheck; likely move from Todo to Backlog if still conditional. |
| `TRL-508` | Confirm planning-only and out of implementation scope. |

Expansion rule:

- Additional PRs may be added only if Phase 1 identifies an issue that is cleanup-sized, current, independent or correctly ordered, and executable without new architecture decisions.
- If no issue exists, create one before branching.
- Every added issue must appear in `RETRO.md` with branch name, acceptance criteria, and why it belongs in this cleanup stack.

## Source-Control Plan

- Branching model: Graphite.
- Start from synced `main`.
- Branch order starts with:
  1. `trl-733-clean-up-loose-route-phrasing-in-packagesclisrcbuildts1106`
  2. `trl-734-audit-route-vocabulary-across-packages-consider-reserving`
  3. `trl-616-audit-markdown-files-for-hard-line-wraps`
- Add discovered branches only after Linear audit and tracker update.
- Commit the active plan packet on the lowest branch.
- Main execution agent owns all `git` and `gt` writes.
- Subagents may edit files and run checks only; no `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, PR mutation, merge, or queue operations.
- Do not use `gt absorb` as the normal workflow.
- Do not push/submit empty branches.
- Do not merge.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification, local review, remote review, CI, PR-body, or branch changes.
- For stacked work, touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.
- Before completion, fill the final state, verification log, review state, tracker state, forbidden-action audit, remaining risks, and archive readiness.

## Validation Ladder

Run checks from narrow to broad:

- Targeted route search:
  `rg -n "\\broute\\b|\\broutes\\b|Route" packages apps docs README.md AGENTS.md .claude .agents`
- Targeted CLI drift search:
  `rg -n "trail or route|route into a CLI command|CLI.*route|route.*CLI" packages/cli/src docs/surfaces/cli.md docs/contributing/language-styleguide.md`
- Markdown detector:
  record the exact command used; prefer a conservative script/search and manual review.
- Docs/code hygiene:
  `bun run format:check`
- Diff hygiene:
  `git diff --check`
- Broader gate if source changes expand beyond comments/docs:
  `bun run check`

## Local Review

Required unless the executor records a specific reason the final stack is tiny enough for two passes. Default: at least three passes.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt To Fix With AI: concise prompt for each actionable finding

Suggested lanes:

1. Route vocabulary: verify `route` remains HTTP-specific and teaching mentions are explicit.
2. Markdown safety: verify unwraps do not damage code blocks, tables, lists, generated sections, or old archives.
3. Stack/tracker readiness: verify issue scope, branch order, PR bodies, Linear state, and `RETRO.md` completeness.

Fix all P0/P1/P2 findings before remote submission or final handoff. Summarize each round and its fix outcome in `RETRO.md`.

For remote code-review bots/agents, record summary scores, prose summaries, prompt-to-fix blocks, and whether any score below 5/5 reflects current unresolved debt, stale feedback, or an explicitly rejected recommendation.

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

- The Linear audit shows the stack would need `TRL-508`, activation design, runtime adapters, package exports, public API changes, release/versioning, or another unsettled design decision.
- Markdown hard-wrap cleanup would rewrite large historical archives or generated material.
- Route-vocabulary cleanup would require changing accepted ADR doctrine rather than tightening current-facing prose.
- Verification fails for unrelated reasons after one focused retry.
- Secrets, credentials, production systems, publishing, registry mutation, merge, or merge queue actions are needed.
- More than four post-ready remote-review turns have elapsed and P2+ feedback remains unresolved.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current enough for execution, with Linear audit required first.
- [x] Branch names/order are exact for known issues.
- [x] Dependencies/blockers are represented by the expansion rule.
- [x] Ignored/untracked source docs are avoided or summarized.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
