---
created: "2026-05-12T23:55:16Z"
updated: "2026-05-21T10:57:01Z"
description: Tracked project guidance for preparing autonomous /goal packets in Trails. Defines the four-file packet structure (PLAN/GOAL/RETRO/REFS), planning directory layout, archive policy, Linear tracker hygiene, Graphite source-control conventions including the ban on gt absorb, subagent write-command restrictions, local/remote review protocol, progress reporting format, and validation command list.
linear: []
impl_status: unknown
references:
  - AGENTS.md
---

# Goal Planning Preferences

This file is tracked project guidance for preparing autonomous `/goal` packets in Trails. It supplements `AGENTS.md`; when instructions conflict, follow current user instructions first, then platform safety rules, then `AGENTS.md`, then this file.

## Planning Directory

- **Default packet location:** `.agents/plans/{YYYY-MM-DD-slug}/`
- **Archive location:** `.agents/plans/archive/`

Active goal packets should use the four-file core:

- `PLAN.md`
- `GOAL.md`
- `RETRO.md`
- `REFS.md`

Add extra Markdown files or subdirectories only when they make the packet easier to execute without chat history, such as `reports/` for local review findings or audit outputs.

## Tracker

- **Primary tracker:** Linear team `TRL`

Issue hygiene:

- Use Linear issue IDs and Linear-recommended branch names for 1:1 work.
- Keep issue bodies, comments, statuses, projects, milestones, and dependency links aligned with the packet before execution starts.
- If a packet changes a deliverable path, branch order, scope, or acceptance criteria, update the affected Linear issues or record exactly why no tracker update is needed.
- Do not mark issues Done until the corresponding work has merged.

Follow-up issue policy:

- File focused follow-up issues for real discoveries outside the current goal.
- Prefer sub-issues and explicit blocking relationships over large catch-all issues.
- If implementation diverges from an issue or plan, leave a Linear comment explaining what changed and why.

## Source Control

- **Branching model:** Graphite

Branch/PR conventions:

- Use exact Linear-recommended branch names when available.
- It is fine to create a local stack chain up front, but do not submit or push empty branches.
- Main agent owns all `git` and `gt` write operations.
- Subagents may edit files, run checks, and write reports, but must not run `git add`, `git commit`, `git push`, `gt create`, `gt modify`, `gt submit`, `gt restack`, merge commands, or PR mutation commands.
- For downstack fixes, check out the owning branch directly, run `git branch --show-current`, apply the fix, `gt modify`, `gt restack`, and walk upward through affected descendants.
- Do not use `gt absorb` as the normal review-fix workflow for goal stacks.
- Do not add merge queue labels unless Matt explicitly asks.
- Do not merge unless Matt explicitly asks.

Plan packet commit policy:

- Commit the active packet on the execution branch, or on the lowest branch in a stack if the packet is part of the deliverable.
- Keep `RETRO.md` as the running execution log and commit it at the last meaningful point before handoff or merge readiness.

Archive before merge:

- Before merging a completed goal stack, move completed packets wholesale to `.agents/plans/archive/` unless Matt asks to keep the active packet in place.

## Planning Packet

Required files:

- `PLAN.md` - complete execution contract and detailed work plan.
- `GOAL.md` - pasteable `/goal` prompt and compact completion contract.
- `RETRO.md` - running log for discoveries, tracker mutations, verification, review feedback, and final state.
- `REFS.md` - portable source map, including any ignored scratch docs that were summarized or superseded.

Additional allowed files:

- `reports/*.md` for local review reports, doctrine verification, or audit outputs.
- `DESIGN.md`, `MIGRATION.md`, `ISSUES.md`, or `REVIEW.md` when the topic is too large for `PLAN.md`.

Do not make a tracked packet depend on ignored or untracked scratch docs. If a scratch note is load-bearing, copy the relevant detail into the packet, summarize it in `REFS.md`, or move the canonical output under `.agents/plans/`.

## Execution Preferences

Local review:

- Bias toward local review before remote submission.
- For large or stacked goals, run multiple local review passes; default to at least three passes unless the packet states a stricter condition.
- Stop local review only when the latest pass is P3-only or clean.
- Reviews should inspect from the stack tip; fixes should land on the lowest owning branch and then be walked upward.

Remote review:

- Keep PRs draft until CI and local review are clean.
- Use high-quality PR bodies with context, changes, verification, risk/rollout notes, and tracker links.
- After marking ready, check bot and human review threads and resolve P2 and above feedback from the bottom of the stack upward.
- Treat review-bot errors as blockers until rerun or explicitly explained.

Progress reporting:

- Goal executors should report current checkpoint, what changed, commands run, summarized results, remaining work, blocker status, and next checkpoint.
- Final reports must include transcript-visible proof: branch/PR status, changed artifacts, verification commands/results, skipped checks, remaining P3s or risks, and confirmation that no forbidden operation occurred.

## Validation

Use repo scripts first. Typical gates include:

- `bun scripts/adr.ts map`
- `bun scripts/adr.ts check`
- `bun run typecheck`
- `bun run test`
- `bun run lint`
- `bun run lint:ast-grep`
- `bun run build`
- `bun run format:check`
- `bun run check`
- `bun run dead-code`
- `git diff --check`

When Warden guide content or generated agent guide content changes, also run:

- `bun run warden:agents:sync`
- `bun run warden:skills:sync`
- `bun run warden:agents:check`
- `bun run warden:skills:check`

Publishing guidance must use Trails' Bun-based scripts:

- `bun run publish:check`
- `bun run publish:packages`

Do not introduce `npm publish` or `changeset publish` guidance.

## Stop Rules

Stop or ask before continuing if:

- The plan appears stale against `main`, Linear, or open PR state.
- A required upstream stack has not merged.
- A public API, artifact layout, or doctrinal decision must change beyond the
  packet.
- Verification fails for unrelated reasons after focused retry.
- Secrets, credentials, production systems, or irreversible actions are needed.
- More than four post-ready remote-review turns have elapsed and P2+ feedback remains unresolved.
