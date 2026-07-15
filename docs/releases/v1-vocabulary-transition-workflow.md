# v1 Vocabulary Transition Workflow

This is the fieldguide for running a v1 vocabulary family through Regrade. Use it with the [v1 Vocabulary Reset Transition Plan](./v1-vocabulary-reset.md).

Vocabulary transitions are not broad text replacements. Each family starts from the governed transition registry, runs through Regrade, records an observed ledger, and leaves a review inventory for anything Regrade cannot prove safe.

## Before Running

Start from the issue, not from memory.

1. Open the owning Linear issue and copy its acceptance criteria into the goal packet.
2. Diff the packet definition of done against the issue acceptance criteria before execution starts.
3. Treat anything omitted from the packet as an explicit decision, not an accident.
4. Confirm the transition id exists in `packages/warden/src/rules/retired-vocabulary.ts`.
5. Confirm the release plan names the family order, compatibility posture, namespace census policy, and execution gate.

The packet is the operative contract for an executor. If the packet drops an issue requirement, the work will probably drop it too.

## Plan

Write the transition through the supported surface and save the JSON report:

```bash
bun apps/trails/bin/trails.ts regrade plan facet trailhead \
  --root-dir . \
  --include-entries all \
  --json > .tmp-regrade/facet-trailhead-plan.json

PLAN_PATH="$(jq -r '.path' .tmp-regrade/facet-trailhead-plan.json)"
```

Use the family names for the current transition. The `from`/`to` pair is the primary seed: planning derives morphology proposals, review-only filename candidates, namespace counts, and matching live-topo preserves into `derivation`, with provenance on every proposal. Review that synthesis before authoring overrides, deferrals, preserves, or `fileRenames`. Planning writes an active plan artifact under `.trails/regrade/<slug>.json`; it does not apply source edits. Do not substitute raw `rg` for the Regrade report; raw search is only the census cross-check.

For a governed classified transition, choose one ratified target as the plan seed. Regrade keys the active plan and history spine by the governed transition identity, defers every governed source form, and derives no safe rewrite. The selected target records planning intent; it does not claim that every occurrence shares that successor. Use the structured review inventory for contextual follow-up edits, rerun `plan --fresh` to capture the reviewed source state, then check and apply the clean evidence. Per-form overrides cannot express two meanings of the same source word and are not the graduation path for a classified transition.

Record:

- command;
- saved JSON path;
- active plan path;
- selected class ids;
- scan scope;
- scanned, matched, rewritten, review, and skipped counts;
- `run.report` counts: `modified`, `deferred`, `skipped`, `open`, `applied`, and `filesChanged`;
- skip reasons;
- whether the gate is open and why.

If the first plan scans generated output or local scratch space, fix the hard-exclude scope or project config before applying. Historical release notes, changelogs, changesets, accepted ADRs, archive plans, and authored decision or agent memory should remain visible as policy-classified evidence: confirm they are counted as `historical-by-policy` and cannot be rewritten by default. Do not wave either class through as "just noisy."

When the conservative plan needs wider discovery, rerun `trails regrade plan <from> <to> --expand --root-dir . --json` for the same transition and review the plan's `expansion.candidates` section. Use `trails regrade check --plan "$PLAN_PATH"`, `trails regrade preview --plan "$PLAN_PATH"`, and `trails regrade apply --plan "$PLAN_PATH"` after the plan exists. Expansion candidates are durable review inventory with kind, value, evidence, suggested classification, and status. Rejected candidates stay in the plan as suppression memory; adopted candidates move into the primary authored plan sections before apply. Pending expansion candidates are never applied by themselves.

## Namespace Census

Before applying, build a census for every public namespace the family might touch. Compare three sources:

- governed transition forms and symbol renames;
- Regrade report inventory;
- raw search for surface-visible identifiers.

Classify each occurrence as one of:

| Class | Meaning |
| --- | --- |
| changed | Regrade applied or the reviewed follow-up moved the occurrence. |
| preserved | The old form intentionally remains because it is transition machinery, a fixture, or current historical truth. |
| deferred | Regrade routed it to review or the executor left it for a later family. |
| skipped | Regrade skipped the file or occurrence with a recorded reason. |
| historical | The occurrence lives in a changelog, old release note, archived plan, decision memory, branch reference, or other typed policy namespace. It is reported as `historical-by-policy` and never rewritten by default. |
| out of family | The match is a different word or substring and not part of the transition. |

The census must name the commands used and the exact paths where old public identifiers remain. A family branch cannot leave draft with a hand-waved "grep looked clean."

## Apply

Apply only after the plan, preview, and census are understood:

