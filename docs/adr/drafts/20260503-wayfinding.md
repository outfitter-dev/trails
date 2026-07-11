---
slug: wayfinding
title: Wayfinding
status: draft
created: 2026-05-03
updated: 2026-07-10
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17, 27, 37, 42]
description: "Defines Wayfinder as the navigation layer over `@ontrails/topographer` artifacts: a shared resolver/filter/view query model that renders to CLI, MCP, docs, and future maps without inventing surface-specific navigation semantics."
references:
  - docs/adr/0008-deterministic-trailhead-derivation.md
  - docs/adr/0013-tracing.md
  - docs/adr/0017-serialized-topo-graph.md
  - docs/adr/0027-visibility-and-filtering.md
  - docs/adr/0037-owner-first-authority.md
  - docs/adr/0041-unified-observability.md
  - docs/adr/0042-core-topographer-boundary-doctrine.md
  - .scratch/adr/wayfinding-and-signposts.md
linear:
  - TRL-613
  - TRL-901
  - TRL-1034
  - TRL-1035
  - TRL-1037
  - TRL-1040
  - TRL-1042
  - TRL-1043
  - TRL-1044
  - TRL-1046
impl_status: partial
---

# ADR: Wayfinding

> **Package placement superseded by ADR-0042.** The reusable Wayfind graph-read
> catalog now ships from `@ontrails/topographer`; CLI and MCP wrappers remain
> app-owned. The navigation model and `wayfind.*` product vocabulary in this
> draft remain current, but references to a separate `@ontrails/wayfinder`
> package below are historical design context.

<!-- Keep the supersession notice distinct from the companion note. -->

> Companion: a separate signposts ADR is tracked but deliberately deferred.
> Wayfinding does not depend on signposts; signposts will land later as a
> narrower decision once the wayfinder shell exists to host name redirects.
> Origin proto: `.scratch/adr/wayfinding-and-signposts.md`.

## Context

### Agents work on files; Trails has a richer substrate

Agents in any framework — Trails included — currently work on files. They read, grep, infer. Trails has a richer substrate than files (the contract, the topo, the resolved graph), but that substrate is exposed today for tooling and humans, not for the agents who do most of the work. Without a queryable, agent-shaped view, agents must hold the codebase in their context window. That model is fragile, drifts as the conversation moves, resets on compaction, and gets re-derived expensively from `grep` plus reads.

This is the LSP analogy at its sharpest: human developers in modern IDEs do not memorize codebases — they use go-to-definition. Agents have been forced to memorize because go-to-definition did not exist for them.

### The tenets already demand this primitive

- **The contract is queryable.** Wayfinding makes the property practical for
  agents.
- **One write, many reads.** Wayfinding is purely another read of the same
  trail definitions. No new authoring is required from app developers.
- **Surfaces are peers.** Wayfinding queries are trails, so CLI, MCP, and HTTP
  render them naturally.
- **The resolved topo artifact family is the story.** Wayfinding makes the
  serialized graph content interactive.

### Substrate honesty

The serialized graph today is the TopoGraph plus the topo store, not yet every possible runtime observation described in [ADR-0017]. [ADR-0042] settled the substrate boundary: durable graph artifacts live in `@ontrails/topographer`, core stays runtime-only. Wayfinding v0 sits on top of those artifacts, and must be honest about what they contain — every query must be answerable from the shipped `TopoGraph` and topo-store record shapes, or be marked deferred.

### The recursive property

A query against the topo has typed input, typed output, and a pure implementation. That makes it a trail by definition. Each query has examples, renders to CLI, MCP, and HTTP via the existing surface mechanism, and is itself navigable through wayfinding queries. There is no special navigation runtime, no new surface type — the wayfinder is a topo of trails over the serialized graph, exporting itself like any other package. The graph contains the tools that traverse the graph.

## Decision

### Wayfinding is trails over `@ontrails/topographer` artifacts

