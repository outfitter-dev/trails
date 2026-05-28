---
created: 2026-05-06T15:25:18Z
updated: 2026-05-06T15:25:18Z
description: Pre-v1 audit (TRL-635) of resolved-graph completeness vs target architecture. Completeness matrix across nine dimensions; clarifies .trails/trails.lock is a hash guard not the full graph; defines v1 agent-inspectable scope; seeds a resolved-graph honesty ADR; proposes TRL-653 through TRL-659.
references:
  - docs/adr
  - .trails/trails.lock
linear:
  - TRL-635
  - TRL-653
  - TRL-654
  - TRL-655
  - TRL-656
  - TRL-657
  - TRL-658
  - TRL-659
impl_status: implemented
---

# M4 Resolved Graph Audit

Date: 2026-05-06
Issue: TRL-635
Branch: trl-635-audit-resolved-graph-completeness-vs-target-architecture

## Scope

This audit compares the current resolved-graph implementation with the target
architecture claim that blind agents should be able to inspect the whole system
from Trails artifacts rather than runtime guessing.

The focus is honesty: what is present today, what is partial, and what should
be documented as future work instead of implied as complete v1 behavior.

No Trails-related skill was loaded during the audit.

## Executive Summary

The current implementation is strongest around `deriveSurfaceMap()`,
`_surface.json`, topo-store export JSON, signal relations, trail/resource/signal
query APIs, examples, declared crossings, activation, and drift hashes.

The main honesty gap is artifact naming and expectation setting. The committed
`.trails/trails.lock` is currently a v2 hash envelope and optional workspace
trail index, not the full resolved graph. The richer inspectable graph lives in
the surface-map/export family: `deriveSurfaceMap()`, `_surface.json`,
`topo_exports.surface_map`, and `topo_exports.serialized_lock`.

Survey and topo commands are useful operator views. They should not be treated
as completeness proofs for the whole graph.

## Completeness Matrix

| Dimension | Class | Present today | Gap vs target |
| --- | --- | --- | --- |
| Trails | Present | Trail contracts include input/output, examples, intent, visibility, meta, detours, layers, crosses, resources, fires, and on-signals; surface maps export schemas and relations. | Typed topo-store trail access is narrower than export JSON and omits some full contract detail. |
| Resources | Partial | Resource entries and trail-resource edges are persisted; typed store APIs list resources. | Resource config schema, lifecycle/disposal semantics, and richer dependency contracts are not complete graph nodes. |
| Signals | Present | Signal nodes, payload schemas, examples, producers/consumers, `from`, diagnostics, and governance are derived; relation reads are batched. | Normalized SQL is less rich than stored export JSON, but blind agents can recover the important graph from export/survey. |
| Layers | Partial | Topo and trail layer attachments are exported with input schemas; survey can show composed topo/surface/trail layer names. | Tenets say layers are not standalone v1 graph nodes; surface/execution-call layers are not durable first-class graph rows. |
| Crossings | Partial | Authored `crosses` are normalized, exported, and stored in `topo_crossings`. | Target docs mention inferred `ctx.cross()` calls; current graph stores declarations, not a complete inferred or observed runtime call graph. |
| Surfaces | Partial | Surface map entries include `surfaces`; SQL surface rows exist. | SQL surface rows are explicitly CLI-only today, with MCP/HTTP row completeness deferred. |
| Detours | Partial | Detours are in trail contracts, surface-map/export JSON, and topo/survey detail. | The graph records matching error class names and max attempts, not recover implementation semantics, shadowing, or full taxonomy linkage. |
| Examples | Present | Structured examples are authored, exported, stored in `topo_examples`, and surveyed. | Signal examples live primarily through stored surface-map JSON rather than a normalized signal-example table. |
| Errors and meta | Partial | Error taxonomy and surface projection exist; metadata is an authored trail field. | There is no per-trail exhaustive error contract, and meta is uneven across surface map, SQL, typed accessors, and survey output. |

## Artifact Honesty

The best current resolved graph artifact is the surface-map/export family:

- `deriveSurfaceMap()`
- `_surface.json`
- `topo_exports.surface_map`
- `topo_exports.serialized_lock`

`buildSerializedLock()` produces a richer app graph with activation graph,
activation sources, contours, resources, signals, and trails.