```bash
bun apps/trails/bin/trails.ts regrade preview \
  --root-dir . \
  --plan "$PLAN_PATH" \
  --include-entries all \
  --json > .tmp-regrade/facet-trailhead-preview.json

bun apps/trails/bin/trails.ts regrade apply \
  --root-dir . \
  --plan "$PLAN_PATH" \
  --include-entries all \
  --dry-run \
  --json > .tmp-regrade/facet-trailhead-apply-dry-run.json

bun apps/trails/bin/trails.ts regrade apply \
  --root-dir . \
  --plan "$PLAN_PATH" \
  --include-entries all \
  --json > .tmp-regrade/facet-trailhead-apply.json
```

Regrade is the primary migration engine. Apply consumes an active plan artifact and appends the evidence as a run entry in the transition's consolidated history file at `.trails/regrade/history/<slug>.json`. Manual edits are reviewed follow-up after Regrade exhausts the safe slice, not a substitute for running the transition.

For a registry-governed transition, apply also stamps the history run and the CLI/MCP result with governed provenance: transition identity, plan and source hashes, safely applied count, and remaining review count. Warden loads that committed evidence once per project run. A completed transition that requires Regrade provenance cannot be satisfied by an equivalent hand migration with no history entry.

Warden also keeps the latest committed run's unknown stem permutations visible as advisory findings. Each transition/form pair appears once. Add the form to an incremental plan and rerun Regrade, or classify it as out-of-family or preserved; that persisted classification suppresses the advisory on later runs. Earlier history runs remain evidence, but they do not resurrect forms that the latest run has classified or cleared.

Use `trails regrade check --root-dir . --plan "$PLAN_PATH"` when a family should prove the saved plan gate without writing. The check succeeds only when the plan is fresh and its completion gate is green. Use `trails regrade plans --root-dir .` when more than one active plan may exist, because commands without `--plan <path-or-name>` intentionally fail on ambiguity.

Safe follow-up edits usually include:

- public API identifiers Regrade routed to review;
- file moves and filenames;
- generated guides that must be regenerated by their owning command;
- semantic docs where the target word changes the explanation, not just the spelling.

If the run exposes a lower Regrade, Warden, CLI, MCP, or reporting gap, fix the lower gap first, then rerun the family. The tracer is allowed to improve the tool it is testing.

## Evidence

Every family PR body and retro must include an "Execution Gate Evidence" block:

```markdown
## Execution Gate Evidence

- Regrade plan: `<command>` -> `<saved-json-path>`, `plan.path <path>`
- Regrade check/preview: `<commands>` -> `<saved-json-paths>`
- Regrade apply dry-run: `<command>` -> `<saved-json-path>`
- Regrade apply: `<command>` -> `<saved-json-path>`, `history.path <path>`
- Counts: changed N, preserved N, deferred N, skipped N, policy-classified N (`historical-by-policy` N)
- Teaching surfaces: touched N of N census-expected paths; missing 0
- Census: product identifiers 0 unexpected, registry/test fixtures N expected, historical N preserved
- CLI/MCP evidence: `<commands>`
- Review: local P2+ clear, remote P2+ clear or explicitly unavailable
```

If an earlier run artifact was not saved, say that plainly and rerun the closest reproducible report. Do not invent counts from memory. The follow-up fix is to make saving the JSON path mandatory, not to backfill fake precision.

## Post-Cutover Check

After reviewed follow-up edits, rerun a post-cutover report and raw census. The post-cutover report may stay open for expected transition registry fixtures, test fixtures, or historical prose, but it should not find product-code residue for retired public identifiers.

For `facet` -> `trailhead`, the strict product-code residue scan was:

```bash
rg -n "facetId|McpSurfaceFacetMap|wayfind\\.facets|surface-facet-coherence" . \
  -g '!apps/trails/src/__tests__/**' \
  -g '!packages/regrade/src/downstream/__tests__/**' \
  -g '!packages/warden/src/__tests__/**' \
  -g '!packages/warden/src/rules/retired-vocabulary.ts' \
  -g '!**/CHANGELOG.md' \
  -g '!.changeset/**' \
  -g '!.agents/memory/**' \
  -g '!.agents/plans/archive/**'
```

The expected result after the family lands is no output.

## Verification

Run the release plan gate for the family. At minimum, a family affecting Regrade, Warden, docs, and surface-visible vocabulary runs:

```bash
bun test apps/trails/src/__tests__/regrade.test.ts
bun test packages/regrade/src/downstream/__tests__/vocabulary.test.ts
bun test packages/warden/src/__tests__/retired-vocabulary.test.ts
bun run warden:agents:check
bun run wayfinder:dogfood
bun run check
bun run test
bun run build
bun run changeset:check
bun run publish:check
git diff --check
```

Run narrower checks while iterating. The full gate is required before ready or merge unless a skipped check is recorded with a concrete reason.
