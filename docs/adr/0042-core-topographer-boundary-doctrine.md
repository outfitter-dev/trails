---
id: 42
slug: core-topographer-boundary-doctrine
title: Core/Topographer Boundary Doctrine
status: accepted
created: 2026-05-02
updated: 2026-05-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [14, 15, 17, 35]
---

# ADR-0042: Core/Topographer Boundary Doctrine

## Context

### `@ontrails/schema` is misnamed for what it actually owns

The package called `@ontrails/schema` exports almost nothing about authoring schemas. Its `src/index.ts` lists six functions and a handful of types: `deriveSurfaceMap`, `deriveSurfaceMapHash`, `deriveSurfaceMapDiff`, `writeSurfaceMap` / `readSurfaceMap`, and `writeSurfaceLock` / `readSurfaceLockData` / `readSurfaceLock`.[^schema-index] Every one of those is a derivation, hash, diff, or file I/O over a *resolved* graph. None of them are used while a trail executes.

The naming wasn't always wrong. OpenAPI generation lived in `@ontrails/schema` until the precedent was set that "schema is for primitive schema declarations, not surface-specific projections," and OpenAPI was relocated to `@ontrails/http`.[^trl-586] What's left after that move isn't primitive schema declarations — it's durable artifacts derived from the graph. The package's content is one shape; its name describes another.

### A different misfile sits in core

The mirror problem lives inside `@ontrails/core`. `packages/core/src/index.ts` lines 313–342 export a topo-store public API: `topoStore`, `createTopoStore`, `createTopoSnapshot`, `listTopoSnapshots`, `pinTopoSnapshot`, `unpinTopoSnapshot`, `createMockTopoStore`, plus types and topo-store internal re-exports. Teaching docs[^topo-store-docs] tell users to write:

```ts
import { topoStore } from '@ontrails/core';
```

But the topo store is the read-only *projection of a persisted snapshot* established by [ADR-0015: Topo Store](0015-topo-store.md). It writes rows to `.trails/trails.db`. It tracks history across builds. It produces lockfile exports. None of that runs to dispatch a trail; the in-memory `ReadonlyMap` is the dispatch engine.[^adr-15-execution] What ships from core today as if it were a graph primitive is, in lifecycle terms, a tooling artifact.

### Two misfiles, one boundary

Both misfiles point at the same missing piece: there is no single, declared rule that says when something belongs in core and when it belongs in the package next door. Without that rule, "graph stuff" leaks both directions. Survey-time projection drifts toward `@ontrails/schema`. Persistence-shaped APIs ride into core because there's nowhere else for them to live.

### The forcing artifact is on the backlog

[TRL-403] proposes extending the lockfile schema to catalog trail IDs across apps so `trails run <id>` can resolve a trail ID workspace-wide. That requires changes to `SurfaceLock` schema and snapshot identity (adding `appName` / `appId` to `TopoSnapshot`). Settling the package boundary inside that feature PR is exactly the wrong order. Settling it now lets TRL-403, the wayfinder draft work, and any future workspace-catalog feature land into a defined home instead of an unlabeled basement.

### The frame that does the work

Earlier sketches argued the boundary by size — "minimal map vs. rich map," "lightweight in core, heavy in the sibling package." That framing fails because it has no test. Any concrete API can be argued either way once "minimal" is the only criterion.

The boundary that does hold up is **lifecycle**. Specifically:

> Core owns the graph and how to read it. `@ontrails/topographer` owns durable artifacts derived from the graph and how to compare them across time. A package needs Topographer only when it crosses a process boundary or compares state across time.

That sentence is the working rule for this ADR.

## Decision

### Core owns the graph; Topographer owns durable graph artifacts

The package boundary is the durability boundary, stated as one rule.

**Core (`@ontrails/core`):** Everything required to resolve, validate, and execute the graph in a single process. `trail()`, `topo()`, `contour()`, `signal()`, `resource()`, `Result`, the error taxonomy, the execution pipeline, and the in-memory read API on the `Topo` value sufficient for runtime surfaces and in-process build-time projection.[^read-api-scope]

**Topographer (`@ontrails/topographer`):** Everything that survives outside a single process. Surface map derivation, stable hashing, semantic diffing, lockfile and surface-map persistence, and the topo store's snapshot/pin/history subsystem inside `.trails/trails.db`.

The test that decides where a new piece of code lives:

- Works on a single in-memory `Topo` value, in one process, with no persistence — **core**.
- Crosses a process boundary, persists to disk, or compares two states — **`@ontrails/topographer`**.

This means the keeper sentence:

> `topo()` is the graph. `@ontrails/topographer` maps the graph.

