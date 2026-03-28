# @ontrails/schema

Surface maps, hashing, and semantic diffing for Trails. Generate a machine-readable snapshot of your topo, hash it into a lock file, and detect breaking changes before they ship.

## Usage

```typescript
import { generateSurfaceMap, hashSurfaceMap, diffSurfaceMaps } from '@ontrails/schema';

const map = generateSurfaceMap(app);
const hash = hashSurfaceMap(map);

// Later, after changes:
const newMap = generateSurfaceMap(app);
const diff = diffSurfaceMaps(map, newMap);

if (diff.hasBreaking) {
  console.error('Breaking changes:', diff.breaking);
}
```

The surface map captures every trail's input/output schemas (as JSON Schema), intent and metadata, follow graph, and example counts. The hash goes into `surface.lock` -- a single committed line that CI can check for drift.

## API

| Export | What it does |
| --- | --- |
| `generateSurfaceMap(topo)` | Deterministic manifest of every trail, sorted by ID |
| `hashSurfaceMap(map)` | SHA-256 hash, excluding timestamps for stability |
| `diffSurfaceMaps(prev, curr)` | Semantic diff with breaking/warning/info severity |
| `writeSurfaceMap(map, options?)` | Write `.trails/_surface.json` (gitignored detail file) |
| `readSurfaceMap(options?)` | Read it back |
| `writeSurfaceLock(hash, options?)` | Write `surface.lock` (committed, single hash line) |
| `readSurfaceLock(options?)` | Read the lock hash |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Breaking change detection

The diff classifies every change by severity:

| Change | Severity |
| --- | --- |
| Trail removed | breaking |
| Required input field added | breaking |
| Input/output field removed | breaking |
| Output field type changed | breaking |
| Safety property changed | warning |
| Trail deprecated | warning |
| Follow changed | warning |
| Trail added | info |
| Optional input field added | info |
| Output field added | info |

## Drift detection with warden

```typescript
import { generateSurfaceMap, hashSurfaceMap, readSurfaceLock } from '@ontrails/schema';

const current = hashSurfaceMap(generateSurfaceMap(app));
const committed = await readSurfaceLock();

if (committed !== current) {
  // surface.lock is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into a `checkDrift()` call with CI integration.

## Installation

```bash
bun add -d @ontrails/schema
```
