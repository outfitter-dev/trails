---
created: 2026-05-24T16:45:07Z
updated: 2026-05-24T16:45:08Z
description: Reference index for the Warden-as-coach overnight session. Lists tracked portable sources (AGENTS.md, tenets, lexicon, warden rules/tests/trails), untracked local-only sources (Lewis/Clark shared note, warden diagnostic audit), tracker records for TRL-791/793/794/785/786/790, PR/branch records for #582-#584, and validation commands.
impl_status: partial
linear:
  - TRL-785
  - TRL-786
  - TRL-790
  - TRL-791
  - TRL-793
  - TRL-794
references:
  - AGENTS.md
  - .agents/plans/PLANNING.md
  - docs/tenets.md
  - docs/lexicon.md
  - packages/warden/src/rules/
  - packages/warden/src/__tests__/
  - packages/warden/src/trails/
---

# References: Warden As Coach Overnight Stack

## Tracked / Portable Sources

- `AGENTS.md` - repo guidance, Warden rules, Graphite workflow, subagent constraints.
- `.agents/plans/PLANNING.md` - packet lifecycle, review, validation, and tracker preferences.
- `docs/tenets.md` - doctrine basis for Warden guiding agents toward the happy path.
- `docs/lexicon.md` - vocabulary basis for diagnostic wording.
- `packages/warden/src/rules/` - Warden rule implementations.
- `packages/warden/src/__tests__/` - focused rule fixtures and exact diagnostic expectations.
- `packages/warden/src/trails/` - Warden rule trail examples and generated contract expectations.

## Untracked / Local-Only Sources

- `/Users/mg/Developer/outfitter/trailblazing/inbox/2026-05-23-lewis-clark-turnaround.md` - Lewis/Clark shared note; summarized in this packet and `RETRO.md`.
- `/Users/mg/Developer/outfitter/trailblazing/plans/fieldwork-loop/warden-diagnostic-audit-20260523.md` - Clark's Warden diagnostic audit if present; use as source context, but do not make this packet depend on it.

## Tracker Records

- `TRL-791` - Warden coach against destructured `ctx.cross`.
- `TRL-793` - Upgrade names-only Warden diagnostics to teach the fix.
- `TRL-794` - Upgrade partial Warden diagnostics to teach the fix.
- `TRL-785` - Close `implementation-returns-result` alias-aware Result helper provenance gap.
- `TRL-786` - Detect redundant `Result.err(x.error)` re-wraps once provenance is strong enough.
- `TRL-790` - Whitelist explicit `TODO[trails-*]` markers.

## PRs / Branches

- PR #582 / `trl-791-warden-coach-against-destructured-ctxcross-new-reject-and` - TRL-791 draft PR, CI green as of 2026-05-24 00:34 EDT.
- PR #583 / `trl-793-warden-upgrade-names-only-diagnostics-to-teach-the-fix-8` - TRL-793 draft PR, CI green as of 2026-05-24 01:00 EDT.
- PR #584 / `trl-785-warden-extend-implementation-returns-result-to-track-helper` - TRL-785 draft PR, CI running as of 2026-05-24 01:07 EDT.

## Validation Commands

- `bun test <touched files>` - focused rule/test proof.
- `bun --cwd packages/warden test` - Warden package regression proof.
- `bun run typecheck` - workspace type proof.
- `bun run lint` - workspace lint proof.
- `bun run format:check` - formatter/lint plugin proof.
- `git diff --check` - whitespace proof.
- `bun run check` - full repo gate before PR handoff.
