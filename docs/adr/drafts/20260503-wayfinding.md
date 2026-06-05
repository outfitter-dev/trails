---
slug: wayfinding
title: Wayfinding
status: draft
created: 2026-05-03
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [17, 27, 37, 42]
description: "Introduces `@ontrails/wayfinder`: a package of trails over `@ontrails/topographer` artifacts giving agents queryable access to the topo graph via typed query catalog trails (overview, search, typed list filters, describe, contract, nearby, impact, examples, surfaces, facets, versions, diff)."
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
impl_status: partial
---

# ADR: Wayfinding

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
  project them naturally.
- **The resolved topo artifact family is the story.** Wayfinding makes the
  serialized graph content interactive.

### Substrate honesty

The serialized graph today is the TopoGraph plus the topo store, not yet every possible runtime observation described in [ADR-0017]. [ADR-0042] settled the substrate boundary: durable graph artifacts live in `@ontrails/topographer`, core stays runtime-only. Wayfinding v0 sits on top of those artifacts, and must be honest about what they contain — every query must be answerable from the shipped `TopoGraph` and topo-store record shapes, or be marked deferred.

### The recursive property

A query against the topo has typed input, typed output, and a pure implementation. That makes it a trail by definition. Each query has examples, projects to CLI, MCP, and HTTP via the existing surface mechanism, and is itself navigable through wayfinding queries. There is no special navigation runtime, no new surface type — the wayfinder is a topo of trails over the serialized graph, exporting itself like any other package. The graph contains the tools that traverse the graph.

## Decision

### Wayfinding is trails over `@ontrails/topographer` artifacts

Wayfinding does not introduce a new primitive. The wayfinder is a package of trails whose blazes read the durable graph artifacts owned by `@ontrails/topographer`: `TopoGraph`, lock manifest helpers, `DiffResult`, and the read-only topo store records (`TopoStoreTrailRecord`, `TopoStoreTrailDetailRecord`, `TopoStoreResourceRecord`, `TopoStoreSignalRecord`).

This means:

- Every wayfinding query is a trail with typed input, a `Result` output, and
  examples. Tracing captures every invocation for free.
- Surfaces project the trails through the same mechanism every other trail
  uses. No bespoke navigation runtime exists.
- The wayfinder ships from a separate package, `@ontrails/wayfinder`, whose
  topo joins the consuming app's topo at mount time. Apps do not "integrate
  with a navigation framework"; they import a package whose trails join their
  graph.
- Substrate access is read-only and lockfile-shaped. Wayfinding never opens
  network connections, resolves resources, or boots the app.

### Graph-read scope and future rule-join tier

Wayfinding v0 is a cold, deterministic graph-read layer. It ships graph-read queries only, while naming the future rule-join tier so the boundary stays visible:

- **Graph-read queries** read `TopoGraph`, topo-store records, lock manifests, and graph diffs directly. They do not join against Warden reports, traces, package catalogs, network state, or live app execution.
- **Rule-join queries** are allowed later, but only when they cite named rule/checklist sources. The first planned rule-join query is `wayfind.implications`, which reads graph facts plus structured Warden or distribution-ready checklist facts. It must not hand-roll advice.

### Fact provenance envelope

Wayfinding output should make projection doctrine visible everywhere an agent reads it. Derived facts can carry a narrow Wayfinder-local envelope:

```ts
{
  value: unknown,
  category: 'authored' | 'projected' | 'inferred' | 'observed',
  derivedFrom: ContractRef | null,
  source: ArtifactRef,
  freshness: Freshness,
}
```

`derivedFrom` is the projection arrow made data. It does not create a generic source-of-truth registry and does not contradict ADR-0037's rejection of broad `derivedFrom` metadata as a default answer for duplicated framework facts. This envelope is narrower: it explains how a Wayfinder fact was read or projected.

### v0 query catalog

The v0 catalog is deliberately narrow. The test for inclusion: every query must answer from the data already present in `TopoGraph` and the topo-store read API today. Queries that need substrate the graph does not yet expose are deferred, not ambitiously promised.

