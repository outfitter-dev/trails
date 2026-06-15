# Pending Lexicon Changes

`docs/lexicon.md` is the source of truth for current vocabulary. The terms below are ratified to change in the v1 ADR Canon Reset (TRL). This file is a heads-up, not a second lexicon — until the reset lands:

- current code, docs, examples, and lexicon entries use the **Current** column — keep using it when describing live reality;
- the **Target** column is the agreed direction — do not treat the current term as permanent;
- do not adopt a target term in code, docs, or examples yet. Doing so before the cutover creates exactly the drift this file exists to prevent.

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
