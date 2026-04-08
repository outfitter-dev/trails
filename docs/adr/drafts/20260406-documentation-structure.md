---
slug: documentation-structure
title: Documentation structure
status: draft
created: 2026-04-06
updated: 2026-04-06
owners: ['[galligan](https://github.com/galligan)']
---

# ADR: Documentation structure

## Context

### The problem today

The `docs/` directory is a flat bag of files. Constitutional governance documents (`tenets.md`, `vocabulary.md`) sit at the same level as user-facing guides (`getting-started.md`, `testing.md`). The ADR subtree has clear placement rules enforced by tooling, but everything else has none. An agent writing a new document has no deterministic way to decide where it goes or what to name it.

This matters now because the project is approaching 1.0 with a growing surface area of primitives, surfaces, and tooling. The documentation set will expand significantly, and the current structure provides no guidance for that growth. Every new document placed by intuition is a small drift that compounds.

### What we need from the structure

Three things:

1. **Deterministic placement.** Given a document's purpose, an agent or contributor can resolve the path and filename pattern without asking.
2. **Audience clarity.** A newcomer evaluating Trails, a developer building with it, and a contributor working on it need different things. The structure should route them naturally.
3. **Pipeline compatibility.** `@ontrails/docs` will build from `docs/` as its source tree. The structure must work as both a navigable repo directory and input to a documentation site generator.

### The documentation tiers

The tenets already define a four-tier model by rate of change: Tenets → Decisions (ADRs) → Fieldguides → Trail Notes. The filesystem should express this hierarchy rather than flatten it.

## Decision

### Section taxonomy

The `docs/` directory is organized into sections, each answering a distinct question. Each document has one primary job. Placement is determined by that job, even when secondary concerns overlap.

| Section | Question it answers | Audience |
| --- | --- | --- |
| `basecamp/` | "I know software. How does Trails think about it?" | Newcomers, evaluators |
| `guides/` | "How do I use this primitive or practice well?" | Developers building with Trails |
| `workflow/` | "How do I develop effectively with Trails tooling?" | Developers and CI pipelines |
| `reference/` | "What's the exact shape of X?" | Developers looking things up |
| `governance/` | "What are the rules?" | Contributors, agents, framework architects |
| `adr/` | "What did we decide, and why?" | Contributors, agents |

A separate `releases/` directory lives at the repo root (not under `docs/`) because release notes are a repo artifact tied to git history and the changeset pipeline, not a documentation category.

### Placement tests

Each section has a simple discriminator. If the document doesn't pass the test, it doesn't belong in that section.

- **`basecamp/`** — teaches a concept to someone orienting to Trails
- **`guides/`** — helps someone apply a concept in real code
- **`workflow/`** — helps someone operate the tooling and process around Trails development
- **`reference/`** — answers exact lookup questions
- **`governance/`** — constrains design decisions for the framework itself

### Filename uniqueness

No two documents across the entire `docs/` tree share a filename. This prevents ambiguity in grep, search, cross-references, and conversation ("which `testing.md`?").

The naming convention reinforces each section's purpose:

- **`basecamp/`** files are named for the concept the reader is coming from (the bridge anchor)
- **`guides/`** files are named for the Trails primitive or practice they cover
- **`reference/`** files are named for the lookup topic
- **`workflow/`** files are named for the tool or process
- **`governance/`** files are named for the constraint domain

When a topic appears in multiple sections (e.g., testing), the filenames differentiate by reflecting the section's job. `basecamp/test-strategies.md` anchors on what you know. `guides/testing.md` covers the Trails testing practice.

### Directory structure

`tenets.md` stays at the docs root. It is the constitutional document that governs the entire project — nesting it inside a subdirectory would contradict its own stated primacy. All other governance documents live in `governance/`.

```text
docs/
  index.md
  tenets.md

  basecamp/
    index.md
    why-trails.md
    getting-started.md
    how-trails-works.md
    building-apps.md
    writing-logic.md
    test-strategies.md
    errors-and-recovery.md
    comparisons.md

  guides/
    index.md
    trails.md
    trailheads.md
    resources.md
    signals.md
    composition.md
    testing.md
    error-handling.md
    migration/
      index.md
      v0-to-v1.md

  workflow/
    index.md
    cli.md
    warden.md
    agents.md
    project-structure.md

  reference/
    index.md
    api.md
    errors.md
    config.md
    cli-commands.md

  governance/
    index.md
    lexicon.md
    architecture.md
    horizons.md

  adr/
    README.md
    decision-map.json
    NNNN-slug.md
    drafts/
      README.md
      YYYYMMDD-slug.md

releases/
  index.md
  vX.Y.Z.md
```

### Section design

#### `tenets.md` — Top-level

The tenets are the stable doctrinal layer for the framework. They govern. The tenets document stays at the docs root alongside `index.md`, reflecting its constitutional primacy. It is not part of any section — it is above all sections.

#### `basecamp/` — Bridging from what you know