If a Topographer artifact disagrees with the core `Topo`, the artifact is wrong. The graph is truth. Topographer artifacts are derived and regenerable.

### Resolution stays in core; persistence lives in Topographer

The architectural decision underneath the boundary is the split between *resolving* the graph and *persisting* the resolved graph.

- **Resolution** — go from authored declarations to a fully validated, deduplicated, identity-stable in-memory graph. Happens every time `topo()` runs. Core.
- **Persistence** — serialize that resolved graph to a stable, versioned, on-disk format that can be read back, diffed, and pinned. Topographer.

`trails build` and `trails compile` call resolution (core) *and* persistence (Topographer). A surface connector calls only resolution. **The runtime never reads the lockfile to execute trails.** The lockfile is a tooling artifact, not a runtime artifact.

This is the test that catches every subtle violation. If a feature requires reading the lockfile to dispatch a trail, the boundary has been crossed in the wrong direction.

### `trails run` is two different things along the same boundary

The CLI's `run` subcommand splits cleanly along the same axis, and the split is what keeps Topographer off the runtime hot path:

- **`trails run` against an already-loaded app graph** (in-process invocation of a known trail). Core only. No Topographer needed.
- **`trails run <id>` with workspace-wide resolution** (CLI looks up which app owns this trail ID across the workspace). Topographer territory. This is exactly the workspace lockfile catalog [TRL-403] sketches: the CLI consults a persisted, cross-app artifact to resolve the ID *before* runtime execution begins. Once the right app is identified and loaded, execution is core-only.

Conflating these makes Topographer look like it's on the runtime path. It isn't. Workspace-wide resolution is a CLI-level lookup that happens against a tooling artifact. After that lookup, the in-process pipeline is the pipeline core has always owned.

### The shared database primitive is not the topo subsystem

[ADR-0014: Core Database Primitive](0014-core-database-primitive.md) treats `.trails/trails.db` as shared framework infrastructure with subsystem namespaces (`topo_*`, `track_*`, `cache_*`). This ADR moves the **topo subsystem** out of core and into Topographer. It does **not** move the generic `trails-db` primitive.

The following helpers, currently exported from `@ontrails/core` next to the topo-store API, stay in core unless a separate later ADR moves them:

- `openReadTrailsDb`
- `openWriteTrailsDb`
- `ensureSubsystemSchema`
- `deriveTrailsDbPath`
- `deriveTrailsDir`

Those are shared infrastructure that the tracing subsystem depends on too. Sweeping them into Topographer just because they sit nearby in the export list would couple unrelated subsystems. The topo subsystem's tables, snapshot handling, pin lifecycle, and topo export records are what move; the database connection primitives stay where they are.

The test: if a non-topo subsystem (today's `track_*`, tomorrow's `cache_*`) uses a helper, that helper is shared infrastructure and stays in core. If a helper exists only to read, write, or migrate `topo_*` tables, it migrates with the topo subsystem.

### The package rename is part of the doctrine

The package currently called `@ontrails/schema` is renamed to `@ontrails/topographer`. This is a rename plus a fold, not a new package introduction. Net package count is unchanged.

Why `topographer`:

- **It aligns with the framework's `topo`-rooted vocabulary.** `topo()` is the primitive; `topographer` is the package that derives durable artifacts from the topo. The lineage reads cleanly.
- **It fits the existing actor-noun family.** `warden` enforces. `wayfinder` navigates. `topographer` maps. Adding a fourth member of the same family completes a pattern instead of expanding the vocabulary.
- **It names the role, not one artifact.** "Schema" describes one output (the surface map). "Topographer" names the producer of all of them — surface map, lockfile, snapshots, pins, diffs.
- **It matches the verb shape.** The package exports `derive*` functions, hash and diff helpers, and persistence I/O. Topographers do those things.

`topography` reads slightly better in prose ("the topography of this app") and is more honest that the package is mostly data and pure functions. `topographer` reads better as an import statement and matches the family. We import roles. We describe artifacts.

### Public API relocation: scope and migration

The topo-store public API in `packages/core/src/index.ts:313–342` moves to `@ontrails/topographer`. This is a breaking pre-1.0 beta change, not internal refactoring under cover.

The exact symbols moving:

