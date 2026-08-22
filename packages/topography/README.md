# @ontrails/topography

Topography is the durable graph substrate for Trails: deterministic TopoGraphs, lockfile helpers, semantic diffing, topo-store persistence, and Wayfind graph-read APIs.

Most applications reach this package through top-level `trails compile`, `trails validate`, and `trails diff`. Those CLI trails layer workspace and topo-store behavior on top of the building blocks in `@ontrails/topography`. The package itself ships library entry points, not a separate CLI binary, and retired `trails topo compile`, `trails topo verify`, and `trails topo check` forms are not aliases.

## Why this package earns a README

[ADR-0042](../../docs/adr/0042-core-topography-boundary-doctrine.md) draws the boundary by lifecycle: core owns the in-process graph, while Topography owns durable graph artifacts that cross process boundaries or compare state across time. That boundary is easy to blur because the same authored topo feeds both runtime execution and saved evidence, so this README keeps the package's job explicit.

The four-role story is:

- author with core;
- resolve to the topography;
- render with surfaces;
- govern with Warden.

This is not a private helper package. The Trails operator app consumes Topography for compile, validate, run, survey, topo history, and Wayfind support. `@ontrails/warden` consumes it for drift detection and topo-aware governance rules. `apps/trails-demo` consumes it as the example app's governance proof. Regrade's contract suite also derives TopoGraph evidence through it. Those independent consumers make the package boundary worth documenting directly.

## What it owns

- deterministic TopoGraph generation from an established topo
- deterministic app-partitioned workspace views from Config-owned app identity
  and app-local locks, with completeness, binding, freshness, collection-edge,
  and unowned-lock evidence kept outside the canonical hash
- structured example and field-override provenance derivation for TopoGraph entries
- stable hashing for CI drift detection
- semantic diffing between two TopoGraphs
- file I/O helpers for root `trails.lock` plus legacy artifact-family readers
- the topo-store: queryable persistence of the resolved topo graph in the shared
  `trails.db` in the per-user Trails state store, including snapshots, pinning,
  history, and read-only query accessors (relocated from `@ontrails/core` per
  ADR-0042)
- Wayfind graph-read trails and helpers over saved Topography artifacts,
  including artifact loading, provenance envelopes, typed entity filters,
  relation traversal, error facts, adapter facts, and explicit graph diffs

`@ontrails/topography` is the durable graph substrate for Trails. Generic `trails-db` plumbing (read/write SQLite handles, subsystem schema management, derived paths) stays in `@ontrails/core` so other subsystems (tracing, signals) can share it without depending on Topography.

## Usage

```typescript
import {
  deriveTopoGraph,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  writeTrailsLock,
} from '@ontrails/topography';

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

Configured workspaces name apps through `@ontrails/config`. Topography consumes that static identity and reads exactly those app-root locks; its bounded lock census supplies coaching evidence but never discovers additional app identity:

```typescript
import { readTrailsProjectIdentity } from '@ontrails/config';
import { deriveWorkspaceView } from '@ontrails/topography';

const projectRoot = process.cwd();
const identity = await readTrailsProjectIdentity({
  boundaryDir: projectRoot,
  startDir: projectRoot,
});
const view = await deriveWorkspaceView({ identity });