| Trail ID | Purpose | Substrate today | Status |
|---|---|---|---|
| `wayfind.overview` | Summarize the topo: counts of trails, resources, signals, contours, surfaces, examples; intent distribution; activation source counts | `TopoGraph.entries`, `TopoGraph.activationGraph` | v0 |
| `wayfind.search` | Find trails, contours, resources, or signals by ID, text, namespace pattern, or typed filter | `TopoGraph.entries[].id`, `kind`, descriptions, intent, facets, surfaces | v0 |
| `wayfind.trails` | List trails with typed filters such as intent, surface, facet, example coverage, resource use, signal use, and versioning | `TopoGraph.entries` and trail records | v0 |
| `wayfind.contours` | List contours with typed filters and membership context | `TopoGraph.entries` and contour records | v0 |
| `wayfind.resources` | List resources and which trails declare them | `TopoGraph.entries[].resources` and resource records | v0 |
| `wayfind.signals` | List signals, producers, consumers, and activation edges | `TopoGraph.activationGraph`, signal records | v0 |
| `wayfind.surfaces` | Show durable surface membership facts for trails and facets | `TopoGraphEntry.surfaces`, `TopoGraph.facets`, and explicitly partial operational projection rows when present | v0 |
| `wayfind.facets` | Show resolved surface facet metadata and member trail IDs | `TopoGraph.facets` | v0 |
| `wayfind.versions` | Show trail version entries and lifecycle state | versioned `TopoGraphEntry` fields and topo-store details | v0 |
| `wayfind.describe` | Return the full record for one entity by ID | `TopoGraphEntry` plus `TopoStoreTrailDetailRecord` for the requested entity | v0 |
| `wayfind.contract` | Tight input / output / intent / idempotency / examples / version summary for a trail | `TopoGraphEntry.input`, `output`, `intent`, `idempotent`, examples, version metadata | v0 |
| `wayfind.nearby` | Nearby graph context: `composes`, `composed-by`, contours, resources, signals, surfaces, facets, versions | `TopoGraphEntry.composes`, reverse indexes, resources, contours, signals, surfaces, facets | v0 |
| `wayfind.impact` | Directional and multi-hop reachability for "what is upstream/downstream from this thing?" | graph edges derived from composes, activation, resources, signals, surfaces, facets, versions | v0 |
| `wayfind.examples` | Return examples for a trail or contour | `TopoGraphEntry.examples`, `TopoStoreExampleRecord` | v0 |
| `wayfind.diff` | Compare two graph snapshots (e.g. `main` vs branch) | `DiffResult` from `deriveTopoGraphDiff` | v0 |

The proto's `wayfind.errors` is **deferred**. Today's `TopoGraphEntry` and `TopoStoreTrailRecord` preserve error examples and detour declarations, and core owns the taxonomy registry, but that is not an exhaustive per-trail emitted-error graph. Reintroduce when a `TrailErrorFacts` substrate can report taxonomy, documented, handled, inferred, and observed facts with explicit completeness semantics.

The proto's `wayfind.adapters` is **deferred**. Adapter-kit already owns adapter catalog and readiness checks, but Wayfinder cannot pretend that "available adapter" means "configured" or "used." Reintroduce after adapter-kit exposes a stable report that distinguishes `available`, `configured`, `used`, and `observed` adapter facts.

Complete CLI/MCP/HTTP projection inventory is **deferred** until Topographer owns it as durable graph artifact. v0 `wayfind.surfaces` may include operational projection rows only when it labels their source and partialness; it cannot treat today's topo-store projection rows as the canonical surface graph.

Generic `wayfind.query`, semantic search, and signposts are also deferred. The deterministic structural skeleton ships first on its own merits.

### Visibility and permit posture

Wayfinder trails are operator and developer tools, not app-public verbs. The defaults follow from [ADR-0027]:

- Every wayfinder trail declares `visibility: 'internal'`. Surfaces filter
  internal trails by default.
- MCP exposure is opt-in and permit-gated. Because wayfinder trails are
  internal, the wayfinder package does not surface itself on MCP without exact
  `include` IDs for the selected `wayfind.*` trails plus an authorized permit
  scope.
- HTTP exposure is opt-in. Operator surfaces (`trails admin`, dev CLIs) can
  promote the namespace explicitly.
- CLI exposure on the developer's own machine is the expected default; the
  CLI surface treats local invocation as implicitly authorized, consistent
  with [ADR-0027] Part 4.

This means an app that mounts `@ontrails/wayfinder` does not accidentally hand its agents a self-documenting treasure chest. The graph stays locked unless the operator opts in. ADR-0027 already provides the levers; wayfinding leans on them.

### Stale-graph policy

When the lockfile or surface map is detectably stale relative to source — hash mismatch, missing snapshot id, schema version drift — wayfinding queries return successfully with a `freshness` field on the result envelope rather than refusing or silently serving stale data. The warden flags freshness separately. Wayfinding propagates the signal so callers can react.

The exact freshness envelope is part of the implementation work, not the decision; what the decision settles is the policy: warn-and-proceed, never silently stale, never refuse.

### Tracing falls out for free

Every wayfinding query is a trail invocation, so the tracing primitive ([ADR-0013] / [ADR-0041]) captures usage history without new machinery. Hot paths, empty returns, and recurring composition patterns become queryable signal — and because tracing data is itself queryable through the graph, a later iteration could surface "what queries do agents run most?" through wayfinding itself.

