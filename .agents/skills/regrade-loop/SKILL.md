---
name: regrade-loop
description: "Run a Trails Regrade migration loop with dry-run discovery, occurrence judgment, safe apply, verification, ledger capture, and per-cycle resume."
metadata:
  version: 0.1.0
  author: trails
  category: migration
  skillset:
    generator: scripts/codex/skillset.ts
    target: codex
    version: 1
    source: .claude/skills/regrade-loop
    source-file: .claude/skills/regrade-loop/SKILL.md
---

# Regrade Loop

Use this skill when a Trails migration should go through Regrade instead of manual search-and-replace. It is for vocabulary transitions, downstream migration plans, and dogfood runs where the tool must discover, apply, verify, and report before an agent edits source by hand.

Doctrine: truth lives in the contract. Warden governs it. Regrade moves it. The regrade plan authors migration intent.

## References

- `docs/adr/drafts/20260530-fixes-are-warden-diagnostic-metadata.md` - Regrade/Warden doctrine for governed migration facts.
- `docs/api-reference.md` - committed Regrade package and CLI/MCP contract reference.
- `packages/regrade/src/downstream/vocabulary.ts` - vocabulary plan, ledger, and report contracts.
- `apps/trails/src/trails/regrade.ts` - Trails CLI/MCP surface for Regrade.
- `packages/warden/src/rules/retired-vocabulary.ts` - governed vocabulary transition registry.

## Core Rule

Do not decide what to search for manually. Start from a Regrade plan or governed vocabulary transition, run the tool, and use its occurrence inventory as the work queue. Manual edits are allowed only as review/fix steps after Regrade has produced evidence.

## Artifacts

Keep three artifacts distinct:

- **Plan:** authored migration intent. It names the source, target, scope, overrides, and preserve rules. It must not accumulate run state.
- **Ledger:** observed run state. It records cycle number, forms seen, occurrence verdicts, paths, spans, reasons, and replacements.
- **Report:** projected operator output. It summarizes counts, gate status, review inventory, skipped files, and applied file counts.

For a long run, write resume state under a gitignored working directory such as `.agents/regrade/<plan-id>/`:

- `plan.json`
- `cycle-001-ledger.json`
- `cycle-001-report.json`
- `RETRO.md`

Do not commit these working artifacts unless the issue explicitly asks for a durable fixture or example.

## Workflow

### 1. Load The Contract

Read the issue and the canonical Regrade note. Then inspect the accepted input surface before inventing flags:

```bash
trails schema regrade
# or, inside this repo:
bun apps/trails/bin/trails.ts schema regrade
```

Prefer the Trails surface over calling package internals. CLI and MCP should accept the same contract-shaped input. When using MCP, pass the same fields the schema exposes for the `regrade` trail.

### 2. Author Or Select The Plan

Choose the public Regrade mode first:

- **Class mode:** use Warden-backed classes when no vocabulary `from` / `to` input is needed. The public input is `classIds`, `include`, `exclude`, `extensions`, `apply`, and `includeEntries`.
- **Vocabulary mode:** use governed vocabulary transitions when one exists. Otherwise provide the public vocabulary fields: `from`, `to`, optional `intent`, optional `include` / `exclude` / `extensions`, optional `overrides`, and optional `preserve`.

The internal `VocabularyRegradePlan` stores scan scope under `scope`, but the CLI and MCP `regrade` trail expose those controls as top-level `include`, `exclude`, and `extensions`. Follow the schema output for the surface you are invoking.

Minimal vocabulary input:

- `from`
- `to`
- optional `intent`
- optional top-level `include`, `exclude`, and `extensions`
- optional `overrides`
- optional `preserve`

Project defaults may narrow scope, but an explicit plan can override them.

### 3. Dry Run First

Run without `apply` first:

```bash
trails regrade --root-dir . --from facet --to trailhead --json
trails regrade --root-dir . --class-ids term-rewrite:no-retired-cross-vocabulary --json
```

Save the returned ledger/report when the run is large or will cross context windows. Treat `gate.status: "open"` as real work, not success.

### 4. Triage Occurrences

Use the report inventory:

- `modified` means Regrade believes a safe rewrite exists.
- `deferred` means a human or agent must judge the occurrence.
- `skipped` means the plan or derived inventory intentionally preserved it.

For deferred occurrences, inspect only enough source context to decide one of:

- add an `override` when a form has a deterministic target;
- add a `preserve` rule when the old form is intentional;
- leave it unresolved and record why when the right target is not known.

Never hide uncertainty by applying a broad replacement.

### 5. Apply Explicitly

Apply only after the dry-run report is understood:

```bash
trails regrade --root-dir . --from facet --to trailhead --apply --json
```

Safe apply may still leave the gate open when target text contains the source, when review inventory remains, or when new neighbor forms are discovered. That is expected. Continue the loop instead of calling the migration done.

### 6. Verify And Repeat

After each apply cycle:

1. Re-run the same Regrade command without `apply`.
2. Compare the new ledger/report with the previous cycle.
3. Confirm changed files are expected.
4. Run targeted tests or commands for the migrated surface.
5. Repeat until the gate is green or all remaining entries are explicit review inventory with an issue/comment explaining the blocker.

### 7. Local Review

For repo work, run local review loops on the branch diff. P0-P2 findings must be fixed or specifically acknowledged with evidence. Relevant P3s should be fixed when they improve operator clarity or prevent later drift.

## Done Criteria

A Regrade loop is done only when:

- dry-run and apply behavior were both exercised when source changes were made;
- the final report is green, or remaining review inventory is explicitly captured and not misreported as complete;
- plan, ledger, and report stayed separate;
- CLI and MCP contract expectations remain aligned;
- targeted verification passes;
- local review has no unresolved P0-P2 findings;
- any manual edits are labeled as review/fix-after-Regrade, not the primary migration mechanism.

## Stop Rules

Stop and report if:

- the schema does not expose the field needed for the plan;
- Regrade cannot represent a required preserve or override without manual source editing;
- the same apply/verify cycle fails three times;
- CLI and MCP cannot accept equivalent input;
- the tool output would require parsing prose instead of structured fields.

Report what you tried, the exact command, the report or error, your hypothesis, and the smallest Regrade capability needed to continue.