Basecamp is where you go before you hit the trail. Each document bridges from a concept the developer already knows to the Trails way of thinking about it. The developer is assumed to be technically literate and experienced with building software — these are not tutorials from scratch.

The `basecamp/index.md` is a table of contents with narrative prose: it sets the stage for the journey, describes what each document covers, and what the reader will be able to do by the end.

Navigation between documents uses `prev` and `next` frontmatter keys (see Frontmatter conventions below) rather than numeric ordering. This creates a navigable path without requiring filename prefixes or renumbering when documents are inserted.

**Anchor pattern:** every document anchors on an existing concept the developer already knows, then bridges to how Trails handles it.

| Document | Anchors on | Bridges to |
| --- | --- | --- |
| `why-trails.md` | framework fatigue, convention drift | the contract-first model |
| `getting-started.md` | "show me in 5 minutes" | first trail, first test |
| `how-trails-works.md` | "frameworks do magic, magic breaks" | execution pipeline, derivation, introspection |
| `building-apps.md` | app structure, modules | topo, trails, trailheads |
| `writing-logic.md` | functions, error handling | blaze, Result, ctx, resources |
| `test-strategies.md` | test strategies, TDD | examples as data, specify-satisfy-tighten |
| `errors-and-recovery.md` | try/catch, error types | Result, error taxonomy, detours |
| `comparisons.md` | Express, tRPC, Effect, Fastify, etc. | where the models diverge and why |

`comparisons.md` is an informational document, not a competitive one. It anchors on frameworks the reader already knows and explains how Trails makes different structural choices. The tone is "here's where the models diverge" — not "here's why we're better." This is a natural standalone entry point since developers evaluating Trails often search for exactly this kind of comparison.

#### `guides/` — Practice for each primitive

Deep, pattern-oriented documentation for developers actively building. Each first-class primitive gets a guide named after it. Guides cover lifecycle, patterns, edge cases, and "do this, not that" guidance.

The distinction from `basecamp/`: a `basecamp/` document helps the developer *understand* how Trails thinks about testing. `guides/testing.md` helps the developer *write better tests* once they already get it.

`guides/trailheads.md` covers all surfaces (CLI, MCP, HTTP, WebSocket, library) under headings within a single file. This is intentional — surfaces are thin projections of the trail contract, and a single document makes the "define once, surface anywhere" promise tangible. When a new surface ships, it's a new heading, not a new file. Composition patterns (CLI + MCP from the same topo) are shown naturally alongside the per-surface sections.

#### `workflow/` — Development environment and process

How to work *with* Trails tooling while building. The CLI as a development tool, warden in CI, agent skill configuration, hooks, project structure conventions. This section is distinct from guides (which cover using primitives in app code) and basecamp (which covers concepts).

| Document | Covers |
| --- | --- |
| `cli.md` | Using the Trails CLI for development workflows |
| `warden.md` | Warden rules, CI integration, governance pipeline |
| `agents.md` | Agent skills, hooks, working with AI assistants |
| `project-structure.md` | Repo layout, workspace conventions, `.trails/` directory |

`workflow/agents.md` is distinct from `AGENTS.md` at the repo root. `AGENTS.md` is trail notes for agents working *on* Trails itself. `workflow/agents.md` is guidance for developers setting up agents to work *with* Trails in their apps.

#### `reference/` — Lookup tables and exact shapes

Pure reference material: API signatures, error taxonomy tables, config options, CLI command flags. The organizing principle is lookup speed. No narrative, no patterns, no "why" — just "what."

#### `governance/` — Framework constraints

The governance section contains documents that constrain design decisions for the framework itself. The lexicon, the architecture model, and the horizons roadmap live here. These are slow-changing documents aimed at contributors, agents, and framework architects.

`vocabulary.md` is renamed to `lexicon.md`. A lexicon is the authoritative word list for a domain — locked terms, reserved terms, naming principles, enforcement rules. A vocabulary is a general word collection. A taxonomy is a classification hierarchy. What the document governs is a lexicon.

**Migration path for the rename:** `docs/vocabulary.md` is referenced across ADRs, `AGENTS.md`, the tenets, the Clark skill, and potentially external links. The rename should be executed as a mechanical change — a single commit that moves the file and updates all references via search-and-replace. This commit should be isolated from any content changes to the lexicon itself, so the diff is purely structural and easy to verify. Content updates (reflecting the vocabulary review in progress) land as a separate commit on top.

`governance/index.md` describes the documentation tiers and how governance works, serving as the entry point for contributors and agents who need to understand the framework's design constraints.

Note: `tenets.md` is deliberately *not* in this directory. It governs the governance section and everything else. Its placement at the docs root reflects that authority.

#### `adr/` — Decisions

The ADR subtree has existing clear structure, tooling, and placement rules. Numbered ADRs at `docs/adr/NNNN-slug.md`, drafts at `docs/adr/drafts/YYYYMMDD-slug.md`. Unchanged by this ADR.

#### `releases/` — Release narratives

Release docs live at the repo root. Each release file is a curated, prose-driven narrative synthesized from changesets at release time.

