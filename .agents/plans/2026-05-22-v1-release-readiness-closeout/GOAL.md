---
created: "2026-05-23T21:40:48Z"
updated: "2026-05-23T21:40:49Z"
description: "Resume prompt for the v1-release-readiness-closeout goal packet, handed off from a Codex session. Contains a pasteable /goal command for a fresh executor covering TRL-759 commit, TRL-760 migration guide, final stack gate, local review, and remote review closeout. References RETRO.md, PLAN.md, and REFS.md as required reading before starting."
impl_status: implemented
linear:
  - TRL-756
  - TRL-757
  - TRL-758
  - TRL-759
  - TRL-760
  - TRL-766
  - TRL-767
references:
  - .agents/plans/2026-05-22-v1-release-readiness-closeout/PLAN.md
  - .agents/plans/2026-05-22-v1-release-readiness-closeout/RETRO.md
  - .agents/plans/2026-05-22-v1-release-readiness-closeout/REFS.md
  - AGENTS.md
  - .agents/plans/PLANNING.md
---

# Goal Prompt: v1-release-readiness-closeout (resume from Codex handoff)

Resume context: prior executor (Codex) stopped 2026-05-22 18:57 EDT with TRL-767/766/756/757/758 committed and TRL-759 implementation drafted in the working tree but uncommitted. The pasteable `/goal` below is the resume prompt for a fresh executor session. Full execution contract lives in `PLAN.md`; `RETRO.md` is the durable ledger to read first.

Paste this into the goal runtime:

````markdown
/goal From cwd `<path-to-trails-repo>`, resume `.agents/plans/2026-05-22-v1-release-readiness-closeout/PLAN.md` from Codex handoff at 2026-05-22 18:57 EDT.

State: branch `trl-759-...`; TRL-767/766/756/757/758 committed; TRL-759 drafted in working tree (uncommitted; 17 M files + new `.changeset/beta-install-policy.md` and `docs/releases/beta-channel-policy.md`); TRL-760 branch exists but empty. `.claude/worktrees/` untracked, unrelated.

Read first: packet `RETRO.md` (full Execution Log + Verification Log + Deferred Discoveries + Tracker Mutations; Final State is the completion contract), `PLAN.md`, `REFS.md`, `AGENTS.md`, `.agents/plans/PLANNING.md`. Confirm `git status --short --branch` and `gt log --stack --reverse --no-interactive` match the resume state before any write; stop/ask if not.

Sequence:
1. `gt modify -m "docs: document beta channel install policy and version bump" --no-interactive` on `trl-759-...`; restack upward; verify the branch commit contains only intended TRL-759 changes (`.claude/worktrees/` stays untracked, not staged). Add Linear implementation summary comment to TRL-759 in the TRL-757/758 comment style (changed surfaces, docs, changeset, targeted checks).
2. Check out `trl-760-add-beta15-to-beta18-downstream-migration-guide`; move TRL-760 → In Progress; execute PLAN.md Phase 5 (beta.15→beta.18 migration guide); link from `docs/index.md`; reuse existing focused migration guides via links; add changeset; verify per Phase 5 ladder. Commit and add Linear comment.
3. Final stack-tip gate: `bun run check`, `bun run test`, `bun run build`, `bun run publish:check`, `bun run publish:registry-check`, `git diff --check`.
4. Local review: ≥3 scored passes from stack tip per PLAN.md Lanes 1/2/3. Each pass returns overall n/5, prose summary, P0/P1/P2/P3 with file:line evidence, Prompt To Fix per actionable finding. Fix P0/P1/P2 on owning branches bottom-up with `gt modify`, restack, re-review. Stop when latest pass is P3-only or clean.
5. Submit draft stack with high-quality PR bodies (context, changes, verification, risks, `Closes TRL-###`). Ready only after CI + local review clean. After ~15m, up to 4 post-ready remote-review turns; resolve P0/P1/P2 + concrete lower-score code-review bot/agent feedback bottom-up; record scores, prose summaries, prompt-to-fix text, unresolved threads in RETRO.

Each turn report: checkpoint, files changed, exact checks run, result summary, remaining work, blocker status, next checkpoint. Touch `RETRO.md` last before any local-complete / draft-submit / ready-for-review / remote-review-closeout / handoff state.

Carry forward (out of scope; do not re-litigate):
- TRL-772 — TRL-766 audit verdict "stable-cutover blocker" (markers ignore Zod `.refine`/`.min`/`.email` etc.). Stable 1.0 gated on it; this stack ships independently.
- TRL-769/770/771/773/774/775 — audit follow-ups filed; out of goal.
- TRL-765 / TRL-508 — out of scope.

Hard rules: no merge; no merge queue label; no `bun run publish:packages`; no `npm publish` / `changeset publish`; no registry or dist-tag mutation; no `gt absorb`; no source-control writes by subagents; no TRL-508 / TRL-765 / TRL-772 implementation. Stop/ask if a verification fails for unrelated reasons after focused retry, if review surfaces a P0/P1/P2 needing more than a small in-stack fix, or if more than 4 post-ready remote-review turns elapse with P2+ unresolved.

Done only when: TRL-759 and TRL-760 committed with draft PRs that moved through ready → CI clean → up-to-4 remote-review turns; all 7 Linear issues reflect reality (state, comments, PR links); final repo gate passes; no unresolved P0/P1/P2; forbidden-action audit clean; `RETRO.md` Final State + Local Review Log + Verification Log + Remote Review / CI Log + Review Feedback Resolutions + Forbidden Actions Audit are filled. Final transcript names the updated `RETRO.md`. Do not merge unless explicitly asked.
````