Wayfinding does not introduce a new primitive. The wayfinder is a package of trails whose implementations read the durable graph artifacts owned by `@ontrails/topographer`: `TopoGraph`, lock manifest helpers, `DiffResult`, and the read-only topo store records (`TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `TopoStoreResourceRecord`, `TopoStoreSignalRecord`).

This means:

- Every wayfinding query is a trail with typed input, a `Result` output, and
  examples. Tracing captures every invocation for free.
- Surfaces render the trails through the same mechanism every other trail
  uses. No bespoke navigation runtime exists.
- Reusable Wayfind graph-read and query mechanics ship with
  `@ontrails/topographer`. CLI and MCP wrappers remain app-owned and render the
  same query contracts without creating a second substrate package.
- Substrate access is read-only and lockfile-shaped. Wayfinding never opens
  network connections, resolves resources, or boots the app.

### Graph-read scope and future rule-join tier

Wayfinding v0 is a cold, deterministic graph-read layer. It ships graph-read queries only, while naming the future rule-join tier so the boundary stays visible:

- **Graph-read queries** read `TopoGraph`, topo-store records, lock manifests, graph diffs, and bounded adapter-kit package/conformance evidence directly. They do not join against Warden reports, traces, arbitrary package catalogs, network state, or live app execution.
- **Rule-join queries** are allowed later, but only when they cite named rule/checklist sources. The first planned rule-join query is `wayfind.implications`, which reads graph facts plus structured Warden or distribution-ready checklist facts. It must not hand-roll advice.

### Fact provenance envelope

Wayfinding output makes derive/render doctrine visible everywhere an agent reads it. Derived facts carry a narrow Wayfinder-local envelope:

```ts
{
  value: unknown,
  category: 'authored' | 'derived' | 'inferred' | 'observed',
  derivedFrom: ContractRef | null,
  source: ArtifactRef,
  drift: DriftState,
}
```

`derivedFrom` is the derive arrow made data. It does not create a generic source-of-truth registry and does not contradict ADR-0037's rejection of broad `derivedFrom` metadata as a default answer for duplicated framework facts. This envelope is narrower: it explains how a Wayfinder fact was read or derived.

`drift` replaces the older "freshness" language. Freshness sounds like a cache age; the governance question is whether the fact is aligned with the requested source. The first states are:

- `aligned` — the requested source exists and matches the graph state Wayfinder read.
- `drifted` — the requested source exists but Wayfinder detected code/artifact divergence.
- `absent` — the requested source is missing and the result is necessarily partial.

### Navigation catalog

The v0 catalog is deliberately narrow. The test for inclusion: every query must answer from the data already present in `TopoGraph` and the topo-store read API today. Queries that need substrate the graph does not yet expose are deferred, not ambitiously promised.

The catalog is no longer defined as a long list of unrelated command nouns. It is defined by one navigation algebra:

- **Resolver** chooses the target population. It answers, "What am I looking at?"
- **Filter** narrows a population by indexed facts. It answers, "Which of them?"
- **View** renders facts about the resolved population. It answers, "What do I need to see?"

A new command target earns its place only when it introduces a new way to resolve. A view does not become a subcommand just because one surface wants a friendlier shape. That keeps CLI, MCP, docs, and future UI renderings aligned on one query model.

### Resolvers

Resolvers are the entry points into the graph or source:

| Resolver | Meaning | Notes |
|---|---|---|
| `id` | Resolve one saved graph entity by exact ID | Bare dotted tokens default here. Missing IDs fail loudly. |
| `pattern` | Resolve by lexical namespace pattern or glob | Globs produce a list-shaped population. |
| `query` | Resolve by deterministic free-text over indexed graph text | This is search-like, but remains bounded to indexed facts. Semantic ranking is deferred. |
| `file` | Resolve one explicit source file | The natural view is `outline`; graph context attaches when artifacts are available. |

Targets are deterministic by shape. A path-like token or token with a source extension resolves as a file. A dotted or bare graph ID resolves as a graph entity. The one ambiguous case — an extensionless token that is both a real file and a graph ID — fails loudly and asks the caller to disambiguate. Wayfinder must report the resolved target kind in metadata so agents know what happened.

Bare globs are not inferred. A glob is list-shaped by definition, so callers must use the explicit pattern resolver: `trails wayfind pattern "wayfind.*"`. A source file target uses the explicit file resolver when the CLI shape could otherwise be ambiguous: `trails wayfind file apps/trails/src/app.ts --outline`.

Relations are not resolvers in the v0 CLI. They are target-bound modes over one resolved graph entity:

- `related` is the default for a bare ID and returns bounded nearby context.
- `deps` walks upstream dependencies.
- `impact` walks downstream blast radius.

In the current CLI, these render as `trails wayfind wayfind.search`, `trails wayfind wayfind.search --deps`, and `trails wayfind wayfind.search --impact`. Filters supplied with relation flags bind to the explored relation set.

### Filters

Filters are typed predicates over indexed facts. Population filters are plural because they select a population:

- `--trails`
- `--resources`
- `--signals`
- `--surfaces`

Predicate filters are singular because they name a field, even when the field accepts multiple values:

- `--intent read`
- `--returns-error NotFoundError`
- `--adapter commander hono`
- `--surface mcp cli`
- `--query "release drift"`

Adapter remains a predicate and an included fact, not a top-level graph population. In the app graph, an adapter is how a surface is delivered. Package conformance evidence is useful, but it is a registry or doctor concern unless it is attached to a concrete surface delivery fact.

### Views

Views render facts about the resolved population:

| View | Meaning |
|---|---|
| `overview` | Summarize the graph or current population. |
| `list` | Return compact entity rows. |
| `summary` | Return a compact one-entity orientation. |
| `describe` | Return the full saved entity record. |
| `contract` | Return the trail contract slice: input, output, intent, examples, versions, and error shape when available. |
| `outline` | Return source structure for file targets and attach graph context when possible. |
| `map` | Render graph shape around the resolved population. |

`map` is a view, not a second graph artifact. The topo is the territory. A surface is where a capability can be invoked. A map is how the resolved graph shape is rendered for orientation.

### Includes

Includes attach compact fact families without changing the resolved population:

```bash
trails wayfind wayfind.search --view contract --include examples
trails wayfind --trails --intent read --include surfaces
trails wayfind pattern "wayfind.*" --include examples
```

Includes are not a junk drawer for new views. They attach bounded facts to a result whose target population and view are already clear.

The current CLI support accepts includes on explicit targets and filtered populations. Relation flags such as `--deps` and `--impact` do not accept includes until Wayfinder can bound includes to the resolved relation population.

### Distinct command

`diff` remains distinct because it compares two explicit graph baselines. It has a second root, so it is not just a view over one resolved population.

### Current catalog mapping

The existing catalog maps onto the algebra this way:

| Existing trail ID | Algebra role | Status |
|---|---|---|
| `wayfind.overview` | `overview` view over the saved graph | keep |
| `wayfind.search` | `query` / `pattern` resolver over saved graph entities | reshape behind operator grammar |
| `wayfind.trails`, `wayfind.resources`, `wayfind.signals`, `wayfind.surfaces` | population filters plus `list` view | reshape |
| `wayfind.trailheads` | current grouped surface entry facts; rename follows the vocabulary reset | reshape |
| `wayfind.versions`, `wayfind.examples`, `wayfind.errors` | includes and focused list views | reshape |
| `wayfind.adapters` | adapter predicate plus included surface delivery facts | reshape |
| `wayfind.describe`, `wayfind.contract`, `wayfind.outline` | views | keep, rendered through the shared planner and file selector |
| `wayfind.nearby`, `wayfind.impact` | relational modes and map/list views | keep behind bare ID, `--deps`, and `--impact` |
| `wayfind.diff` | two-root graph comparison | keep distinct |

`wayfind.errors` is intentionally not an exhaustive emitted-error graph. It reports documented, handled, inferred, and observed facts with explicit completeness semantics, and marks emitted-error completeness unknown unless a future substrate proves otherwise.

Generic semantic search and signposts are deferred. The deterministic structural skeleton ships first on its own merits.

### Visibility and permit posture

Wayfinder trails are operator and developer tools, not app-public verbs. The defaults follow from [ADR-0027]:

- Every wayfinder trail declares `visibility: 'internal'`. Surfaces filter
  internal trails by default.
- MCP exposure is opt-in and host-gated. Because wayfinder trails are internal,
  the Wayfind catalog does not surface itself on MCP without exact `include`
  IDs for the selected `wayfind.*` trails. Exact include is not itself an
  authorization boundary; hosts that expose Wayfinder over MCP must apply their
  own auth, permit, or workspace-boundary policy for the selected tools.
- HTTP exposure is opt-in. Operator surfaces (`trails admin`, dev CLIs) can
  promote the namespace explicitly.
- CLI exposure on the developer's own machine is the expected default; the
  CLI surface treats local invocation as implicitly authorized, consistent
  with [ADR-0027] Part 4.
- The Trails operator CLI dogfoods v0 by exposing a selected read-only subset
  through exact IDs while the unified command grammar lands. This is not
  wildcard namespace exposure and does not promote deferred queries.

This means an app that imports the reusable Wayfind catalog does not
accidentally hand its agents a self-documenting treasure chest. The graph stays
locked unless the operator projects selected internal trails. ADR-0027 already
provides the levers; wayfinding leans on them.

### Stale-graph policy

When the lockfile or surface map is detectably stale relative to source — hash mismatch, missing snapshot id, schema version drift — wayfinding queries return successfully with a `drift` field on the result envelope rather than refusing or silently serving stale data. The warden flags artifact drift separately. Wayfinding propagates the signal so callers can react.

The exact drift envelope is part of the implementation work, not the decision; what the decision settles is the policy: warn-and-proceed, never silently stale, never refuse.

### Source selection

Wayfinder supports one source axis:

```bash
trails wayfind --source locked ...
trails wayfind --source live ...
```

`locked` reads committed Topographer artifacts. It is the default because it is deterministic for docs, CI, release checks, and agent replay. `live` derives an in-memory graph from the current app without writing artifacts. It is the development and self-description path.

The source selector is explicit and never auto-falls back. If a caller asks for `locked` and artifacts are absent, Wayfinder returns an absent/drift diagnostic. If a caller asks for `live` and the app cannot load, Wayfinder returns the load failure. This preserves determinism and makes the envelope trustworthy.

This is also how `survey` begins to retire. Survey's useful live-introspection behavior moves under Wayfinder's source axis; the word `survey` can remain reserved for future map-making or measurement work, but it stops being a peer navigation command.

### MCP graph resources

Wayfinder renders to MCP in two shapes:

- **Resources** expose addressable graph entities. A client can browse or inspect stable URIs such as `trails://trail/{id}`. Source-file resources such as `trails://source/{path}` are a future extension once the live/source axis has a stable resource contract.
- **Tools** run dynamic queries such as pattern, query, relation, map, and diff.

Resources are the upgrade path over the older façade-tool idea. Some MCP clients only consume tools, so tools remain the floor. But graph browsing and one-entity inspection belong in resources because the graph already has stable identities.

This decision does not require every Trails surface to expose the same ergonomic shape. It requires every surface to render from the same query model and preserve the same target, source, drift, and provenance facts.

### Tracing falls out for free

Every wayfinding query is a trail invocation, so the tracing primitive ([ADR-0013] / [ADR-0041]) captures usage history without new machinery. Hot paths, empty returns, and recurring composition patterns become queryable signal — and because tracing data is itself queryable through the graph, a later iteration could surface "what queries do agents run most?" through wayfinding itself.

### Package placement

```text
@ontrails/topographer # graph artifacts, readers, diff helpers, Wayfind catalog
```

`@ontrails/topographer` owns both the durable substrate and the reusable query
catalog over that substrate. The fold keeps `@ontrails/core` runtime-only (per
[ADR-0042]) without asking consumers to install a second graph package. A
future semantic-search implementation must earn its own owner and package
boundary when that substrate exists; this draft no longer reserves a package
route for it.

### Lexicon impact

Two new vocabulary items, kept conservative:

- **`wayfinding`** (noun, the capability) and **`wayfinder`** (agent-noun, the
  package and tool). Parallels `warden`, `topographer`.
- Trail IDs use the `wayfind.` namespace (`wayfind.overview`,
  `wayfind.search`, `wayfind.contract`). Reserved for query trails and prose.

Avoid introducing a top-level `wayfind()` function — "wayfind" is unusual as a code verb. `direct` and `direction` are not reserved; they remain general parameter names where useful (e.g. `wayfind.nearby({ direction: 'in' })`).

## Consequences

### Positive

- **Agent navigation gets first-class substrate.** `wayfind.overview` plus
  `wayfind.nearby` replace minutes of grep with one tool call returning
  a typed, contract-backed result.
- **Zero new primitives.** Wayfinding rides on `trail`, the surface mechanism,
  tracing, and the topographer's durable artifacts. The framework's evaluation
  hierarchy ([Tenets, "Add with intent"]) is satisfied without new authored
  surface area.
- **Cross-project agent transfer.** Same query shapes in every Trails app.
  Agent skills accrue value as the ecosystem grows; no per-repo retraining.
- **Empty-as-finding.** Queries that return nothing become governance signal
  — agents asked things the topo could not answer. The warden gains a
  natural feedback loop without new authoring.
- **Composition design at agent-time.** "What trails return a `User`? What
  trails accept a `User`?" via search and contract queries makes type-aware
  composition tractable without trial-and-error reads.
- **PR review semantics, not text.** `wayfind.diff` over two snapshots gives
  reviewers a contract-shaped change view that text-diffing reviewers cannot
  reproduce.

### Tradeoffs

- **Substrate coupling is real.** Wayfinding's promises are bounded by what
  the topographer's artifacts contain today. Gaps (`wayfind.errors`,
  adapter evidence beyond the bounded adapter-kit package/conformance facts,
  semantic search, exhaustive per-trail errors, and live runtime views) move
  with their substrates, not the wayfinder. v0 ships honest about the gaps.
