# v1 Vocabulary Reset Transition Plan

This is the executable plan for the v1 vocabulary reset. It coordinates the family order, safety policy, compatibility stance, and evidence required before any reset branch changes live code or public API names.

The reset is not a broad text replacement. The typed transition facts live in `packages/warden/src/rules/retired-vocabulary.ts` and are consumed by Regrade. This document owns the narrative: order, boundaries, compatibility decisions, namespace census rules, and verification.

Owning issue: [TRL-1123](https://linear.app/outfitter/issue/TRL-1123/). That issue owns this transition plan. The family issues named below own execution after this plan and the required substrate are in place.

## Source Of Truth

Use these artifacts together:

| Artifact | Role |
| --- | --- |
| `docs/lexicon.md` | Current live vocabulary until the cutover lands. |
| `docs/lexicon-pending.md` | Temporary heads-up for ratified v1 reset targets. |
| `packages/warden/src/rules/retired-vocabulary.ts` | Typed governed vocabulary registry: family ids, forms, symbol renames, review forms, and target shape. |
| `packages/regrade/src/downstream/vocabulary-registry.ts` | Registry-to-Regrade bridge for single-target vocabulary plans. |
| Regrade run output | Observed ledger and report for an execution attempt. |
| This document | Execution order, compatibility posture, namespace census policy, and release boundaries. |
| [v1 Vocabulary Transition Workflow](./v1-vocabulary-transition-workflow.md) | Fieldguide for running one family through Regrade, recording evidence, and keeping the goal packet aligned with issue acceptance criteria. |

Do not copy the registry tables into another durable ledger. If a family needs a new form, symbol rename, preserve rule, or review rule, update the typed registry and tests, then let this plan cite that fact.

## Family Order

Run the families in this order:

1. `facet` -> `trailhead`
2. `blaze` -> `implementation`
3. `contour` -> `entity`
4. `projection` / `project` -> `derive` / `render`
5. cleanup and lexicon absorption

This order is by judgment density, not by blast radius. `facet` is the tracer because it already has a single target and real Regrade proof around plan, ledger, report, CLI, and MCP preservation. `projection` is last because no single target is safe; every occurrence must be classified by stage.

## Shared Scope

Every family run must include:

- current source and tests;
- current docs, skills, plugin guidance, examples, and release docs;
- public package README and API reference text;
- Warden rule names, rule guidance, and generated Warden guide output;
- Wayfinder and surface facts that expose the family through CLI or MCP.

Every family run must exclude or preserve:

- package changelogs and old release notes when they describe historical published behavior;
- old ADR decision records unless the execution issue explicitly owns an ADR rewrite;
- branch names, PR names, Linear issue titles, and commit references quoted as history;
- generated outputs unless the owning command regenerates them.

Use `PathScope` include, exclude, and extension controls rather than ad hoc ignore terminology.

## Review Policy

Each family declares two safety layers.

The first layer is the typed registry. `safeRewriteForms` defines forms that can move mechanically in ordinary prose or non-exported source contexts. `reviewForms` defines forms that must route to review.

The second layer is symbol review. `symbolRenames[].reviewDeclarationTypes` is the current declaration-type hook; it routes configured declaration kinds, such as function parameters, out of silent rewrite lanes. It is not full public API detection by itself. Exported or public declarations must also be caught by the namespace census, derived live-API preserve inventory, or an explicit registry expansion before they move. A public API symbol can move only when the execution issue proves the migration, updates docs and examples, and records the release impact.

If Regrade cannot prove a case, the outcome is review inventory. It is not permission to hand-edit the reset.

## Compatibility Policy

This reset happens before 1.0. The default compatibility posture is a beta hard cutover, not a long-lived dual vocabulary.

That means:

- Regrade is the migration path for existing consumers.
- Warden catches governed residue after the cutover becomes active.
- Release docs explain the changed names and verification commands.
- Long-lived aliases are rejected unless the family issue proves that an ADR-0050 surface accommodation preserves one trail contract without lying.

Family-specific decisions:

| Family | Compatibility decision |
| --- | --- |
| `facet` -> `trailhead` | Hard v1 cutover for grouped surface-entry code and API names. Surface-visible names such as `wayfind.trailheads` and `surface-trailhead-coherence` moved in the tracer family. No long-lived alias window by default. |
| `blaze` -> `implementation` | Hard v1 authoring-API cutover. Do not support both `blaze` and `implementation` as peer trail fields after the reset; that would create two authored shapes for one contract. |
| `contour` -> `entity` | Hard v1 authoring/API cutover. Preserve app-domain uses of `entity` and historical contour references through review instead of assuming every occurrence is a framework declaration. |
| `projection` -> `derive` / `render` | No alias window. This is a classification family, not a rename family. Occurrences become `derive`, `render`, `Derived`, historical, or review inventory. |

If an execution issue needs to override one of these decisions, it must update this document or the accepted ADR before changing code.

## Namespace Census

Before execution, each family must produce a namespace census. The census compares the typed registry, Regrade inventory, and raw search results, then classifies every namespace that Regrade cannot infer from topo or AST facts.

Use this policy:

| Namespace | Policy |
| --- | --- |
| Source declarations and imports | Govern through Regrade and AST symbol classes. Public or exported declarations route to review unless the family proves they are safe. |
| Prose docs and comments | Govern through vocabulary Regrade. Historical docs preserve when they describe old published behavior. |
| Warden rule ids | Rename only with config and docs compatibility explicitly planned. Otherwise keep the rule id and update guidance text. |
| CLI and MCP trail ids | Rename only through the same surface contract review as other public API names. No hidden alias unless ADR-0050 normalization is explicit. |
| Changeset filenames and changelog entries | Historical, never rewritten as part of the reset. New changesets use target vocabulary after the family lands. |
| ADR history | Historical references preserve. Current doctrine docs update. A dedicated ADR rewrite may move accepted/current text when it owns that scope. |
| Branch, commit, PR, and Linear references | Historical, never rewritten. |

The census is complete only when leftover occurrences are one of:

- changed by Regrade;
- preserved with a reason;
- routed to review with structured context;
- historical by namespace policy;
- out of family.

## Family Plans

### Facet To Trailhead

Transition id: `v1-facet-trailhead`.

Purpose: move grouped surface-entry vocabulary to `trailhead` while preserving member trail identity.

Execution issue: [TRL-1119](https://linear.app/outfitter/issue/TRL-1119/).

This is the first tracer. It must prove:

- Regrade can run the registry-owned plan through CLI and MCP.
- The report separates modified, preserved, deferred, and skipped occurrences.
- Surface-visible identifiers moved in this family: `trailheads`, `trailheadId`, `McpSurfaceTrailheadMap`, `wayfind.trailheads`, and `surface-trailhead-coherence`.
- `docs/surfaces/surface-trailheads.md` filename and title cleanup is handled in this family.
- The [v1 transition workflow teaching doc](./v1-vocabulary-transition-workflow.md) is written from the actual run.

### Blaze To Implementation

Transition id: `v1-blaze-implementation`.

Purpose: rename the authored behavior field and related code/API vocabulary to `implementation`.

Execution issue: [TRL-1018](https://linear.app/outfitter/issue/TRL-1018/).

This is the highest-blast authoring family. It must wait for the trailhead tracer and the structured review detail needed by [TRL-1016](https://linear.app/outfitter/issue/TRL-1016/) unless the trailhead run proves current review output is already sufficient at scale.

The execution issue must:

- keep idioms such as "blazing a trail" out of mechanical rewrite lanes;
- treat `.blaze` and trail authoring field moves as public API changes;
- update examples, docs, tests, generated guidance, and release notes together;
- reject a dual `blaze` / `implementation` authoring shape unless an accepted ADR changes this plan.

### Contour To Entity

Transition id: `v1-contour-entity`.

Purpose: rename the domain-object declaration vocabulary to `entity`.

Execution issue: [TRL-1129](https://linear.app/outfitter/issue/TRL-1129/).

This family runs after `blaze` because `entity` is a common app-domain word and requires more judgment than `facet`, but it is less stage-ambiguous than `projection`.

The execution issue must:

- distinguish framework contour declarations from app-domain entity prose that is already correct;
- update docs, examples, package APIs, Warden rules, Wayfinder facts, and release notes as applicable;
- preserve historical beta docs and changelog entries;
- route uncertain `Contour` type names and public declarations to review.

### Projection To Derive Or Render

Transition id: `v1-projection-derive-render`.

Purpose: split `projection` vocabulary by lifecycle stage.

Execution issue: [TRL-1019](https://linear.app/outfitter/issue/TRL-1019/).

This is classification-first. `derive` means producing contract-owned facts from authored inputs. `render` means presenting derived facts through a surface, guide, report, or operator output. The information-architecture category `Projected` becomes `Derived` only through the same review.

No broad rewrite is allowed for this family. The registry intentionally has a classified target and no safe rewrite forms.

### Cleanup

Execution issue: [TRL-1020](https://linear.app/outfitter/issue/TRL-1020/).

Cleanup is not another reset family. It proves the completed executions left the repo coherent.

Cleanup must:

- absorb completed rows from `docs/lexicon-pending.md` into `docs/lexicon.md`;
- delete `docs/lexicon-pending.md` when no rows remain;
- remove temporary Regrade/Warden scaffolding or generalize it into durable tooling;
- regenerate Warden guide output and agent guidance;
- confirm docs, skills, plugin guidance, release notes, and changesets match the final vocabulary.

## Execution Gate

A family branch cannot leave draft until it records:

1. the Regrade command and JSON output path or pasted summary;
2. the namespace census result;
3. changed, preserved, deferred, skipped, and historical occurrence counts;
4. local review outcome for P2 and above;
5. CLI and MCP evidence when the family affects a surface-visible command, trail id, resource, or tool;
6. docs, skills, Warden guide, and release-rule status.

Minimum verification for each execution branch:

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

Run narrower checks first while iterating. The full gate is required before ready or merge.

## What This Does Not Decide

This plan does not start the actual reset.

It also does not decide:

- package taxonomy names;
- docs information architecture beyond the paths touched by the reset;
- whether future migrations use the same family order;
- stable-release timing.

Those decisions belong to their own ADRs or release issues.
