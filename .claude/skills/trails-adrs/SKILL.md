---
name: trails-adrs
description: "Author, update, and manage Trails ADRs. Use when creating new ADRs, promoting drafts to accepted, updating the ADR index, renaming or renumbering ADRs, or when the user mentions ADR, architecture decision, or decision record."
---

# Trails ADR Authoring

ADRs document the significant design decisions behind Trails — choices that, if reversed, would produce a different framework.

## Core principles

These are from the Trails tenets (`docs/tenets.md`). Every ADR must be consistent with them. When writing or reviewing an ADR, use these as the evaluation lens:

- **The trail is the product.** Surfaces are renderings of the trail contract. One trail, many surfaces, zero divergence. The trail is the unit of everything.
- **One schema, one Result, one error taxonomy.** Drift across surfaces is structurally harder than alignment.
- **Schema always exists.** There is no untyped state. The question is where the schema is authored — derived, declared inline, or extracted to a shared declaration.
- **One write, many reads.** Every authored artifact should feed multiple consumers. If authoring one thing doesn't automatically feed every consumer that needs it, the framework has a bug.
- **Few primitives, many derivations.** Can this be expressed as a specialization of an existing primitive? If yes, use it. New primitives require ironclad justification.
- **Derive by default, declare to tighten, override when wrong.** The framework derives what it can. Declaration is optional tightening. Override is the escape hatch.
- **The contract is queryable.** Agents can inspect the full topology from the contract before making a single call.
- **The resolved graph is the story.** The lockfile is the serialized topology. An agent reading just the lockfile can understand the entire system.

When an ADR proposes something new, test it against these. Does it reinforce the primitives or add to the concept count? Does it derive from what's already authored or require new authoring? Does it make drift harder or easier?

## Before writing

Read related ADRs before drafting. Use `docs/adr/decision-map.json` or browse `docs/adr/` and `docs/adr/drafts/` to find ADRs that touch similar concerns. Good ADRs build on the existing decision graph — they reference specific sections of prior ADRs, link to their headings, and explain how the new decision compounds with or extends what's already decided.

When your ADR relates to an existing one:

- Link to it in References with a one-line description of the relationship
- Link to specific headings within it when referencing a particular decision (e.g., `[ADR-000: The information architecture](000-core-premise.md#the-information-architecture)`)
- Explain whether you're extending, specializing, or building on the prior decision
- If you're contradicting a prior ADR, call it out explicitly — that's what the supersedes mechanism is for

## Script

All ADR operations go through `scripts/adr.ts` (adjacent to this skill):

Destructive commands preview by default. Pass `--yes` to apply changes.

```bash
# Create a new draft (applies immediately — non-destructive)
bun scripts/adr.ts create --title "Reactive Trail Activation"

# Preview a promote, then apply
bun scripts/adr.ts promote events-runtime
bun scripts/adr.ts promote events-runtime --yes

# Update title, slug, status, or number
bun scripts/adr.ts update core-premise --title "Core Premise — Contract-First Design"
bun scripts/adr.ts update 013 --renumber 0013
bun scripts/adr.ts update events-runtime --slug events-runtime-v2
bun scripts/adr.ts update events-runtime --status proposed --yes

# Demote a numbered ADR back to drafts
bun scripts/adr.ts demote 0014 --yes

# Auto-fix common issues (number padding NNN→NNNN, cross-refs)
bun scripts/adr.ts fix
bun scripts/adr.ts fix --yes

# Validate format and consistency
bun scripts/adr.ts check

# Regenerate decision-map.json
bun scripts/adr.ts map
```

The script handles file creation, git moves, title/slug/number updates, index rebuilding, decision map generation, and cross-reference updates.

For manual ADR management without the script, see [assets/adr-management.md](assets/adr-management.md).

## Titles

1. MUST use an H1 `#`
2. MUST lead with their identifier `ADR-NNNN` unless in `draft` status, which omits the number
3. MUST be descriptive enough to recall without opening the file — a good title makes a claim or paints a picture, not just names a topic
4. Prefer a single evocative phrase over `Topic — Explanation` structure. The em dash subtitle is a fallback for when a short title genuinely can't stand alone, not the default pattern
5. A coined term or framework-specific name (like "Crumbs") is fine as a standalone title when the concept is well-established in the project. A generic noun ("Search", "Triggers") is not — it needs to say what the decision *is*

