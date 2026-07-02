# Pending Lexicon Changes

`docs/lexicon.md` is the source of truth for current vocabulary. The terms below are ratified to change in the v1 ADR Canon Reset (TRL). This file is a heads-up, not a second lexicon — until the reset lands:

- current code, API identifiers, examples, and lexicon entries use the **Current** column — keep using it when describing live API reality;
- the **Target** column is the agreed direction — do not treat the current term as permanent;
- do not adopt a target term in code or examples yet. Prose documentation may move only when a cutover branch also updates this file and leaves live API identifiers explicit.

| Current (live) | Target (v1 reset) | Scope |
| --- | --- | --- |
| `blaze` | `implementation` | the authored-behavior field on a trail |
| `contour` | `entity` | the domain-object declaration (schema + identity + examples) |
| `facet` | `trailhead` | one grouped surface entry fronting several trails |
| `projection` / `project` (verb) | `derive` + `render` | split by stage: `derive` = canonical facts, `render` = surface presentation; the information-architecture category `Projected` becomes `Derived` |

Also in flight, tracked for the reset:

- `docs/horizons.md` is slated for deprecation.
- The docs information architecture (the draft documentation-structure ADR) and the location of release notes are unsettled. Do not build on a specific docs taxonomy yet.

This file is temporary. When the v1 reset lands, these changes fold into `docs/lexicon.md` and this file is deleted.

The execution plan is [v1 Vocabulary Reset Transition Plan](releases/v1-vocabulary-reset.md). That plan owns family order, compatibility policy, namespace census rules, and verification. This file only records current live terms and ratified target terms.

The `facet` to `trailhead` prose cutover has started. Current API identifiers such as `facets`, `facetId`, `McpSurfaceFacetMap`, `wayfind.facets`, and `surface-facet-coherence` remain live until their code/API migration lands.
