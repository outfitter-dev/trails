---
name: regrade-loop
description: "Run a Trails Regrade migration loop with dry-run discovery, occurrence judgment, safe apply, verification, ledger capture, and per-cycle resume."
metadata:
  version: 0.1.0
  author: trails
  category: migration
---

# Regrade Loop

Use this skill when a Trails migration should go through Regrade instead of manual search-and-replace. It is for vocabulary transitions, downstream migration plans, and dogfood runs where the tool must discover, apply, verify, and report before an agent edits source by hand.

Doctrine: truth lives in the contract. Warden governs it. Regrade moves it. The regrade plan authors migration intent.

## References

- `docs/adr/0053-regrade-moves-governed-contract-change.md` - the accepted doctrine for governed contract changes, lifecycle, and evidence.
- `docs/api-reference.md` - committed Regrade package and CLI/MCP contract reference.
- `packages/regrade/src/downstream/vocabulary.ts` - vocabulary plan and report contracts.
- `packages/regrade/src/history-receipt.ts` - the canonical compact v3 history receipt contract.
- `apps/trails/src/trails/regrade.ts` - Trails CLI/MCP surface for Regrade.
- `packages/warden/src/rules/retired-vocabulary.ts` - governed vocabulary transition registry.

## Core Rule

Do not decide what to search for manually. Start from a Regrade plan or governed vocabulary transition, run the tool, and use its occurrence inventory as the work queue. Manual edits are allowed only as review/fix steps after Regrade has produced evidence.

## Artifacts

Keep three artifacts distinct:

- **Plan:** authored migration intent. It names the source, target, scope, overrides, and preserve rules. It must not accumulate run state.
- **Ledger:** derived observed run state. It records forms, occurrence verdicts, paths, spans, reasons, and replacements, but is not committed primary truth.
- **Report:** rendered operator output. It summarizes counts, gate status, review inventory, skipped files, and applied file counts.

Committed history stores compact immutable receipts: authored intent, reproducibility keys, durable form judgments, Git blob identities, and completion facts. It does not store the full occurrence ledger or rendered report. Never hand-edit `.trails/regrade/history/`; regenerate and validate it through Regrade.

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

### 3. Use The Saved-Plan Lifecycle

For governed work, use the schema-first saved-plan lifecycle. Create one run-specific directory under the repository's gitignored Regrade working area before either plan mode:

```bash
REGRADE_SCRATCH=".agents/regrade/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REGRADE_SCRATCH"
CYCLE=1
```

A class plan follows the live form documented by the cross-to-compose migration:

```bash
trails regrade plan \
  --root-dir . \
  --type class \
  --name '<name>' \
  --class-ids '<id>' \
  --include-entries all \
  --json > "$REGRADE_SCRATCH/plan.json"

PLAN_PATH="$(jq -r '.path' "$REGRADE_SCRATCH/plan.json")"
```

For vocabulary work, author the saved plan from the public positional `from` and `to` inputs, then capture the returned path the same way:

```bash
trails regrade plan '<from>' '<to>' \
  --root-dir . \
  --include-entries all \
  --json > "$REGRADE_SCRATCH/plan.json"

PLAN_PATH="$(jq -r '.path' "$REGRADE_SCRATCH/plan.json")"
```

Keep `PLAN_PATH` for the whole governed cycle. Do not replace saved-plan apply with the legacy direct top-level `trails regrade` mode.

### 4. Preview And Dry-Run The Saved Plan

Derive the no-write preview and exercise apply preflight against the same saved plan before expecting a green gate:

```bash
trails regrade preview --root-dir . --plan "$PLAN_PATH"
trails regrade apply \
  --root-dir . \
  --plan "$PLAN_PATH" \
  --include-entries all \
  --dry-run
```

`preview` and dry-run apply do not mutate source or history. Save the returned occurrence inventory and report when the run is large or will cross context windows. A saved plan with safe rewrites or review work can make `regrade check` fail at this stage; that is real work to triage, not a reason to bypass the saved-plan lifecycle.

