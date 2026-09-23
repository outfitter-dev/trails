# Agent Guidance Ownership

Trails has three Skillset source boundaries. Each authored item has one owner; Skillset writes the provider and package outputs. A reviewed symlink bridge makes the contributor source visible to Claude Code until released Skillset supports selective project-use projection.

## Boundaries

| Source | Audience | Generated destinations |
| --- | --- | --- |
| `.skillset/skills` and `.skillset/agents` | Agents operating in this repository with project-only roles or host workflow dependencies | `.agents/skills`, `.claude/skills`, `.claude/agents`, `.codex/agents` |
| `.skillset/plugins/trails-dev` | Contributors building and maintaining Trails | `plugin-dev`, `plugins/trails-dev/agents`, `.agents/skills`, plus reviewed Claude discovery links |
| `.skillset/plugins/trails` | Adopters building applications with Trails | `plugin`, `plugins/trails/agents`, plus local skill outputs under Skillset 0.27 |

Generated destinations and nearby `skillset.lock` files are evidence, not authoring surfaces. Change canonical source, run `bun run skillset:sync`, and review the generated diff. The contributor-named symlinks in `.claude/skills` are routing evidence: keep their exact targets and never replace them with copied skill bodies.

## Root Project Inventory

These items stay rooted because they depend on repository agents or host skills that are not portable plugin components.

| Item | Owner reason |
| --- | --- |
| `ask-trails-crew` | Routes to the repository's Clark and Lewis agents. |
| `be-clark`, `be-lewis` | Inline repository personas coupled to the current decision and execution surfaces. |
| `clark-decision`, `clark-pathfinding`, `clark-survey` | Clark workflows that rely on the project agent and current Trails sources. |
| `trails-goal-loop` | Repository adapter for the separately installed `goal-loop` workflow. |
| `trails-local-review` | Repository adapter for the separately installed `local-review` workflow. |
| `clark`, `lewis`, `maintainer` agents | Provider-native repository agents; Skillset 0.27 does not write plugin agents back into repository agent roots. |

## Contributor Plugin Inventory

`trails-dev` owns portable methods for work on Trails itself.

| Item | Disposition |
| --- | --- |
| `building-trails`, `tenets` | Contributor doctrine and source wayfinding. Current tenets and vocabulary still come from the target checkout. |
| `trails-adrs` | ADR workflow and its bundled script and asset. It loads `trails-editorial` for prose. |
| `regrade-loop` | Contributor vocabulary migration workflow. |
| `trails-derive-from-source` | Owner-first derivation review for framework changes. |
| `trails-dogfood-check` | Framework dogfood and boundary review. |
| `trails-editorial` | The one maintained workflow for drafting and reviewing Trails prose. |
| `trails-writing-voice`, `trails-writing-style`, `trails-writing-docs`, `trails-language-styleguide` | Temporary compatibility entries that route to `trails-editorial`; they own no separate doctrine. |
| `trails-discriminate-union` | Temporary compatibility entry that routes to the `public-union-output-discriminants` Warden rule and `building-trails`. |
| `trails-primitive-parity` | Temporary compatibility entry that routes maturity analysis to `building-trails`. |
| `trails-warden-advisory` | Temporary compatibility entry that routes rule placement to `building-trails` and `docs/contributing/warden-rules.md`. |

Compatibility entries remain for the current plugin transition. Remove them in a later explicit plugin release after known prompts and installed bundles have migrated; do not grow them into parallel workflows.

## Adopter Plugin Inventory

`trails` must work without the Trails checkout or `trails-dev`.

| Item | Owner reason |
| --- | --- |
| `trails` | Portable framework contracts, current CLI and surface use, testing, migration, Wayfinder, Warden, examples, templates, and version-coherent references. |
| `trails-error-format` | Portable use of Trails error contracts and the bundled error-taxonomy reference. |
| `trail-engineer` agent | Claude agent for building applications with Trails. |
| Claude lexicon and pattern rules | Adopter coding guidance enforced by the Claude bundle. |
| Claude `SessionStart` hook | Read-only Trails-project detection and non-mutating Warden guidance. |

Contributor ADR, Graphite, release, editorial, dogfood, and framework maintenance commands do not belong in this package.

## Skillset 0.27 Local Output Contract

The repository pins Skillset 0.27.0. In that release, every plugin-owned skill is projected into the portable `.agents/skills` project root. Claude Code's project discovery contract reads `.claude/skills`, so each contributor skill also has a relative symlink there to its canonical directory under `.skillset/plugins/trails-dev/skills`. Claude follows project skill symlinks, and Skillset preserves the bridge while continuing to own all regular output files.

Skillset 0.27.0 rejects the root key `plugins.internal_use`. Do not copy plugin skills back into `.skillset/skills` and do not add unreleased configuration. When a released Skillset version supports selective project-use projection, select the contributor skills explicitly, remove the symlink bridge, and update the boundary tests in the same change.

## Cold Bundle Matrix

| Package | Required proof |
| --- | --- |
| `plugin-dev` | Contributor skills and all skill-local scripts, assets, and references load outside the authoring checkout. Project-only Clark/Lewis and review adapters are intentionally absent. |
| `plugins/trails-dev/agents` | The same portable contributor skill inventory resolves without source paths back into `.skillset`. |
| `plugin` | The adopter agent, hook, rules, two skills, and bundled references resolve without `trails-dev` or checkout paths. |
| `plugins/trails/agents` | The portable adopter skill inventory contains only `trails` and `trails-error-format`. |

Run the repository ownership/parity tests and the disposable bundle boundary test before changing these owners.