if (view.evidence.configuredCompleteness === 'partial') {
  console.error(view.evidence.apps);
}
for (const unowned of view.evidence.unownedLocks) {
  console.warn(unowned.path, unowned.coaching);
}
```

`workspaceViewHash` exists only for a complete, correctly bound configured app set. It hashes the schema version, sorted app IDs and project-relative roots, app graph hashes, and collision facts. Selected scope, absolute checkout location, lock paths, freshness, collection skips, and unowned-lock evidence do not affect it. Passing `currentAppGraphHashes` proves `fresh` or `stale` state; without live evidence, saved graphs report freshness as `unknown`.

`deriveTopoGraph()` rejects draft-contaminated topos. Only established state can be serialized into the committed artifacts.

## File outputs

The normal exported artifact is:

- `trails.lock` — committed resolved truth at the root of one lock-owning app.
  It embeds the serialized TopoGraph plus the hash and summary needed for drift
  detection. A configured workspace has one such file per configured app and no
  workspace-root aggregate lock, unless the root itself is a configured app.

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
| `deriveWorkspaceView(options)` | Config-fed app-partitioned saved graph view with separate observation evidence |
| `deriveTopoGraphDiff(prev, curr)` | Semantic diff with `breaking`, `warning`, and `info` classifications |
| `writeTrailsLock(lock, options?)` | Write an app-root `trails.lock` envelope |
| `readTrailsLock(options?)` | Read an app-root `trails.lock` envelope |
| `readTopoGraph(options?)` | Read a TopoGraph from v4 `trails.lock` or legacy `topo.lock` |
| `writeTopoGraph(topoGraph, options?)` | Write legacy `topo.lock` for explicit migration/testing paths |
| `writeLockManifest(manifest, options?)` | Write legacy `trails.lock` as a v3 manifest |
| `readLockManifest(options?)` | Read v3 manifests, deriving v4 locks back to v3 for compatibility |
| `createTopoStore(options?)` | Read-only query interface over the persisted topo state in the Trails state-store `trails.db` |
| `createMockTopoStore(seed?)` | Seeded in-memory mock for tests that need a `ReadOnlyTopoStore` |
| `topoStore` | Read-only `resource()` wrapper around `createTopoStore`, suitable for `resources: [...]` |
| `createTopoSnapshot(topo, options?)` | Persist a new topo snapshot row plus its denormalized derived facts |
| `listTopoSnapshots(options?)` | List historical topo snapshots (filterable by pinned status) |
| `pinTopoSnapshot(id, name, options?)` / `unpinTopoSnapshot(nameOrId, options?)` | Manage human-named pins |

## Wayfind graph reads

Wayfind remains the product, trail-id, CLI, and MCP brand for graph navigation. The package boundary is Topography: there is no `@ontrails/wayfinder` compatibility package. Programmatic consumers should import the Wayfind APIs from `@ontrails/topography`:

```typescript
import {
  loadWayfinderArtifacts,
  wayfindContractTrail,
  wayfindOverviewTrail,
  wayfinderTopo,
} from '@ontrails/topography';
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
| `wayfindDiffTrail` | Compare two explicit saved TopoGraph baselines as a low-level artifact query |
| `loadWayfinderArtifacts` | Load lock, TopoGraph, and topo-store evidence with drift status |
| `createWayfinderGraphEntityPredicate` / `filterWayfinderEntityRefs` | Reuse the typed Wayfind entity filter kit |

Wayfind trails are internal by default. Surface hosts expose selected query trails deliberately, usually by exact trail ID for operator tooling. The Trails operator CLI preserves the existing `trails wayfind` grammar and adds Config-owned project/app selection around saved navigation and semantic diff. Topography continues to own artifact loading, app-partitioned workspace derivation, and graph comparison; it does not interpret `--app`. The operator MCP surface preserves the selected direct `wayfind.*` tools through that same project-aware command boundary.

### Operator File Outline

File outline is an operator capability, not a public Topography query trail. Use `trails wayfind file <file> --outline` for a compact map of authored trail and app declarations, surface membership, saved graph matches, and diagnostics. Add `--source` when the inspection also needs import, export, and declaration rows. The operator parses the explicit file through `@ontrails/source` and reconciles trail IDs with saved Topography artifacts. Missing artifacts are diagnostics, not hard failures, so outline remains useful in a fresh checkout or during repair work.

### Backend Support Subpath

Direct shared database helper APIs are public, but they are backend-support APIs rather than root graph contracts. Import them from `@ontrails/topography/backend-support`:

```typescript
import {
  countPinnedSnapshots,
  countPrunableSnapshots,
  countTopoSnapshots,
  createStoredTopoSnapshot,
  getStoredTopoExport,
  pruneUnpinnedSnapshots,
} from '@ontrails/topography/backend-support';
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
import { deriveTopoGraph, deriveTopoGraphHash, readTrailsLock } from '@ontrails/topography';

const current = deriveTopoGraphHash(deriveTopoGraph(graph));
const committed = await readTrailsLock();

if (committed?.topoGraphHash !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into `checkDrift()` with CI-friendly reporting.

## Installation

```bash
bun add -d @ontrails/topography
```