### 5. Triage Occurrences

Use the report inventory:

- `modified` means Regrade believes a safe rewrite exists.
- `deferred` means a human or agent must judge the occurrence.
- `skipped` means the plan or derived inventory intentionally preserved it.

For deferred occurrences, inspect only enough source context to decide one of:

- add an `override` when a form has a deterministic target;
- add a `preserve` rule when the old form is intentional;
- leave it unresolved and record why when the right target is not known.

Never hide uncertainty by applying a broad replacement.

If triage changes authored plan fields, overrides, or preserve rules, rerun the plan command with the updated structured fields through `--input` or `--input-json`. Omit `--fresh` when unchanged authored fields should carry forward. If only the inventoried source changes, rerun the same plan command without `--fresh`. Use `--fresh` only for a deliberate full replacement, and then supply every authored field that must remain. Recapture `PLAN_PATH` and repeat preview and dry-run apply; never apply a stale inventory.

### 6. Apply The Saved Plan Explicitly

Apply only after the dry-run report is understood:

```bash
APPLY_REPORT="$REGRADE_SCRATCH/apply-cycle-${CYCLE}.json"
trails regrade apply \
  --root-dir . \
  --plan "$PLAN_PATH" \
  --include-entries all \
  --json > "$APPLY_REPORT"

HISTORY_ID="$(jq -r '.history.id' "$APPLY_REPORT")"
```

Safe apply may still leave the gate open when target text contains the source, when review inventory remains, or when new neighbor forms are discovered. That is expected. Continue the loop instead of calling the migration done.

### 7. Audit, Adjust, And Repeat

After each apply cycle:

1. Prove the graduated receipt for either plan mode with `trails regrade check --root-dir . --plan "$HISTORY_ID"`. The history selector is the opaque ID returned by apply, not a path or display name.
2. For a vocabulary transition, also run `trails regrade audit --root-dir . --fail-on-open`. Aggregate audit evaluates vocabulary histories; it is not class-history proof.
3. Compare the new ledger/report with the previous cycle.
4. Confirm changed files are expected.
5. Run targeted tests or commands for the migrated surface.
6. A clean active replan can also prove its gate with `trails regrade check --root-dir . --plan "$PLAN_PATH"`. Do not require check to pass before occurrence triage.
7. If another apply cycle is needed after graduation, restore the active plan by its opaque receipt ID and recapture its path. Apply consumes the active plan, so this adjustment is required even when the authored intent is unchanged:

   ```bash
   ADJUST_REPORT="$REGRADE_SCRATCH/adjust-after-cycle-${CYCLE}.json"
   trails regrade adjust "$HISTORY_ID" \
     --root-dir . \
     --json > "$ADJUST_REPORT"

   PLAN_PATH="$(jq -r '.path' "$ADJUST_REPORT")"
   CYCLE=$((CYCLE + 1))
   ```

   Then repeat preview, dry-run apply, triage, and apply on the same history spine. The cycle-numbered reports remain available for comparison and resume; do not overwrite them.
8. Repeat until the gate is green. If remaining entries require a decision or capability that is not available, stop and capture the review inventory plus its issue/comment as a blocker; do not report the loop as done.

`adjust` restores an active plan on the same history spine without mutating prior receipts.

### 8. Local Review

For repo work, run local review loops on the branch diff. P0-P2 findings must be fixed or specifically acknowledged with evidence. Relevant P3s should be fixed when they improve operator clarity or prevent later drift.

## Done Criteria

A Regrade loop is done only when:

- dry-run and apply behavior were both exercised when source changes were made;
- the final report is green; a run with remaining review inventory is stopped or blocked, not done;
- plan, ledger, and report stayed separate;
- CLI and MCP contract expectations remain aligned;
- targeted verification passes;
- graduated `trails regrade check` accepts the committed class or vocabulary receipt, and `trails regrade audit --fail-on-open` also accepts governed vocabulary histories when applicable;
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
