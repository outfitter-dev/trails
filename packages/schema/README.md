# @ontrails/schema

Deterministic trailhead maps, lockfile helpers, and semantic diffing for Trails.

Most applications reach this package through `trails topo export` and `trails topo verify`. Those CLI trails layer workspace and topo-store behavior on top of the low-level building blocks in `@ontrails/schema`.

## What it owns

- deterministic trailhead-map generation from an established topo
- stable hashing for CI drift detection
- semantic diffing between two trailhead maps
- file I/O helpers for `.trails/_trailhead.json` and `.trails/trails.lock`
- OpenAPI generation from the same topo contract

The package does not own topo history, pins, or `trails.db`. Those higher-level workflows live in the `trails` app and `@ontrails/core`. `@ontrails/schema` stays focused on serializable artifacts and diffing.

## Usage

```typescript
import {
  deriveOpenApiSpec,
  deriveSurfaceMap,
  deriveSurfaceMapDiff,
  deriveSurfaceMapHash,
  writeTrailheadLock,
  writeTrailheadMap,
} from '@ontrails/schema';

const map = deriveSurfaceMap(app);
const hash = deriveSurfaceMapHash(map);

await writeTrailheadMap(map);
await writeTrailheadLock({ hash });

// Later, after changes:
const nextMap = deriveSurfaceMap(app);
const diff = deriveSurfaceMapDiff(map, nextMap);

if (diff.hasBreaking) {
  console.error('Breaking changes:', diff.breaking);
}

const openApi = deriveOpenApiSpec(app);
```

`deriveSurfaceMap()` rejects draft-contaminated topos. Only established state can be serialized into the committed artifacts.

## File outputs

The typical exported artifact pair is:

- `.trails/_trailhead.json` — detailed derived map, useful for inspection and diffing
- `.trails/trails.lock` — committed lock artifact, stored as structured JSON or legacy hash-only text

`trails topo export` writes both from the current topo. `trails topo verify` and `@ontrails/warden` use the lockfile helpers here to detect drift.

## API

| Export | What it does |
| --- | --- |
| `deriveSurfaceMap(topo)` | Deterministic trailhead map of every established trail, signal, and resource |
| `deriveSurfaceMapHash(map)` | Stable SHA-256 hash of the map |
| `deriveSurfaceMapDiff(prev, curr)` | Semantic diff with `breaking`, `warning`, and `info` classifications |
| `writeTrailheadMap(map, options?)` | Write `.trails/_trailhead.json` |
| `readTrailheadMap(options?)` | Read `.trails/_trailhead.json` |
| `writeTrailheadLock(lock, options?)` | Write `.trails/trails.lock` as either structured JSON or legacy hash text |
| `readTrailheadLockData(options?)` | Read the full normalized lock payload from `.trails/trails.lock` |
| `readTrailheadLock(options?)` | Read just the committed lock hash |
| `deriveOpenApiSpec(topo, options?)` | Generate an OpenAPI 3.1 document from the topo |

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
import { deriveSurfaceMap, deriveSurfaceMapHash, readTrailheadLock } from '@ontrails/schema';

const current = deriveSurfaceMapHash(deriveSurfaceMap(app));
const committed = await readTrailheadLock();

if (committed !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into `checkDrift()` with CI-friendly reporting.

## Installation

```bash
bun add -d @ontrails/schema
```