Changesets produce the *data* (what changed). Release docs provide the *story* (why it matters, what to do, migration notes). Both exist. Neither replaces the other.

```text
releases/
  index.md              # links to all releases, latest at top
  v1.0.0.md             # prose narrative for the release
  v0.9.0.md
```

The `@ontrails/docs` package consumes both `docs/` and `releases/` to build a site with a proper changelog section.

### Index pages

Every section directory contains an `index.md` that serves as the section landing page. Index pages describe what the section contains, who it's for, and how to navigate it. For the `@ontrails/docs` build pipeline, they're the natural section landing pages.

The ADR subtree uses `README.md` rather than `index.md` because it has existing tooling that generates and maintains the README. This is the one exception.

### Frontmatter conventions

All documents use YAML frontmatter. The baseline fields:

```yaml
---
title: Document title
description: One-line description for indexes and metadata
---
```

#### Navigation: `prev` and `next`

Documents that form a reading path declare their neighbors using slug references:

```yaml
---
title: Writing logic
description: "You know functions — here's blaze, Result, and ctx"
prev: building-apps
next: test-strategies
---
```

Values are slugs (filenames without `.md` extension), scoped to the same section. The docs pipeline resolves slugs to full paths and renders navigation links. A document with no `prev` is a natural entry point. A document with no `next` is a terminal point.

This replaces numeric ordering. Documents can be inserted by updating the `prev`/`next` pointers on their neighbors — no renaming, no renumbering. The navigation graph can also branch in the future if a document has multiple valid next steps, though single values are the default.

### Placement rules

| You're writing... | Path | Filename pattern |
| --- | --- | --- |
| Bridge doc for newcomers | `docs/basecamp/` | `{anchor-concept}.md` with `prev`/`next` in frontmatter |
| Section landing page | `docs/{section}/` | `index.md` |
| Primitive or practice guide | `docs/guides/` | `{primitive}.md` or `{practice}.md` |
| Migration guide | `docs/guides/migration/` | `{from}-to-{to}.md` |
| Dev environment or process doc | `docs/workflow/` | `{tool-or-process}.md` |
| API or lookup reference | `docs/reference/` | `{topic}.md` |
| Governance constraint doc | `docs/governance/` | `{topic}.md` |
| Decision record | `docs/adr/` | `NNNN-{slug}.md` or `drafts/YYYYMMDD-{slug}.md` |
| Release narrative | `releases/` | `vX.Y.Z.md` |

## Consequences

### Positive

- Agents can deterministically place new documents using the placement rules and discriminator tests
- No filename collisions across the tree — every document is unambiguous in grep, search, and conversation
- Navigation via `prev`/`next` frontmatter creates a flexible reading path without coupling to filenames or ordering integers
- The structure scales: each section has clear boundaries, and new documents slot into existing sections rather than accumulating at the root
- The `@ontrails/docs` package gets a structured input tree with index pages as natural section landing pages
- The documentation tiers from the tenets are expressed in the filesystem: tenets (root, rare change), governance (slow change), guides (feature-level change), workflow/basecamp (regular change)
- Surfaces stay unified in a single `guides/trailheads.md` file, reinforcing the "define once, surface anywhere" promise
- Tenets remain at the docs root, preserving their constitutional primacy
- Framework comparisons provide an informational, non-competitive entry point for developers evaluating Trails against known alternatives

### Tradeoffs

- Existing links to `docs/vocabulary.md`, `docs/architecture.md`, `docs/horizons.md`, etc. will break and need updating across the repo, ADRs, and external references
- `prev`/`next` pointers create a maintenance surface: inserting a document requires updating two neighbors. This is lighter than renumbering files but heavier than a single ordering integer
- More directories means more navigation depth — mitigated by index pages and the top-level `docs/index.md` routing

### Risks

- The `basecamp/` model assumes readers arriving at the beginning. If most users arrive via search and land on a single page, the `prev`/`next` navigation may go unused. Mitigation: each document should be self-contained enough to read standalone, even if the full path provides the best experience

## Non-decisions

- **Freshness SLAs.** How documentation freshness is tracked and enforced is a separate concern. See ADR: Documentation freshness SLAs (draft)
- **Multi-value `next`.** The `next` field is currently a single slug. Branching paths (multiple valid next steps) are a natural extension but are not specified here
- **Comparison scope and structure.** Which frameworks are compared and how comparisons are organized within `comparisons.md` is a content decision, not an architectural one
- **The `@ontrails/docs` build pipeline.** How the docs package consumes this structure, resolves `prev`/`next` slugs, and renders navigation is a separate concern
- **Migration plan.** The mechanics of moving files, updating links, and updating `AGENTS.md` are implementation details, not architectural decisions

## References

- [Tenets](../tenets.md) — documentation tiers: Tenets → Decisions → Fieldguides → Trail Notes
- [ADR-0001: Naming conventions](../adr/0001-naming-conventions.md) — naming principles that apply to documentation paths
- [ADR-0000: Core premise](../adr/0000-core-premise.md) — "author what's new, derive what's known" applies to documentation: author the source tree, derive the site
