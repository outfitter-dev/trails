# GOAL — blaze → implementation (v1 vocab family, TRL-1018)

Migrate the authored trail-behavior **field** `blaze` → `implementation` as a **hard cutover** (no peer fields; TRL-1018 ratified). This is the highest-blast-radius vocabulary change in the framework. Readiness (TRL-1219, 6 scouts) is complete; full occurrence map + registers live in `.agents/notes/2026-07-06-blaze-readiness-brief.md`. This directory is the execution brief for the migration run.

## Ratified vocabulary decision (Matt + Clark, 2026-07-06)

The **field/noun** becomes `implementation`. The **word `blaze` survives as verb + idiom**:
- **KEEP:** "blaze a trail", "Blaze the trail", "blazing" — real English, central to the *Trails* brand. Coherent split: you *blaze* (the act) by writing the *implementation* (the noun). Already protected by the release plan (`docs/releases/v1-vocabulary-reset.md:142`) and encoded in the registry `reviewForms`.
- **RETIRE:** the field name `blaze:` → `implementation:`, and the adjective **"blazed trail"** (no clean single-word successor; rewrite to plain phrasing — "a runnable trail" / "a trail with an implementation" — never "implemented trail").

> If the decision-owner prefers a fuller retirement (kill the idiom too), that inverts the preserve rules below — flag before executing. Default = keep the idiom.

## Done condition

1. Every in-scope `blaze:` field / `.blaze` access / `raw['blaze']` probe / `'blaze'` type-level key-string → `implementation`; `BlazeInput` → `ImplementationInput` (+ the 2 `.test-d.ts` exports).
2. **Acceptance-critical:** none of the 6 rule-logic string-checks (`=== 'blaze'`) survive — Warden/lifecycle recognize the field under its new name. A post-migration check confirms no field-name `'blaze'` string-match remains in rule logic (see PLAN §Hazard 1).
3. The half-migrated `implementation`-named Warden rules are reconciled (logic keys on `'implementation'`), not duplicated.
4. Prose + atomic-flip teaching surfaces migrated (field→`implementation`), idioms preserved.
5. Preserve register untouched (idioms, `trailblaze`, migration machinery, the prior `blaze()`→`trailhead` mapping); tier-2 untouched (CHANGELOGs, accepted ADRs, changesets, the migration spec, `.agents/plans`).
6. Committed transition record at `.trails/regrade/blaze-to-implementation.json` (consolidated append-only history, TRL-1214 shape); `bun run check` green; `bun run lock:roundtrip` green; changeset for every touched publishable package.

## Execution posture

Uses the merged regrade-progression machinery. The field rename is **atomic** (one compile-unit — the type change breaks all consumers at once), so it is NOT per-package sliceable. The realistic shape is **code-cutover → docs-cutover → review-inventory** (see PLAN §Slices). The `--include` phasing (TRL-1216) is used to scope the DOCS slice and to chunk the review inventory, not to split the atomic type change.