- **Visibility defaults add a one-time projection step.** Apps that want
  wayfinding on MCP or HTTP must opt in. The default is correct (internal),
  but the consuming app must select which trails to render.
- **The substrate package grows.** `@ontrails/topographer` now owns the
  reusable Wayfind query catalog as well as durable graph facts. ADR-0042 keeps
  the boundary explicit so app-owned CLI/MCP rendering does not leak into the
  substrate package.

### Risks

- **Drift between v0 promises and substrate growth.** If the topographer adds
  fields faster than wayfinding adapts, the catalog could lag. Mitigation:
  every catalog query references the substrate field it reads, so the
  warden can flag mismatches when the substrate changes.
- **Agent over-reliance on cold queries.** Wayfinding is intentionally cold
  (lockfile-shaped). Agents may want runtime answers ("what is happening
  right now?"). That belongs to tracing/observability ([ADR-0041]), not
  wayfinding. Documentation and naming must keep the boundary clean so
  expectations do not drift.
- **MCP surface shape.** The full catalog rendered naively to MCP may be too
  many tools, while one catch-all tool becomes a junk drawer. MCP exposure
  should render browse/inspect as resources and dynamic queries as explicit,
  permission-friendly tools. The query model itself stays unchanged.

### Non-decisions (deferred)

- **Signposts.** Typed name redirects for renamed trails are kin in spirit
  but live at name resolution, not execution. They get their own ADR. v0
  wayfinding does not depend on signposts and ships without them.
- **MCP resource implementation details.** Resource URI grammar, template
  shape, and whether MCP resources call trails or shared query helpers are
  implementation details for the MCP surface work. The ADR settles the split:
  resources for addressable graph facts, tools for dynamic queries.
- **Open query DSL.** The operator CLI's `wayfind query` selector is
  deterministic text filtering over indexed graph facts. A generic expression
  endpoint waits until typed filter/list queries prove the shared predicate
  grammar. v1 supports AND-ed predicates over indexed facts, not a general
  expression language.
- **Projection endpoint.** v0 has no projection endpoint and no projection
  section. Derive/render doctrine is represented through `derivedFrom` on
  derived facts plus first-class surface facts.
- **`wayfind.implications`.** A future rule-join query may explain likely next
  actions, but only by citing Warden rule IDs or named checklist items.
- **Semantic search.** Embedding provider choice (local / BYO key / hosted),
  package ownership, indexing strategy, drift, and ranking explainability are
  post-v0.
- **Markdown documentation generation.** Wayfinding is the substrate; doc
  generation is a downstream consumer.
- **Live runtime observation.** Wayfinder may derive a current graph from
  source with `--source live`, but "what is happening right now?" belongs to
  tracing and observability, not the navigation query layer.
- **Cross-project telemetry sharing.** Local-only by default; any sharing is
  opt-in and out of scope for this ADR.

## References

- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) — the
  substrate wayfinding queries
- [ADR-0027: Trail Visibility and Surface Filtering](../0027-visibility-and-filtering.md)
  — visibility and permit posture for wayfinder trails
- [ADR-0042: Core/Topographer Boundary Doctrine](../0042-core-topographer-boundary-doctrine.md)
  — the package boundary that places durable graph facts and reusable Wayfind
  queries in `@ontrails/topographer`
- [ADR-0008: Deterministic Surface Derivation](../0008-deterministic-trailhead-derivation.md)
  — the surface rendering mechanism wayfinding queries reuse
- [ADR-0013: Tracing](../0013-tracing.md) and
  [ADR-0041: Unified Observability](../0041-unified-observability.md) — the
  tracing primitive that captures wayfinding usage for free
- Origin proto: `.scratch/adr/wayfinding-and-signposts.md`

[ADR-0013]: ../0013-tracing.md
[ADR-0017]: ../0017-serialized-topo-graph.md
[ADR-0027]: ../0027-visibility-and-filtering.md
[ADR-0041]: ../0041-unified-observability.md
[ADR-0042]: ../0042-core-topographer-boundary-doctrine.md
