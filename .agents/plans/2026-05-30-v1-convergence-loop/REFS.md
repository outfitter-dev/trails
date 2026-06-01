# References

## Repo State

- Primary checkout: `/Users/mg/Developer/outfitter/trails`
- Execution worktree:
  `/Users/mg/.config/codex/worktrees/trails-v1-convergence`
- Main HEAD at setup:
  `3205521d0504da226c8c6d39867405e02197a2dc`
- Main commit:
  `3205521d0 docs: record adapter authoring decision (#633)`

## Live Issues

| Issue | Link | Role |
| --- | --- | --- |
| TRL-834 | [Linear](https://linear.app/outfitter/issue/TRL-834/draft-warden-fix-metadata-adr) | Base branch, Warden fix metadata ADR. |
| TRL-866 | [Linear](https://linear.app/outfitter/issue/TRL-866/project-warden-diagnostic-fix-metadata-through-rule-trail-outputs) | Created for this goal; Warden rule trail fix metadata projection. |
| TRL-853 | [Linear](https://linear.app/outfitter/issue/TRL-853/draft-adr-conformance-snippet-calls-runconformance-without-importing) | Adapter ADR snippet fix. |
| TRL-861 | [Linear](https://linear.app/outfitter/issue/TRL-861/define-adapter-target-metadata-and-catalog-derivation) | Created for this goal; adapter metadata/catalog. |
| TRL-862 | [Linear](https://linear.app/outfitter/issue/TRL-862/add-http-adapter-authoring-support-and-conformance-factory) | Created for this goal; HTTP owner bundle. |
| TRL-863 | [Linear](https://linear.app/outfitter/issue/TRL-863/build-shared-adapter-check-engine) | Created for this goal; shared adapter check engine. |
| TRL-864 | [Linear](https://linear.app/outfitter/issue/TRL-864/expose-adapter-checks-through-warden-and-trails-adapter-check) | Created for this goal; Warden/local projections. |
| TRL-865 | [Linear](https://linear.app/outfitter/issue/TRL-865/dogfood-adapter-authoring-path-on-a-first-party-http-adapter) | Created for this goal; first-party dogfood. |
| TRL-805 | [Linear](https://linear.app/outfitter/issue/TRL-805/trails-create-adapter-scaffold-adapter-packages-against-the-adapter) | Retargeted from `add.adapter` to `create.adapter`. |
| TRL-836 | [Linear](https://linear.app/outfitter/issue/TRL-836/integrate-warden-backed-term-rewrite-regrades) | Regrade consumes Warden metadata. |
| TRL-850 | [Linear](https://linear.app/outfitter/issue/TRL-850/regenerate-stale-adr-decision-map-and-enforce-consistency-in-pre-push) | Conditional ADR map drift/check work. |
| TRL-826 | [Linear](https://linear.app/outfitter/issue/TRL-826/prove-regrade-package-source-modes) | Conditional package-source mode proof. |
| TRL-829 | [Linear](https://linear.app/outfitter/issue/TRL-829/draft-regrade-adr-from-tracer-evidence) | Conditional Regrade ADR after evidence. |

## Doctrine And Docs

- `AGENTS.md` - repo workflow, Graphite, subagent, Warden guide, release rules.
- `.agents/plans/PLANNING.md` - goal packet, review loop, validation ladder.
- `/Users/mg/.agents/skills/goal-planning/references/code-review.md` - P0-P3
  review model and review output contract.
- `.agents/skills/trails-adrs/SKILL.md` - ADR authoring rules and `scripts/adr.ts`
  workflow.
- `docs/tenets.md` - governing tenets.
- `docs/lexicon.md` - terminology.
- `docs/architecture.md` - contract-first architecture.
- `docs/adr/0000-core-premise.md` - core premise.
- `docs/adr/0001-naming-conventions.md` - naming conventions.
- `docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md` - adapter
  authoring doctrine this stack implements.

## Key Code Surfaces

- `packages/warden/src/rules/types.ts` - `WardenFix`,
  `WardenFixCapability`, and diagnostic shape.
- `packages/warden/src/fix.ts` - safe fix application substrate.
- `packages/warden/src/cli.ts` - `--fix` execution path and report summary.
- `packages/warden/src/guide.ts` - guide projection of fix capability.
- `packages/warden/src/rules/metadata.ts` - rule manifest metadata.
- `packages/warden/src/rules/no-legacy-layer-imports.ts` - current
  `term-rewrite` fix metadata.
- `packages/warden/src/trails/schema.ts` - Warden rule trail diagnostic schema;
  TRL-866 must preserve diagnostic fix metadata here before TRL-836 consumes it.
- `packages/regrade/src/downstream/report.ts` - current preview
  `term-rewrite` transform class and downstream report path.
- `packages/regrade/src/downstream/collect.ts` - downstream source collection.
- `packages/http/package.json` - HTTP public export map.
- `packages/store/package.json` - existing `adapter-support` and testing
  precedent.
- `apps/trails/src/trails/create*` - create/scaffold command family.

## Subagents

- Dewey: Warden fix metadata ADR source map.
- Beauvoir: Adapter authoring substrate map.
- Planck: Regrade/Warden `term-rewrite` integration map.
- Clark: doctrine and stack-order review.