```ts
// Values
topoStore
createTopoStore
createTopoSnapshot
listTopoSnapshots
pinTopoSnapshot
unpinTopoSnapshot
createMockTopoStore
countPinnedSnapshots
countPrunableSnapshots
countTopoSnapshots
pruneUnpinnedSnapshots
createStoredTopoSnapshot   // re-exported as createTopoSnapshot from internal/topo-store.js
getStoredTopoExport

// Types
TopoSnapshot
CreateTopoSnapshotInput
ListTopoSnapshotsOptions
MockTopoStoreSeed
ReadOnlyTopoStore
TopoStoreExportRecord
TopoStoreResourceRecord
TopoStoreRef
TopoStoreTrailDetailRecord
TopoStoreTrailRecord
StoredTopoExport
```

Migration from teaching docs and consumer code is one-line per import:

```diff
- import { topoStore, createTopoStore } from '@ontrails/core';
+ import { topoStore, createTopoStore } from '@ontrails/topographer';
```

`docs/topo-store.md` and `docs/topo-store-reference.md` update accordingly. The changeset entry flags this as a breaking beta change with explicit migration notes. Core gains no dependency on Topographer. Downstream apps and packages that need the topo store import Topographer directly.

The `trails-db` helpers listed earlier ([above](#the-shared-database-primitive-is-not-the-topo-subsystem)) are explicitly out of scope for this relocation.

### Surface package source inventory

For grounding, the file-level shape after the rename and migration:

`@ontrails/topographer` (current `@ontrails/schema` plus topo-store fold):

```text
packages/topographer/src/
  derive.ts                   # deriveSurfaceMap
  hash.ts                     # deriveSurfaceMapHash
  diff.ts                     # deriveSurfaceMapDiff
  io.ts                       # writeSurfaceMap, readSurfaceMap, writeSurfaceLock, readSurfaceLock(Data)
  topo-store.ts               # public topoStore resource + factories (relocated from core)
  internal/topo-store.ts      # storage primitives (relocated from core)
  internal/topo-snapshots.ts  # snapshot lifecycle (relocated from core)
  types.ts
  index.ts
```

`@ontrails/core` (after relocation):

```text
packages/core/src/
  ... all current files except topo-store.ts and the topo internals ...
  internal/trails-db.ts       # generic shared-infra helpers stay here
```

If a future ADR moves the database primitive itself, the `internal/trails-db.ts` line moves with it.

## Non-goals

This ADR does not:

- Rename the `topo()` primitive or change what `topo()` returns.
- Define a new package boundary for the database connection primitive established by [ADR-0014: Core Database Primitive](0014-core-database-primitive.md).
- Define `Topographer`-side APIs for snapshots, pins, or diffs beyond what already exists in `@ontrails/schema` and the relocated topo-store. Maturation of those APIs is downstream work.
- Specify the workspace lockfile catalog format from [TRL-403]. This ADR settles which package owns it; the schema evolution is a separate decision.
- Decide the public teaching path for build-time surfaces (SDK, OpenAPI, docs). [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md) already establishes `surface(graph, { outDir })` as the convenience path; this ADR doesn't change that.
- Move signposts, wayfinder trails, or warden rules into Topographer. Trails-over-data is a separate architectural layer and stays separate.

## Consequences

### Positive

- **One rule decides where new code goes.** Resolution-vs-persistence is testable. New surface, new build-time tool, new governance rule — each gets evaluated against the same one-sentence boundary instead of relitigated.
- **The runtime stays runtime-shaped.** No surface connector imports Topographer in its public teaching path. The runtime never reaches for the lockfile to dispatch.
- **The misfile in core comes out.** The topo-store public API stops living in a package whose other contents are graph primitives. Survey, drift, and lockfile work consolidate in one place.
- **The misfile in `@ontrails/schema` comes out.** The package's name finally matches its contents. The recurring "is this primitive schema or surface projection?" argument from [TRL-586] doesn't recur for snapshot, pin, or diff features.
- **Future Topographer additions don't fragment the package graph.** Snapshots, pins, semantic PR diffs, wayfinder substrate, and the TRL-403 workspace catalog all become additions to one package, not new packages.
- **The actor-noun family is consistent.** `warden`, `wayfinder`, `topographer` line up. New developers can predict the role of an actor-noun package without reading the README.

### Tradeoffs

- **Breaking pre-1.0 beta change.** Every consumer of `topoStore`, `createTopoStore`, the snapshot APIs, and the related types updates an import path. Pre-1.0 is the right window for this; post-1.0 it would be far harder.
- **Two packages instead of one for "graph things".** A reader looking for a graph utility now checks core and Topographer. The boundary is the price; the alternative is an undefined leak in both directions.
- **Some operations need both.** `trails build` and `trails compile` reach into core for resolution and Topographer for persistence. That coupling is real but it's exactly the boundary working as designed: the compile-time tool is the layer that legitimately spans both.
- **`topographer` is a longer import name than `schema`.** The cost is real and one-time. The clarity it buys is permanent.

### Risks

- **Drift between in-memory read APIs and persisted artifacts.** If core grows a richer `Topo` read API while Topographer's surface map shape doesn't keep pace, the two views of "what's in the graph" can disagree. Mitigation: the surface map derivation reads from the same `Topo` value at build time, so disagreement surfaces as a derivation difference, not as silent drift.
- **Pressure to reintroduce a Topographer dependency in core.** A future feature might want core to import Topographer for "just one thing." The boundary holds only if that pressure is rejected. Mitigation: this ADR is the explicit answer when that pressure arrives — core does not depend on Topographer.
- **Lockfile creep onto the runtime path.** A future optimization (signed lockfiles, frozen production graphs) could argue for runtime lockfile reads. That is a real future decision, [explicitly flagged below](#non-decisions). Until that ADR is written and accepted, the runtime never reads the lockfile.

## Non-decisions

The following are deliberately deferred:

- **Whether the lockfile ever becomes a runtime artifact.** A future ADR may decide that production deployments load the lockfile and trust it instead of running resolution. Reasons one might want it: faster startup, frozen production resolution, audit trail of the reviewed graph. Reasons to defer: it couples runtime to a serialization format and pulls drift-detection complexity into the hot path. For v1, the lockfile is firmly a tooling artifact. Production-frozen-from-lockfile is its own future ADR.
- **Whether the shared database primitive eventually moves out of core.** [ADR-0014: Core Database Primitive](0014-core-database-primitive.md) established `.trails/trails.db` as shared framework infrastructure used by both topo and tracing. Moving the connection primitive itself out of core touches both subsystems and warrants its own decision. This ADR carves out the topo subsystem only.
- **The exact `Topo` read API surface area.** [Core](#core-owns-the-graph-topographer-owns-durable-graph-artifacts) commits to "an in-memory read API sufficient for runtime surfaces and in-process build-time projection." The exact accessors grow as concrete consumers (surface connectors, build-time generators) need them. Naming the full accessor list in this ADR risks turning core into a mini-Topographer by demand.
- **Build-time surface packages' internal use of Topographer.** `@ontrails/sdk`, `@ontrails/openapi`, and `@ontrails/docs` may use Topographer internally for richer graph facts (semantic diff of generated artifacts, for example). The public teaching path stays `surface(graph, { outDir })`. Whether they take Topographer as a real dependency is each package's decision, not this ADR's.
- **Migration ordering between rename and topo-store relocation.** Two valid orders exist: rename first then relocate, or relocate first then rename. The boundary doctrine is the same either way. Sequencing is a milestone-planning concern, not a doctrinal one.

## References

- [ADR-0014: Core Database Primitive](0014-core-database-primitive.md) — the shared `.trails/trails.db` and its subsystem namespacing. This ADR carves the topo subsystem out of core; the database primitive stays.
- [ADR-0015: Topo Store](0015-topo-store.md) — the queryable relational projection. This ADR moves its public API into Topographer.
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) — the lockfile as the resolved-graph artifact. This ADR keeps the lockfile firmly in tooling, not on the runtime path.
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md) — the accepted `derive*` / `create*` / `surface()` grammar. This ADR builds on the same lineage by clarifying which package owns the durable derivations.
- [Trails Design Tenets](../tenets.md) — especially "the resolved graph is the story" and "the contract is queryable", which this ADR operationalizes as a package boundary.
- [Lexicon](../lexicon.md) — adds `topographer` as the actor noun for the durable graph artifact role.

[^schema-index]: See `packages/schema/src/index.ts`. The full export list is six functions plus types — no schema authoring helpers.
[^trl-586]: [TRL-586](https://linear.app/outfitter/issue/TRL-586): OpenAPI generation moved from `@ontrails/schema` to `@ontrails/http`. The reasoning ("schema is for primitive schema declarations, not surface-specific projections") created the contradiction this ADR resolves.
[^topo-store-docs]: `docs/topo-store.md` and `docs/topo-store-reference.md` teach `import { topoStore } from '@ontrails/core'`. Both update as part of the relocation.
[^adr-15-execution]: [ADR-0015: Topo Store](0015-topo-store.md), "What changes for whom", on the execution hot path: "Unchanged. The in-memory `ReadonlyMap` stays as the dispatch engine. The topo store is for querying, not for hot-path lookups."
[^read-api-scope]: The exact accessor surface on `Topo` is intentionally under-specified here; see [Non-decisions](#non-decisions).

[TRL-403]: https://linear.app/outfitter/issue/TRL-403
[TRL-586]: https://linear.app/outfitter/issue/TRL-586
