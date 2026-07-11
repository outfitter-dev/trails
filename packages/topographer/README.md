# @ontrails/topographer

Durable graph substrate for Trails: deterministic TopoGraphs, lockfile helpers, semantic diffing, topo-store persistence, and Wayfind graph-read APIs.

Most applications reach this package through top-level `trails compile`, `trails validate`, and `trails diff`. Those CLI trails layer workspace and topo-store behavior on top of the building blocks in `@ontrails/topographer`. The package itself ships library entry points, not a separate CLI binary, and retired `trails topo compile`, `trails topo verify`, and `trails topo check` forms are not aliases.

## What it owns

- deterministic TopoGraph generation from an established topo
- structured example and field-override provenance projection for TopoGraph entries
- stable hashing for CI drift detection
- semantic diffing between two TopoGraphs
- file I/O helpers for root `trails.lock` plus legacy artifact-family readers
- the topo-store: queryable persistence of the resolved topo graph in the shared
  `trails.db` in the per-user Trails state store, including snapshots, pinning,
  history, and read-only query accessors (relocated from `@ontrails/core` per
  ADR-0042)
- Wayfind graph-read trails and helpers over saved Topographer artifacts,
  including artifact loading, provenance envelopes, typed entity filters,
  relation traversal, error facts, adapter facts, and explicit graph diffs

`@ontrails/topographer` is the durable graph substrate for Trails. Generic `trails-db` plumbing (read/write SQLite handles, subsystem schema management, derived paths) stays in `@ontrails/core` so other subsystems (tracing, signals) can share it without depending on topographer.

## Usage

```typescript
import {
  deriveTopoGraph,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  writeTrailsLock,
} from '@ontrails/topographer';

const topoGraph = deriveTopoGraph(graph);
const hash = deriveTopoGraphHash(topoGraph);

await writeTrailsLock({
  scope: { app: 'demo' },
  summary: { entities: 0, resources: 0, signals: 0, trails: 1 },
  topoGraph,
  topoGraphHash: hash,
  version: 5,
});

// Later, after changes:
const nextTopoGraph = deriveTopoGraph(graph);
const diff = deriveTopoGraphDiff(topoGraph, nextTopoGraph);

if (diff.hasBreaking) {
  console.error('Breaking changes:', diff.breaking);
}
```

`deriveTopoGraph()` rejects draft-contaminated topos. Only established state can be serialized into the committed artifacts.

## File outputs

The normal exported artifact is:

- `trails.lock` — root committed resolved truth. It embeds the serialized TopoGraph plus the hash and summary needed for drift detection.

`trails compile` writes it from the current topo. `trails validate` and `@ontrails/warden` use the lockfile helpers here to detect drift.

Compatibility helpers still read the previous `.trails/trails.lock` plus `.trails/topo.lock` artifact family during the migration window. New writes should use `writeTrailsLock()`.

## API

| Export | What it does |
| --- | --- |
| `deriveTopoGraph(topo)` | Deterministic TopoGraph of every established trail, signal, resource, and entity |
| `deriveActivationGraph(topoGraph)` | Static activation overview for trails, signals, and activation sources in a TopoGraph |
| `deriveDeclaredTrailActivation(entry)` | Trail-local activation report from a resolved TopoGraph entry |
| `deriveSignalActivationRelations(topoGraph)` | Signal-local activation relations for source and consumer navigation |
| `deriveTopoGraphHash(topoGraph)` | Stable SHA-256 hash of the TopoGraph |
| `deriveTopoGraphDiff(prev, curr)` | Semantic diff with `breaking`, `warning`, and `info` classifications |
| `writeTrailsLock(lock, options?)` | Write root `trails.lock` as a v4 lock envelope |
| `readTrailsLock(options?)` | Read root `trails.lock` as a v4 lock envelope |
| `readTopoGraph(options?)` | Read a TopoGraph from v4 `trails.lock` or legacy `topo.lock` |
| `writeTopoGraph(topoGraph, options?)` | Write legacy `topo.lock` for explicit migration/testing paths |
| `writeLockManifest(manifest, options?)` | Write legacy `trails.lock` as a v3 manifest |
| `readLockManifest(options?)` | Read v3 manifests, projecting v4 locks back to v3 for compatibility |
| `createTopoStore(options?)` | Read-only query interface over the persisted topo state in the Trails state-store `trails.db` |
| `createMockTopoStore(seed?)` | Seeded in-memory mock for tests that need a `ReadOnlyTopoStore` |
| `topoStore` | Read-only `resource()` wrapper around `createTopoStore`, suitable for `resources: [...]` |
| `createTopoSnapshot(topo, options?)` | Persist a new topo snapshot row plus its denormalized projections |
| `listTopoSnapshots(options?)` | List historical topo snapshots (filterable by pinned status) |
| `pinTopoSnapshot(id, name, options?)` / `unpinTopoSnapshot(nameOrId, options?)` | Manage human-named pins |