### Package placement

```text
@ontrails/topographer        # graph artifacts, readers, diff helpers (ADR-0042)
@ontrails/wayfinder          # trails over those artifacts (this ADR, v0)
@ontrails/wayfinder/semantic # optional embedding-backed search (post-v0, not v0)
```

`@ontrails/topographer` owns the durable substrate. `@ontrails/wayfinder` is trails over those artifacts. The split keeps `@ontrails/core` runtime-only (per [ADR-0042]) and makes the wayfinder a normal published package whose trails join consuming apps through `mount`. The `@ontrails/wayfinder/semantic` slot is reserved as a sub-package for the post-v0 embedding layer; v0 ships without it.

`TRL-613` (separate, not in this ADR's scope) scaffolds the `@ontrails/wayfinder` package shell. This ADR settles the contract; the implementation lives there.

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
  `wayfind.adapters`, `wayfind.query`, semantic search, exhaustive per-trail
  errors, and live runtime views) move with their substrates, not the
  wayfinder. v0 ships honest about the gaps.
- **Visibility defaults add a one-time mount step.** Apps that want
  wayfinding on MCP or HTTP must opt in. The default is correct (internal),
  but it is a step the user must take.
- **A new published package.** `@ontrails/wayfinder` adds a release and CI
  surface. This is paid for by keeping core runtime-only and giving the
  wayfinder a place to grow (semantic sub-package, future query catalog
  expansions) without bloating either neighbor.

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
- **MCP tool surface.** The full v0 catalog projected naively to MCP may be too
  many tools. MCP exposure should choose clear, permission-friendly top-level
  tools instead of compressing unrelated behavior into junk drawers. The trail
  catalog itself ships unchanged regardless.

### Non-decisions (deferred)

- **Signposts.** Typed name redirects for renamed trails are kin in spirit
  but live at name resolution, not execution. They get their own ADR. v0
  wayfinding does not depend on signposts and ships without them.
- **MCP façade tool design.** Whether the wayfinder ships the full catalog as
  separate MCP tools or through a narrower façade is an MCP projection ergonomics
  decision, made in the wayfinder package — the catalog of trails is the
  same either way.
- **`wayfind.errors`.** Returns when the substrate carries per-trail error
  facts with provenance and completeness semantics; not v0.
- **`wayfind.adapters`.** Returns when adapter-kit exposes a stable report that
  distinguishes available, configured, used, and observed adapter facts; not
  v0.
- **`wayfind.query`.** A generic query endpoint waits until typed filter/list
  queries prove the shared predicate grammar.
- **`wayfind.projections`.** v0 has no projections endpoint and no projections
  section. Projection doctrine is represented through `derivedFrom` on derived
  facts plus first-class `surfaces` and `facets` queries.
- **`wayfind.implications`.** A future rule-join query may explain likely next
  actions, but only by citing Warden rule IDs or named checklist items.
- **Semantic search.** `@ontrails/wayfinder/semantic` slot is reserved.
  Embedding provider choice (local / BYO key / hosted), indexing strategy,
  freshness, and ranking explainability are post-v0.
- **Markdown documentation generation.** Wayfinding is the substrate; doc
  generation is a downstream consumer.
- **Live runtime view.** Belongs to tracing, not wayfinding. Wayfinding
  stays cold.
- **Cross-project telemetry sharing.** Local-only by default; any sharing is
  opt-in and out of scope for this ADR.

## References

- [ADR-0017: The Serialized Topo Graph](../0017-serialized-topo-graph.md) — the
  substrate wayfinding queries
- [ADR-0027: Trail Visibility and Surface Filtering](../0027-visibility-and-filtering.md)
  — visibility and permit posture for wayfinder trails
- [ADR-0042: Core/Topographer Boundary Doctrine](../0042-core-topographer-boundary-doctrine.md)
  — the package boundary that places wayfinding artifacts in `@ontrails/topographer`
  and gives `@ontrails/wayfinder` a defined neighbor
- [ADR-0008: Deterministic Surface Derivation](../0008-deterministic-trailhead-derivation.md)
  — the projection mechanism wayfinding queries reuse
- [ADR-0013: Tracing](../0013-tracing.md) and
  [ADR-0041: Unified Observability](../0041-unified-observability.md) — the
  tracing primitive that captures wayfinding usage for free
- Origin proto: `.scratch/adr/wayfinding-and-signposts.md`

[ADR-0013]: ../0013-tracing.md
[ADR-0017]: ../0017-serialized-topo-graph.md
[ADR-0027]: ../0027-visibility-and-filtering.md
[ADR-0041]: ../0041-unified-observability.md
[ADR-0042]: ../0042-core-topographer-boundary-doctrine.md
