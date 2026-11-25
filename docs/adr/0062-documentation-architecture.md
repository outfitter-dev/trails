---
id: 62
slug: documentation-architecture
title: Documentation Architecture
status: accepted
created: 2026-10-28
updated: 2026-10-28
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 51]
---

# ADR-0062: Documentation Architecture

## Context

Trails needs one reader-oriented documentation architecture before moving its existing corpus. The older documentation-structure proposal remains unaccepted and prescribes directory, filename and navigation rules that differ from the later Outfitter working doctrine and delivered Skillset lessons. The documentation audit supplies the source inventory; project fit decides the useful local expression of the shared contracts.

On October 28, 2026, the definitive delegated Clark ruling for [TRL-1281](https://linear.app/outfitter/issue/TRL-1281) accepted this project-fit architecture and formally deferred the unresolved positioning and dependent docs pass under [TRL-800](https://linear.app/outfitter/issue/TRL-800). No accepted Trails contract conflict or tenet amendment is required. The external org source remains a working draft; this Trails decision does not ratify it org-wide.

This record settles architecture. It does not claim that the target structure, validation gates, metadata retrofit or first-success journey has been implemented, or that a source merge proves release/publication. Those changes require their own owning work and checks.

## Decision

### Reader journey

Prioritize first-time adopters and working app authors. Evaluators get a short explanation and a direct route to the first success; power users get lookup and operational paths; framework contributors get a physically separate contributor entry. Agents use the same pages and links.

Keep `README.md` as the front door and `docs/index.md` as the reader-intent router. Its first action is the short accepted “understand the idea” stop, followed immediately by first success. Then offer task, configuration, lookup, troubleshooting, and contributor routes. Replace the router's manually exhaustive ADR list with a link to the generated active decision index. Each link promises a concrete outcome rather than repeating a title.

Use one ordinary `docs/start/README.md` journey spine: Start → Build → Ship. Start is the tested first trail and first test, followed by a second shipped surface rendering the same authored contract. Build links to ordinary task and concept pages; it is the doctrine's authoring-loop Work stage under Trails language. Ship links only to independently verified, currently supported output/distribution paths, with future hosts visibly gated. A stage is omitted until it has an actual reader outcome. No member page owns `prev`/`next`, stage numbers or journey membership metadata.

The first-success fixture belongs to TRL-1284. It must prove the exact published installation path selected by the release owner, real commands and output, contract inspection, a passing test, and the second surface. This decision neither picks an unverified registry version nor claims that an unrun fixture passes. Search arrivals can enter any page: every journey stop still states its goal, prerequisites and result independently.

### Section contracts and intentional project fit

| Home | Discriminator and audience | Ownership and boundary |
| --- | --- | --- |
| `docs/index.md` | Which reader job should I do next? All readers. | Curated intent router; no second exhaustive API or ADR catalog. |
| `docs/start/` | How do I reach my first verified success and continue? New adopters. | Journey ordering lives only in its README spine. Later stages link to ordinary pages. |
| `docs/concepts/` | What model explains this behavior, and where are its limits? Learners and working authors. | Graduate concepts now because architecture, draft-state and graph/execution explanations already exist; examples and boundaries remain required. |
| `docs/guides/` | How do I complete a task or apply a practice? Working authors. | Resource, testing, store and governance tasks, with real verification and links to contract owners. |
| `docs/surfaces/` | How does the same trail contract render on a particular surface? App authors and integrators. | Retain the established domain family. Give pages a primary teaching or lookup job and link exact facts to their package owners. No new `trailhead` boundary primitive or giant combined guide is implied. |
| Configuration router intent | Which knobs, precedence and overrides apply? App authors and operators. | Initially link existing owner-proximate Config and related guides. Defer a physical `configuration/` directory until distinct cross-cutting pages earn it; never copy the package reference just to fill a directory. Record this project-fit omission in the router and writing skill. |
| `docs/reference/` | What is the exact contract, including defaults, errors and examples? Working and power users. | Enumerable facts derive from their natural owners; explanations and caveats stay authored. Reference remains independently useful. |
| `docs/migration/` | How do I move existing source or artifacts between supported contracts? Existing users. | Retain this established compatibility family. Current obligations are distinguished from era-bound evidence before any archival. |
| `docs/contributing/` | How do I change, test, govern and release Trails itself? Framework contributors. | Retain this name as the project-fit expression of development. Move release mechanics here only in the later authorized migration slice. App-usage guides remain separate. |
| `docs/tenets.md` and `docs/lexicon.md` | Which principles and terms govern Trails? Users, contributors and agents. | Retain established canonical paths. Lexicon anchors own short definitions; create concept pages only for subjects that need them. No competing glossary. |
| `docs/project/` | What is the project's direction? Interested users and contributors. | Course-changing material such as horizons belongs here once migrated. Evergreen direction stays separate from dated plans and tracker status. Tenets and lexicon retain their intentional established homes. |
| `docs/releases/` | What changed, why does it matter, and where is the release evidence? Existing users. | Keep narratives and explicitly historical records here; package changelogs own exhaustive ledgers, contributor docs own release mechanics. No automatic archive merely because a filename says beta. |
| `docs/adr/` | What was decided, with which status and rationale? All readers who need authority. | Retain singular ADR path and canonical generators. The reset lane owns new canon, draft dispositions, historical snapshots, numbering and its atomic cutover. |
| Troubleshooting router intent | What does this symptom mean and what proves recovery? Operators and working authors. | Start with one symptom-first page when actual supported failure cases are selected; graduate to a directory only when needed. This decision does not invent a diagnostic inventory. |

An owner-proximate package, adapter or example README can remain the canonical page. Do not move it merely to satisfy a docs directory diagram. Choose its owning index by the page's primary reader job: a config task can belong to guides, an API contract to reference, a runnable example to start/guides, and contributor instructions to contributing. Do not automatically classify package READMEs as reference and then add an override registry.

Settle primary membership in this architecture: a dedicated ordinary Markdown child list under `## Pages` in an authored section index claims the normalized repository-relative paths of its linked pages, including relative links outside `docs/`. Lists elsewhere are cross-references and do not claim ownership. Each eligible public page has exactly one claim. Page frontmatter does not repeat its navigation owner, and there is no separate README membership registry. Existing generated exact-reference owners may render this index membership from their package/export facts; do not maintain manual and generated copies. The constraint applies to the index's ownership declaration, not generic page headings.

TRL-1283 implements and proves that contract. It independently discovers/classifies the expected public-page population from bounded roots and owner facts with explicit exclusions; using only already-linked pages cannot detect orphans. Root README and `docs/index.md` are exempt navigation roots, without a cyclic invented owner pair. Section indexes need parent claims and reachability; cycles and disconnected subtrees fail. Required regressions cover an unclaimed public package/example README, cross-links that do not claim, duplicate claims, and historical/private/generated-distribution exclusions. The shrink-only baseline cannot silently absorb changed/new eligible pages. The 523 tracked Markdown files are corpus evidence, not the public population or present enforcement.

Indexes may be `README.md` or the retained `docs/index.md` router. Existing ADR indexes stay generated. Section indexes state scope, list their claimed children with one-line promises, and recommend a next action. Every public page gets one primary navigation owner and is reachable from the router. Direct links elsewhere do not create a second owner. Historical, private working and generated distribution records are classified separately from public evergreen pages.

### Page contracts

Review checks required questions rather than prescribing headings. A guide answers goal, prerequisites, steps, verification and next action. A concept answers problem, model, example, boundaries and related tasks/reference. A reference starts with the exact contract and then examples/caveats. Troubleshooting starts with the symptom, orders causes by checking cost, and proves recovery. An index curates scope and next actions. A decision identifies status, authority, context, decision, consequences, alternatives, non-decisions and relationships. Historical records carry disposition and revision context without being silently rewritten as present doctrine.

The structural floor is one H1, valid governed frontmatter and resolving links. Prose quality, page length and subject coherence stay review judgments; page size never becomes an arbitrary hard CI gate.

### Metadata, naming and links

Adopt `description` on public evergreen pages: one plain-text line, no Markdown/links, a complete statement with a 240-character ceiling and a concrete subject. The proposed docs checker, not this packet, becomes its consumer. Adopt it through a shrink-only retrofit baseline; do not make the existing corpus retroactively green by inventing metadata. A page title comes from its H1 unless an existing renderer requires an explicit field. Preserve established ADR and lifecycle schemas, including their domain fields and exemptions.

Defer tags until an actual consumer and controlled vocabulary exist. Keep ordinary relationships in Markdown links. Do not add generic owner, freshness, audience, journey, ordering or custom relationship fields without schema, semantics and a concrete consumer. `supersedes` remains a domain-owned decision/lifecycle relationship, with reciprocal state derived rather than authored twice; the ADR reset owns any migration of existing decision metadata.

Use standard relative Markdown links with `.md` extensions and stable heading anchors. Link first use of terms of art to their canonical lexicon/concept/reference node. Names are kebab-case and meaningful within their directory. Canonical identity is the repository-relative path plus optional anchor; repeated `README.md` names are valid. Reject the old draft's global filename uniqueness rule. Numeric/datetime naming remains appropriate for ADRs and historical/working records, without spreading to evergreen page names.

### Plans and archives

Preserve `.agents/plans/PLANNING.md` and the repo's tracked agent-packet conventions. They serve execution evidence; `.agents/notes` remains ignored local evidence. Neither is the public product roadmap. Preserve existing packets, active writers and generated Skillset ownership; this decision grants no blanket packet cleanup.

Durable actionable product plans belong under a future `docs/project/plans/` home once there is an actual record to place. Completion or abandonment produces an explicit disposition and outcome, preserving historical body content and migration accounting. Evergreen doctrine stays in its natural home, executable project status in Linear, and final rationale in an ADR or contributor guide. Release plans, release ledgers, release narratives and release mechanics keep their separate owners.

The canonical migration ledger proposed for TRL-1283 records every moved, split, archived or deleted public path and its surviving destinations. Objective checks compare actual path changes with that ledger. Implement it once from authored migration intent; avoid a second hand-maintained runtime fact catalog. Preserve inbound headings or record their replacements when a move changes anchors. Mechanical movement and source corrections remain separately reviewable, except the ADR reset's explicitly atomic archive/canon/reference unit.

### Reconcile the old draft and the tagline gate

This decision replaces the unaccepted `documentation-structure` proposal. Preserve its useful intent—deterministic placement, audience clarity and searchable repository docs—while retiring its unaccepted prescriptions: basecamp/workflow/governance as mandatory directories, global filename uniqueness, per-page prev/next, root-level releases, and a speculative `@ontrails/docs` package as an architectural dependency. The old draft retains its source path with an explicit supersession pointer until TRL-995 and the reset owner perform its final lifecycle disposition. This decision authorizes no archive, canon reset or cutover.

TRL-800 leaves the tagline open. Preserve its settled constraints: capability can bridge in the thesis without replacing trail; a short explanation precedes first success; agent-native serves humans and agents; real contract inspection demonstrates the claim. Do not choose a tagline or finalize opener copy that depends on one. Retain both live TRL-800 execution gates: tagline-dependent copy requires its positioning decision, and the specified docs pass requires Clark's counter-read of the actual explainer gist. That includes the gated README opener, why-trails narrative, router narrative and getting-started ordering execution. The earlier architecture-only counter-read did not inspect that gist or satisfy its gate; the separately completed follow-up is recorded below. Accepted “understand the idea first” sequencing is not accepted prose or execution authority.

Formally defer final TRL-800 positioning/tagline and dependent README opener, why-trails narrative, router narrative and getting-started ordering execution. Independently authorized architecture, validation, source-owned reference work and migration planning may proceed. This decision names the intended journey without authorizing the deferred copy or ordering execution. TRL-800 remains open; the existing working tagline is not approved by this deferral.

The separate Clark counter-read of the actual historical explainer is complete. It supports a compressed authored-trail → inspectable-contract → examples/test → second-surface loop, with composition and operation as goal-specific continuations. The earlier architecture-only review did not perform that gist read; the follow-up does not retroactively alter its provenance. Historical APIs, old two-artifact `.trails` assumptions, universal correctness guarantees and blanket safe-import claims are not current truth. Current owner contracts and verified fixtures establish each concrete claim. This counter-read supplies no positioning approval or docs execution lease.

## Consequences

The architecture preserves established canonical paths and natural fact owners while giving readers deterministic intent-based routes. Earned directories and one ordinary journey spine avoid a parallel tutorial system, duplicated guides and speculative metadata. Index membership becomes an explicit authored navigation contract from which ownership and reachability can be checked.

The tradeoff is an explicit migration and validation phase: existing pages need classification, descriptions, ownership claims and verified examples. Retrofit uses a shrink-only baseline; the acceptance of the architecture does not make the current corpus conformant. New reference or navigation machinery must derive from its named owner rather than scrape prose into a second authoritative catalog.

TRL-1282 compiles canonical writing guidance; TRL-1283 implements objective documentation generation/check and migration accounting; TRL-1284 owns the verified first journey, subject to the formal TRL-800 deferral; TRL-1285 owns derived exact reference; TRL-1286 performs accepted movements. No broad move, gated copy/order execution, new checker or metadata retrofit lands with this decision.

The ADR reset retains numbering, active/historical lifecycle, immutable cutoff and atomic cutover ownership. This record supplies the documentation-structure disposition input to that chain. Final positioning remains a separate authorized decision.

## References

- [Tenets](../tenets.md): documentation tiers, evidence distinctions and progressive disclosure.
- [Lexicon](../lexicon.md): current authored language.
- [ADR-0000](0000-core-premise.md): contract-owned derivation.
- [ADR-0051](0051-package-ownership-follows-natural-altitude.md): natural fact ownership.
- [ADR-0054](0054-project-substrate-names-its-truth.md): one app-root lock and substrate truth boundaries.
- [TRL-1280](https://linear.app/outfitter/issue/TRL-1280): documentation audit and execution inputs.
- [TRL-1281](https://linear.app/outfitter/issue/TRL-1281): definitive project-fit architecture ruling and source scope.
- [TRL-800](https://linear.app/outfitter/issue/TRL-800): settled narrative ingredients and formally deferred positioning/docs-pass execution.
- [Outfitter working doctrine](https://github.com/outfitter-dev/agent-workbench/blob/47a78095404c8f83c54956a009b9479cb24e6995/research/outfitter-docs-doctrine.md): pinned shared-contract input, not org-wide ratification.
- [Skillset documentation system](https://github.com/outfitter-dev/skillset/blob/24800e02ed4e7150ea1bc7130c35603c98ea9da2/docs/development/documentation-system.md): delivered project-fit prior art.
- [Historical explainer](https://gist.github.com/galligan/92461e301ded8c1a08bee9ab501cdeca): revision `ac05518ee356546d8f5ffdb114e3eb19894e2684`, counter-read as ordering evidence rather than current API truth.