## Wayfind graph reads

Wayfind remains the product, trail-id, CLI, and MCP brand for graph navigation. The package boundary is Topographer: there is no `@ontrails/wayfinder` compatibility package. Programmatic consumers should import the Wayfind APIs from `@ontrails/topographer`:

```typescript
import {
  loadWayfinderArtifacts,
  wayfindContractTrail,
  wayfindOverviewTrail,
  wayfinderTopo,
} from '@ontrails/topographer';
```

The Wayfind catalog is cold and deterministic. Graph queries read root `trails.lock` and topo-store records; adapter queries read `@ontrails/adapter-kit` package and conformance evidence. They do not boot apps, resolve resources, reach the network, or mutate local state.

| Export | What it does |
| --- | --- |
| `wayfinderTopo` | Internal topo containing the reusable `wayfind.*` graph-read trails |
| `wayfindOverviewTrail` / `wayfindSearchTrail` | Summarize and search saved graph facts |
| `wayfindTrailsTrail` / `wayfindEntitiesTrail` / `wayfindResourcesTrail` / `wayfindSignalsTrail` | List typed graph populations with filters |
| `wayfindSurfacesTrail` / `wayfindTrailheadsTrail` | Inspect saved surface and trailhead membership facts |
| `wayfindVersionsTrail` / `wayfindExamplesTrail` | Inspect saved version and example facts without executing trails |
| `wayfindErrorsTrail` / `wayfindAdaptersTrail` / `wayfindOverlayTrail` | Inspect error facts, adapter evidence, and namespaced overlays |
| `wayfindDescribeTrail` / `wayfindContractTrail` | Inspect one saved entity or trail contract |
| `wayfindNearbyTrail` / `wayfindImpactTrail` | Traverse typed relation edges around saved graph entities |
| `wayfindDiffTrail` | Compare two explicit saved TopoGraph baselines |
| `loadWayfinderArtifacts` | Load lock, TopoGraph, and topo-store evidence with drift status |
| `createWayfinderGraphEntityPredicate` / `filterWayfinderEntityRefs` | Reuse the typed Wayfind entity filter kit |

Wayfind trails are internal by default. Surface hosts expose selected query trails deliberately, usually by exact trail ID for operator tooling. The Trails operator CLI preserves the existing `trails wayfind` grammar, and the operator MCP surface preserves the existing selected direct `wayfind.*` tools.

### Operator File Outline

File outline is an operator capability, not a public Topographer query trail. Use `trails wayfind file <file> --outline` for a compact map of authored trail and app declarations, surface membership, saved graph matches, and diagnostics. Add `--source` when the inspection also needs import, export, and declaration rows. The operator parses the explicit file through `@ontrails/source` and reconciles trail IDs with saved Topographer artifacts. Missing artifacts are diagnostics, not hard failures, so outline remains useful in a fresh checkout or during repair work.

### Backend Support Subpath

Direct shared database helper APIs are public, but they are backend-support APIs rather than root graph contracts. Import them from `@ontrails/topographer/backend-support`:

```typescript
import {
  countPinnedSnapshots,
  countPrunableSnapshots,
  countTopoSnapshots,
  createStoredTopoSnapshot,
  getStoredTopoExport,
  pruneUnpinnedSnapshots,
} from '@ontrails/topographer/backend-support';
```

This subpath owns lower-level snapshot counters, pruning helpers, and direct DB-handle variants for callers that already hold an open `trails.db` handle.

## Breaking change detection

The diff classifies every change by severity:

| Change | Severity |
| --- | --- |
| Trail removed | breaking |
| Required input field added | breaking |
| Input or output field removed | breaking |
| Output field type changed | breaking |
| CLI path changed | breaking |
| Safety property changed | warning |
| Trail deprecated | warning |
| Compositions changed | warning |
| Declared resources changed | warning |
| Resource removed | breaking |
| Trail added | info |
| Resource added | info |
| Optional input field added | info |
| Output field added | info |

Because CLI paths are now full hierarchical command paths, command-tree changes are reflected directly in the semantic diff.

## Drift detection with warden

```typescript
import { deriveTopoGraph, deriveTopoGraphHash, readTrailsLock } from '@ontrails/topographer';

const current = deriveTopoGraphHash(deriveTopoGraph(graph));
const committed = await readTrailsLock();

if (committed?.topoGraphHash !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into `checkDrift()` with CI-friendly reporting.

## Installation

```bash
bun add -d @ontrails/topographer
```