Examples:

- ✅ "Reactive Trail Activation" — makes a claim about what triggers become
- ✅ "Governance as Trails" — reveals the insight (governance uses the same primitive)
- ✅ "Deterministic Surface Derivation" — precise enough to recall the mechanism
- ✅ "Crumbs — Execution Recording and Observability" — coined term earns a subtitle
- ✅ "Core Premise" — foundational enough to stand alone
- 🚫 "Triggers" — just a topic, says nothing about the decision
- 🚫 "Config Resolution — Schema-Driven Discovery and Validation" — subtitle bolted on formulaically
- 🚫 "Events Runtime — Typed Emission and Delivery for the Event Primitive" — over-explained

## Locations

- Accepted: `docs/adr/NNNN-slug.md`
- Drafts: `docs/adr/drafts/YYYYMMDD-slug.md`
- Index: `docs/adr/README.md`
- Decision map: `docs/adr/decision-map.json`
- Tenets: `docs/tenets.md` — the governing design principles. ADRs must be consistent with the tenets.

## Statuses

| Status | Location | Numbered | Meaning |
|--------|----------|----------|---------|
| `draft` | `docs/adr/drafts/` | No | Decision proposed, open for discussion |
| `proposed` | `docs/adr/` | Yes | Decision refined, ready for review |
| `accepted` | `docs/adr/` | Yes | Decision approved, guides implementation |
| `rejected` | `docs/adr/` | Yes | Decision considered and declined (reasoning preserved) |
| `superseded` | `docs/adr/` | Yes | Replaced by a later ADR (link to successor) |

## Frontmatter

```yaml
---
status: draft                                          # draft, proposed, accepted, rejected, superseded
created: YYYY-MM-DD
updated: YYYY-MM-DD
owners: ['[galligan](https://github.com/galligan)']    # array of owners with GitHub details
# depends_on: [9, events-runtime]                      # accepted ADR numbers or draft slugs
---
```

`depends_on` accepts accepted ADR numbers (integers) and draft slugs (the filename without date prefix and `.md`). Use integers for accepted ADRs, slugs for drafts. The decision map renders these as graph edges.

## Content

### Minimal ADR

<adr_template>

```markdown
# ADR: { Descriptive sentence-case title }

## Context
<!-- what problem or tension prompted the decision -->

## Decision
<!-- what we chose and why, with concrete code examples -->

## Consequences
<!-- what this enables, what it constrains, what it leaves open -->

## References
<!-- links to related ADRs, internal documentation, and external resources -->
```

</adr_template>

### Detailed ADR

<adr_template_detailed>

```markdown
# ADR: { Descriptive sentence-case title }

## Context

## Decision

{ Prose that provides a narrative for the decision }

### { Sections providing logical groupings of detail }

- { Details listed out as list items }[^1]
  - { Sublist items should be used for expressing additional detail }[^named-footnote]

## Non-goals
<!-- what the ADR is *NOT* trying to solve (optional, but recommended)  -->

## Consequences

### Positive
<!-- what this enables (required) -->

### Tradeoffs
<!-- known costs/considerations you accept (required) -->

### Risks
<!-- uncertain outcomes you're watching, with mitigation (optional, omit if all downsides are known tradeoffs) -->

## Non-decisions
<!-- explicitly deferred decisions (optional, but recommended; different than non-goals) -->

## References

[^1]: A footnote [link alias](link)
[^named-footnote]: A named footnote with a consistent slug
```

</adr_template_detailed>

## Reference format

```markdown
For accepted ADRs:
- [ADR-NNNN: Title](NNNN-slug.md) — one-line relationship

For draft ADRs:
- ADR: Title (draft) — one-line relationship

For docs:
- [Doc title](../path.md) — one-line description
```

## Style guide

Synthesized from ADR-000 (Core Premise) and ADR-001 (Naming Conventions).

### Voice

- **Declarative, not tentative.** State the decision. Don't hedge.
  - ✅ "Implementations are pure. Input in, Result out."
  - 🚫 "We think implementations should probably be pure when possible."
