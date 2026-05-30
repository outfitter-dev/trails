# Goal Prompt: Regrade Runway Stack

Paste this into the goal runtime when Matt says to run it:

````text
/goal Work from the current Trails checkout. Packet: .agents/plans/2026-05-28-regrade-runway-stack/. Objective: build the larger Regrade runway stack TRL-840 -> TRL-843 -> TRL-842 -> TRL-844 -> TRL-845 -> TRL-846 -> TRL-831 -> TRL-832 -> TRL-833 -> TRL-834 -> TRL-836 -> TRL-829, stopping with draft PRs/review-ready evidence, not merge.

Hard preflight: read AGENTS.md, .agents/plans/PLANNING.md, packet PLAN/REFS/RETRO, and relevant Linear issues. Confirm PR #618 is merged, current branch is fresh main, `gt sync` is clean, `git status --short --branch` has no unexpected tracked changes, and `gt ls` starts from main. Leave unrelated untracked .agents/plans dirs alone. Use Graphite and exact branch names from PLAN.md. Commit this packet on the lowest branch TRL-840 when execution begins. Do not run from a detached Codex worktree. Use Claude-agent execution unless Matt explicitly redirects; Clark is doctrine support, not executor.

Stack contract: first close Regrade post-tracer seams (package boundary, Warden internal-child warning, transformed-schema example typing); then build downstream root collection, selection/report shape, and Radio-shaped fixture; then add Warden fix metadata, term-rewrite metadata, safe `warden --fix`, Warden fix metadata ADR, Warden-backed term-rewrite Regrade integration, and final Regrade ADR. Regrade is Trails using Trails, not a new primitive. Warden owns detection; Regrade owns application/provenance/validation/review. `RegradeReport` is output/report shape, not contour. `term-rewrite` is durable wording; `vocab-cutover` is historical only.

Subagents: use bounded high-reasoning workers for audits/design/reviews; they may edit/run tests/write reports but must not run git/gt/gh/Linear writes. Main executor owns branches, commits, PRs, tracker updates, review replies, and any merge mechanics.

Validation: per branch run focused package checks named in PLAN.md. Before stack submission run `bun run typecheck`, `bun run test`, `bun run lint`, `bun run lint:ast-grep`, `bun run format:check`, `bun run check`, `git diff --check`; run Warden guide sync/check commands if generated Warden/agent guidance changes; run ADR map/check for ADR branches. Keep PRs draft until CI and local review are clean/P3-only.

Review loop: at least three local review lanes over the stack; each returns score n/5, summary, P0/P1/P2/P3 findings, and Prompt To Fix. Fix P0/P1/P2 bottom-up on owning branches without `gt absorb`. After ready, handle at most three remote review rounds; target Greptile 5/5 and no Prompt-for-AI blocks; Greptile errors are blockers/incomplete review.

Maintain RETRO.md continuously. Before final handoff, update branch/PR/Linear ledger, verification commands/results, review signals/scores, follow-ups, forbidden-action audit (no merge, no publish/registry, no merge queue label, no subagent source-control writes), remaining risks, and archive readiness. Update Linear issues and parents TRL-827/TRL-830 with PR links/status. Stop and ask/report if public doctrine/API shape must change, preflight is unsafe, validation fails for unrelated reasons after focused retry, source-control state is dirty/conflicted, or scope wants public CLI/package-source/publish work.
````
