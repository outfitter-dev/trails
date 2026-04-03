# @ontrails/schema

Trailhead maps, hashing, and semantic diffing for Trails. Generate a machine-readable snapshot of your topo, hash it into a lock file, and detect breaking changes before they ship.

## Usage

```typescript
import { generateTrailheadMap, hashTrailheadMap, diffTrailheadMaps } from '@ontrails/schema';

const map = generateTrailheadMap(app);
const hash = hashTrailheadMap(map);

// Later, after changes:
const newMap = generateTrailheadMap(app);
const diff = diffTrailheadMaps(map, newMap);

if (diff.hasBreaking) {
  console.error('Breaking changes:', diff.breaking);
}
```

The trailhead map captures every trail's input/output schemas (as JSON Schema), intent and metadata, CLI path projection, crossing graph, declared provisions, example counts, and the registered provision inventory. The hash goes into the committed lock file -- a single line that CI can check for drift.

## API

| Export | What it does |
| --- | --- |
| `generateTrailheadMap(topo)` | Deterministic trailhead map of every trail, sorted by ID |
| `hashTrailheadMap(map)` | SHA-256 hash, excluding timestamps for stability |
| `diffTrailheadMaps(prev, curr)` | Semantic diff with breaking/warning/info severity |
| `writeTrailheadMap(map, options?)` | Write `.trails/_trailhead.json` (gitignored detail file) |
| `readTrailheadMap(options?)` | Read it back |
| `writeTrailheadLock(hash, options?)` | Write the committed lock file (single hash line) |
| `readTrailheadLock(options?)` | Read the lock hash |

See the [API Reference](../../docs/api-reference.md) for the full list.

## Breaking change detection

The diff classifies every change by severity:

| Change | Severity |
| --- | --- |
| Trail removed | breaking |
| Required input field added | breaking |
| Input/output field removed | breaking |
| Output field type changed | breaking |
| CLI path changed | breaking |
| Safety property changed | warning |
| Trail deprecated | warning |
| Crosses changed | warning |
| Declared provisions changed | warning |
| Provision removed | breaking |
| Trail added | info |
| Provision added | info |
| Optional input field added | info |
| Output field added | info |

## Drift detection with warden

```typescript
import { generateTrailheadMap, hashTrailheadMap, readTrailheadLock } from '@ontrails/schema';

const current = hashTrailheadMap(generateTrailheadMap(app));
const committed = await readTrailheadLock();

if (committed !== current) {
  // lock file is stale -- topo has changed
}
```

The `@ontrails/warden` package wraps this into a `checkDrift()` call with CI integration.

## Installation

```bash
bun add -d @ontrails/schema
```