- **Conversational but precise.** Write like you're explaining to a sharp colleague. Short sentences for claims. Longer sentences only when the explanation genuinely needs the runway.
  - ✅ "That divergence is subtle at first. It compounds."
  - 🚫 "The aforementioned divergence, while initially subtle, has a tendency to compound over the course of the project lifecycle."
- **Active voice.** The framework does things. The developer does things. Passive voice obscures who's responsible.
- **First person sparingly.** Use it in Context to ground the problem in real experience. Drop it in Decision — the decision speaks for itself.

### Structure

- **Context tells a story** — Start with the problem as experienced, not as an abstract concern. The reader should feel the tension before the decision resolves it. Use `###` subsections named descriptively: "Where this came from", "The missing inner loop" — not "Background", "Problem", "Motivation."
- **Decision subsections start with a one-sentence thesis, then expand** — The thesis should stand alone as a summary. The expansion says why it matters and what breaks without it.
- **Show the concrete failure** — Don't just say what's good — say what goes wrong without it. "If an implementation touches stdout, it can't run on MCP" is more persuasive than "implementations should avoid stdout for portability."
- **Code examples are primary evidence** — An agent or developer should understand the decision from a code example without reading the prose. The prose explains *why*. The code shows *what*. Before/after snippets are especially effective for showing what changes and why. Use code liberally if it makes the point clearer than prose would.
- **Claims must be backed up** — Assertions about how systems work, what's possible, what fails, or how other tools behave must be supported. Reference the specific code, ADR, doc, or external source. For external claims (how another framework works, an industry pattern, a protocol behavior), cite the source with a footnote. Unsubstantiated claims undermine the ADR's credibility — if you can't back it up, soften the claim or remove it.
- **Thorough external references** — When the decision draws on external patterns, protocols, specifications, or prior art, cite them properly in footnotes. Link to official documentation, RFCs, specifications, or authoritative sources. A well-referenced ADR helps future readers understand not just what was decided but the broader context that informed it.

### Patterns to use

- **"This means:" lists** — after stating a principle, enumerate its concrete consequences, use sublists for detail
- **"The test:" heuristics** — one-sentence rules that can be applied independently
- **Good/Bad examples** — show both sides, label them clearly
- **Tables for structured comparisons** — error mappings, option trade-offs, category breakdowns
- **Em dashes** — for parenthetical precision without breaking sentence flow
- **Bold for key terms on first introduction** — then use plain after
- **Footnotes for references and links** — keep prose clean; put URLs and citations in footnotes (`[^1]`) rather than inline links that clutter the sentence
- **Heading links for internal cross-references** — use `[see Decision](#decision-subsection)` rather than "as described in the Decision section above." Headings must be unique within a document to make this work

### Patterns to avoid

- **No hedging.** "Perhaps", "it might be worth considering" — if you're uncertain, say so directly
- **No restating the title.** Jump into the problem
- **No wall-of-text paragraphs.** More than 4-5 sentences means two ideas — split it
- **No hypothetical future benefits without present justification.** Lead with what it does now
- **No "as mentioned above."** Each section should stand alone. Link directly if needed
- **No disparaging other projects.** Trails is an alternative, not a correction. Reference other frameworks to explain a design choice ("unlike X, Trails does Y because...") but never to diminish them. We built this because we wanted it — it may not be for everyone, and that's fine
- **No numbered headings.** Don't prefix headings with `### 1.`, `### 2.` etc. — it breaks markdown anchor links and makes reordering painful. Use descriptive heading text alone

### Consequences style

- **Positive items are capabilities, not restatements.** Describe something new the user/system can do
- **Tradeoffs are honest.** Name what you gave up. Defending every choice as costless signals you haven't thought hard enough
- **"What this does NOT decide" is a gift to future authors.** Be specific: name the thing, explain why it's deferred

### Vocabulary

Use the project vocabulary consistently: trail (not action/handler), topo (not registry), follow (not route), blaze (not serve/mount), surface (not transport), crumbs (not tracks).

Read `docs/tenets.md` before writing. Every ADR must be consistent with the tenets.

### Tone calibration

Read your draft aloud. If it sounds like a corporate design document, rewrite it. If it sounds like a blog post, tighten it. The target: the precision of a spec with the readability of a well-written README. Someone who knows the domain deeply explaining their reasoning to someone who will have to live with the consequences.
