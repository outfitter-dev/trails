# @ontrails/schema

Deterministic surface maps, lockfile helpers, and semantic diffing for Trails.

Most applications reach this package through `trails topo export` and `trails topo verify`. Those CLI trails layer workspace and topo-store behavior on top of the low-level building blocks in `@ontrails/schema`.

## What it owns

- deterministic surface-map generation from an established topo
- structured example and field-override provenance projection for surface-map entries
- stable hashing for CI drift detection
- semantic diffing between two surface maps
- file I/O helpers for `.trails/_surface.json` and `.trails/trails.lock`

The package does not own topo history, pins, or `trails.db`. Those higher-level workflows live in the `trails` app and `@ontrails/core`. `@ontrails/schema` stays focused on serializable artifacts and diffing.

## Usage

```typescript
import {
  deriveSurfaceMap,
  deriveSurfaceMapDiff,
  deriveSurfaceMapHash,
  writeSurfaceLock,
  writeSurfaceMap,
} from '@ontrails/schema';

const map = deriveSurfaceMap(graph);
const hash = deriveSurfaceMapHash(map);

await writeSurfaceMap(map);
await writeSurfaceLock({ hash });

// Later, after changes:
const nextMap = deriveSurfaceMap(graph);
const diff = deriveSurfaceMapDiff(map, nextMap);

if (diff.hasBreaking) {
  console.error('Breaking changes:', diff.breaking);
}
```

`deriveSurfaceMap()` rejects draft-contaminated topos. Only established state can be serialized into the committed artifacts.

## File outputs

The typical exported artifact pair is:

- `.trails/_surface.json` — detailed derived map, useful for inspection and diffing
- `.trails/trails.lock` — committed lock artifact, stored as structured JSON or legacy hash-only text

`trails topo export` writes both from the current topo. `trails topo verify` and `@ontrails/warden` use the lockfile helpers here to detect drift.

## API

| Export | What it does |
| --- | --- |
| `deriveSurfaceMap(topo)` | Deterministic surface map of every established trail, signal, and resource |
| `deriveSurfaceMapHash(map)` | Stable SHA-256 hash of the map |
| `deriveSurfaceMapDiff(prev, curr)` | Semantic diff with `breaking`, `warning`, and `info` classifications |
| `writeSurfaceMap(map, options?)` | Write `.trails/_surface.json` |
| `readSurfaceMap(options?)` | Read `.trails/_surface.json` |
| `writeSurfaceLock(lock, options?)` | Write `.trails/trails.lock` as either structured JSON or legacy hash text |
| `readSurfaceLockData(options?)` | Read the full normalized lock payload from `.trails/trails.lock` |
| `readSurfaceLock(options?)` | Read just the committed lock hash |

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
import { deriveSurfaceMap, deriveSurfaceMapHash, readSurfaceLock } from '@ontrails/schema';

const current = deriveSurfaceMapHash(deriveSurfaceMap(graph));
const committed = await readSurfaceLock();

if (committed !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into `checkDrift()` with CI-friendly reporting.

## Installation

```bash
bun add -d @ontrails/schema
```
