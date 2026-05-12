# @ontrails/topographer

Durable graph substrate for Trails: deterministic TopoGraphs, lockfile helpers, and semantic diffing.

Most applications reach this package through `trails topo compile` and `trails topo verify`. Those CLI trails layer workspace and topo-store behavior on top of the building blocks in `@ontrails/topographer`.

## What it owns

- deterministic TopoGraph generation from an established topo
- structured example and field-override provenance projection for TopoGraph entries
- stable hashing for CI drift detection
- semantic diffing between two TopoGraphs
- file I/O helpers for `.trails/topo.lock` and `.trails/trails.lock`
- the topo-store: queryable persistence of the resolved topo graph in the shared
  `trails.db` at `.trails/state/trails.db`, including snapshots, pinning,
  history, and read-only query accessors (relocated from `@ontrails/core` per
  ADR-0042)

`@ontrails/topographer` is the durable graph substrate for Trails. Generic `trails-db` plumbing (read/write SQLite handles, subsystem schema management, derived paths) stays in `@ontrails/core` so other subsystems (tracing, signals) can share it without depending on topographer.

## Usage

```typescript
import {
  deriveTopoGraph,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  writeLockManifest,
  writeTopoGraph,
} from '@ontrails/topographer';

const topoGraph = deriveTopoGraph(graph);
const hash = deriveTopoGraphHash(topoGraph);

await writeTopoGraph(topoGraph);
await writeLockManifest({
  artifacts: [{ path: 'topo.lock', role: 'topo', sha256: hash }],
  scope: { app: 'demo' },
  summary: { contours: 0, resources: 0, signals: 0, trails: 1 },
  version: 3,
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

The typical exported artifact pair is:

- `.trails/topo.lock` — serialized TopoGraph, useful for inspection and diffing
- `.trails/trails.lock` — compact v3 manifest that verifies the TopoGraph by hash

`trails topo compile` writes both from the current topo. `trails topo verify` and `@ontrails/warden` use the lockfile helpers here to detect drift.

## API

| Export | What it does |
| --- | --- |
| `deriveTopoGraph(topo)` | Deterministic TopoGraph of every established trail, signal, resource, and contour |
| `deriveTopoGraphHash(topoGraph)` | Stable SHA-256 hash of the TopoGraph |
| `deriveTopoGraphDiff(prev, curr)` | Semantic diff with `breaking`, `warning`, and `info` classifications |
| `writeTopoGraph(topoGraph, options?)` | Write `.trails/topo.lock` |
| `readTopoGraph(options?)` | Read `.trails/topo.lock` |
| `writeLockManifest(manifest, options?)` | Write `.trails/trails.lock` as a v3 manifest |
| `readLockManifest(options?)` | Read the v3 manifest from `.trails/trails.lock` |
| `createTopoStore(options?)` | Read-only query interface over the persisted topo state in `.trails/state/trails.db` |
| `createMockTopoStore(seed?)` | Seeded in-memory mock for tests that need a `ReadOnlyTopoStore` |
| `topoStore` | Read-only `resource()` wrapper around `createTopoStore`, suitable for `resources: [...]` |
| `createTopoSnapshot(topo, options?)` | Persist a new topo snapshot row plus its denormalized projections |
| `listTopoSnapshots(options?)` | List historical topo snapshots (filterable by pinned status) |
| `pinTopoSnapshot(id, name, options?)` / `unpinTopoSnapshot(nameOrId, options?)` | Manage human-named pins |

### Backend Support Subpath

Direct shared database helper APIs are public, but they are backend-support APIs
rather than root graph contracts. Import them from
`@ontrails/topographer/backend-support`:

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

This subpath owns lower-level snapshot counters, pruning helpers, and direct
DB-handle variants for callers that already hold an open `trails.db` handle.

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
| Crosses changed | warning |
| Declared resources changed | warning |
| Resource removed | breaking |
| Trail added | info |
| Resource added | info |
| Optional input field added | info |
| Output field added | info |

Because CLI paths are now full hierarchical command paths, command-tree changes are reflected directly in the semantic diff.

## Drift detection with warden

```typescript
import { deriveTopoGraph, deriveTopoGraphHash, readLockManifest } from '@ontrails/topographer';

const current = deriveTopoGraphHash(deriveTopoGraph(graph));
const committed = await readLockManifest();
const topoArtifact = committed?.artifacts.find((artifact) => artifact.role === 'topo');

if (topoArtifact?.sha256 !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into `checkDrift()` with CI-friendly reporting.

## Installation

```bash
bun add -d @ontrails/topographer
```
