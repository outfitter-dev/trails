---
name: trails-goal-loop
description: Define, execute, and settle durable Trails goals. Use for non-trivial Trails work spanning issues, Graphite branches or stacks, agents, review loops, CI, release or publication gates, or whenever a Trails goal needs an explicit completion horizon, authority boundary, evidence contract, and resumable packet.
---

# Trails Goal Loop

Turn a substantial Trails objective into a current, executable contract and stay with it through the authorized completion horizon. Keep small, obvious edits small; do not manufacture a packet when the work can be completed and proved directly.

## Ground The Goal

Read `AGENTS.md`, the nearest scoped guidance, and `.agents/plans/PLANNING.md`. Treat those current repository sources as authoritative for packet shape, Graphite workflow, review policy, release readiness, and stop rules.

Establish live truth before planning:

- inspect the intended baseline and current worktree, branch, and Graphite stack;
- inspect the owning issue, PRs, review threads, and CI when they exist;
- verify whether the requested outcome is already delivered on the relevant baseline or target state;
- separate verified state, inference, and unknowns.

Verified already-done is a valid outcome when named evidence proves the requested horizon. Do not create implementation merely to make a goal appear active.

## Choose The Smallest Contract

Use a packet when the work must survive context loss, coordinate multiple issues or agents, shape a stack, or persist through external waits. Create it under:

```text
.agents/plans/{YYYY-MM-DD-slug}/
  PLAN.md
  GOAL.md
  RETRO.md
  REFS.md
```

Follow `.agents/plans/PLANNING.md` for each file's current role. Do not make a tracked packet depend on ignored scratch evidence.

For a smaller goal, keep the same contract in the working plan or prompt without creating files. Name:

- one completion horizon;
- what counts as done and explicitly not done;
- authority and boundaries;
- preserved state and scope fences;
- execution and review topology;
- exact verification and evidence;
- external waits, next moves, and true stop rules.

Use a horizon that describes observable state, such as plan-ready, implementation-ready, draft PR, ready PR, merged, released, published, or tracker-only. Changing it requires explicit user or coordinator approval.

## Shape Honest Execution

Choose branches and agents from real ownership and dependency facts:

- place each change on its lowest dependency-safe owning branch;
- stack branches only when one change truly depends on another;
- express priority through execution order and gates, not artificial branch ancestry;
- keep unrelated priority work standalone and finish or gate it before starting lower-priority work when focus matters;
- let the coordinating agent assign worktrees, file scope, source-control operations, tracker mutations, and integration ownership.

An agent type or persona grants no operational authority. Record delegated authority precisely enough that another agent can verify it before acting.

## Run The Loop

Repeat until the horizon is proved or a stop rule fires:

1. Reconcile live state with the goal contract.
2. Implement the smallest coherent slice on its owning branch.
3. Verify narrowly, then broaden in proportion to risk.
4. Invoke `trails-local-review` when the repository, coordinator, or goal contract requires a review gate.
5. Fix findings on the owning branch and re-verify affected descendants.
6. Update `RETRO.md`, tracker, PR, and other truth surfaces when their state materially changes.
7. Settle documentation, governance, generated artifacts, release intent, and migration guidance under the repository's Distribution-Ready Done contract.

Do not weaken the horizon, review gate, verification, or authority boundary silently. Record material amendments in `RETRO.md`.

## Prove Settlement

Finish with evidence that can be checked without the execution chat:

- resulting branches, stack order, and PR state;
- verification commands and summarized results;
- review findings and dispositions;
- open threads, CI, mergeability, release, registry, or runtime state relevant to the horizon;
- skipped gates and why they were not applicable;
- remaining risks or the exact blocker;
- confirmation that no action exceeded delegated authority.

Progress is not completion. A local check is not a ready PR, a ready PR is not merged, merged is not released, and released is not proven operational.