The committed lock type is smaller. It carries a hash, version, and optional
workspace trail index. Current docs and CLI copy should not imply that reading
`.trails/trails.lock` alone reveals the whole graph.

Topo-store queryability is useful but incomplete. The public read API exposes
snapshots, trails, resources, signals, exports, and raw SQL. It does not yet
provide typed accessors for contours, surfaces, layer attachments, error
projections, or a complete contract detail shape.

## Doctrine For Blind Agents

For v1, blind agents can rely on Trails to answer:

- what trails exist
- rough safety/intent metadata
- examples
- declared resources
- declared crossings
- signals fired and consumed
- activation sources
- detours
- many schema details when inspecting surface-map/export JSON

Blind agents should not assume `.trails/trails.lock` is the graph. They should
treat it as a drift/hash guard unless and until a lock v3 embeds or references
the full graph. Agents should prefer `_surface.json`, `topoStore.exports.get()`,
`survey`, and typed topo-store trail/resource/signal accessors depending on
whether they need full JSON fidelity or ergonomic lookup.

Blind agents should not assume the graph contains exhaustive per-trail errors,
non-CLI surface nodes, full resource lifecycle/config contracts,
surface/execution-call layer attachments, or inferred runtime crossings. Those
are partial v1 data or post-v1 target architecture.

## Draft ADR Seed

Title: v1 Resolved Graph Honesty

Status: Proposed

Context: Trails' tenets describe a future where a committed lockfile is a full
resolved graph that agents can inspect to understand every trail, resource,
signal, surface, crossing, layer attachment, example, error, and metadata
relationship. The implementation currently has three related artifact families:
a committed hash lock, rich surface-map/export JSON, and topo-store
relational/query views.

Decision: For v1, the canonical inspectable resolved graph is the
surface-map/export JSON: `deriveSurfaceMap()`, `_surface.json`,
`topo_exports.surface_map`, and `topo_exports.serialized_lock`. The committed
`.trails/trails.lock` is a drift guard and workspace index, not the full graph.
Topo-store typed APIs are supported query views for snapshots, trails,
resources, signals, and exports, but are not yet the complete graph schema.
Survey and topo commands are operator views, not completeness proofs.

Consequences: Docs and CLI help must say this plainly. Governance rules may
require the committed lock hash to match the current graph, but should not claim
the hash lock alone is inspectable architecture. Future graph work should add
typed accessors and durable schema deliberately, without pretending today's
partial views are complete.

Non-goals for v1: exhaustive per-trail error inference, observed runtime graph
merging, MCP/HTTP surface row completeness, standalone layer nodes, and rich
resource lifecycle/config graphing.

## Follow-up Issue Set

The M4 follow-up set should track:

1. (TRL-653) Clarify docs and CLI language: `.trails/trails.lock` is a v1
   drift guard; `_surface.json` and topo-store exports are the inspectable
   graph.
2. (TRL-654) Promote the draft resolved-graph honesty ADR from this report into
   `docs/adr/`.
3. (TRL-655) Add typed topo-store accessors for contours, surfaces, and layer
   attachments, or explicitly document raw/export-only access.
4. (TRL-656) Replace CLI-only `topo_surfaces` projection with real
   multi-surface rows, or mark MCP/HTTP surface persistence as deferred.
5. (TRL-657) Add a complete contract-detail query/view for blind agents:
   schemas, permit, meta, layers, examples, resources, signals, crossings, and
   detours in one shape.
6. (TRL-658) Define v1 error graph scope in an explicit docs/ADR artifact:
   authored, inferred, observed, or deferred error contracts; taxonomy
   projection; and how detours/examples participate. Closure means the artifact
   names the v1 scope, links the M2 taxonomy work, and either adds tested graph
   fields or states they are deferred.
7. (TRL-659) Decide the lock v3 direction in an ADR or design note: embed the
   full graph, or remain a hash pointer to adjacent graph artifacts. Closure
   means the artifact records reviewability, repo-churn, agent-inspectability,
   and migration tradeoffs, and files implementation tickets if the decision
   requires schema changes.

## Audit Conclusion

The resolved graph is concrete enough for the extension to stay in this stack,
but the current v1 truth is narrower than the aspirational docs. The safest
landing posture is to state the artifact hierarchy plainly, preserve the
surface-map/export family as the inspectable graph for v1, and track typed
query/lockfile completeness as explicit M4 follow-up work.
