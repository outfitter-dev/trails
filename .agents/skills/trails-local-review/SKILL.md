---
name: trails-local-review
description: "Review a Trails branch, Graphite stack, milestone, generated artifact, migration, documentation set, or implementation slice against current repository doctrine and written acceptance. Use for pre-submit review, targeted risk review, review-fix loops, or a final readiness judgment with evidence-backed P0-P3 findings."
metadata:
  skillset:
    generator: scripts/codex/skillset.ts
    target: codex
    version: 1
    source: .claude/skills/trails-local-review
    source-file: .claude/skills/trails-local-review/SKILL.md
---

# Trails Local Review

Review the assigned Trails scope independently and report whether it is ready. Default to read-only review; edit files, mutate Git or Graphite, update a PR, or change tracker state only when the coordinating agent explicitly delegates that operation.

## Establish The Contract

Infer or obtain:

- the exact scope and base/head refs;
- the written acceptance criteria from the request, plan, issue, ADR, or specification;
- the intended completion horizon;
- the owning branch for each changed responsibility;
- the desired report path, when a durable artifact is required.

An issue is useful evidence when one exists, not a prerequisite for review. If acceptance is ambiguous, name the gap instead of inventing criteria.

Read `AGENTS.md`, the nearest scoped guidance, governing tenets and ADRs, the lexicon, and affected source or documentation. For Graphite work, inspect the real stack, branch diffs, PR state, CI, and unresolved review threads rather than inferring topology from branch names.

## Review The Right Surfaces

Test the scope against the contracts that actually govern it:

- behavior, types, tests, examples, and error handling;
- Trails vocabulary, tenets, ADRs, and architectural ownership;
- generated-output parity and drift checks;
- Graphite branch ownership and dependency-safe placement;
- documentation, migration guidance, and agent-facing instructions;
- Warden, Wayfinder, lock round-trip, changeset, and release-pack expectations when applicable;
- security, destructive effects, external state, and delegated authority;
- the issue, plan, PR description, and implementation telling the same story.

Verify evidence directly. Quote the relevant path and line, command result, PR thread, or runtime observation. Treat `unable to verify` as a valid result and an invented citation as a hard review failure. An empty search is not proof of absence until its scope, identifier grammar, and plausible alternate homes are checked.

## Keep Review Topology Proportional

The builder should inspect its own work before handoff, but self-review does not become independent merely because it is thorough. For substantive agent-produced work, prefer a fresh-context reviewer when the repository or coordinator requires independence and the harness can provide it.

The coordinating agent chooses reviewer topology, report durability, fix ownership, and the final review gate. The user or delegated coordinator retains ready, merge, release, and publication authority.

Within one fix loop, reuse the same reviewer so findings can be rechecked consistently. Use a fresh reviewer for a genuinely independent milestone or full-stack judgment when required.

## Grade Findings

- **P0:** unsafe or impossible to proceed, including security, data loss, destructive behavior, or a broken required release path.
- **P1:** correctness or contract regression, including broken behavior, public API, migration, or governing doctrine.
- **P2:** important quality or readiness defect that should be fixed before handoff, including misleading guidance, generated drift, missing release intent, or unresolved review evidence.
- **P3:** optional polish with no correctness, doctrine, documentation, or release impact.

Lead with findings in severity order. Each finding should include the contract violated, exact evidence, impact, and smallest credible fix. Lower confidence rather than filling an evidence gap with plausible prose.

## Report And Recheck

When a goal packet requires a durable report, write it under that packet's `reports/` directory or the coordinator-provided scratch path. Otherwise return a concise findings-first review in chat. Do not commit scratch review artifacts unless explicitly directed.

After fixes:

1. inspect the new diff on the owning branch;
2. rerun the focused evidence that proves the finding is closed;
3. check affected upstack branches and generated surfaces;
4. update each prior finding as fixed, accepted, rejected, stale, or still open;
5. issue a new readiness score without erasing residual risk.

A clean or 5/5 judgment requires no open P0-P2 findings and enough evidence to trust the requested horizon. Keep PRs draft until required local review and hosted checks are green. Do not mark ready or merge unless that authority was delegated, even when the review is clean.
