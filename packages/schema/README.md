# @ontrails/schema

Surface maps, diffing, and lock files for Trails. The machine-readable contract for CI and governance.

## Installation

```bash
bun add -d @ontrails/schema
```

Peer dependencies: `@ontrails/core`, `zod`.

## Quick Start

```typescript
import {
  generateSurfaceMap,
  hashSurfaceMap,
  diffSurfaceMaps,
} from '@ontrails/schema';

// Generate the surface map from the topo
const surfaceMap = generateSurfaceMap(app);

// Hash it for the lock file
const hash = hashSurfaceMap(surfaceMap);

// Diff two surface maps
const diff = diffSurfaceMaps(previousMap, surfaceMap);
if (diff.hasBreaking) {
  console.error('Breaking changes detected:', diff.breaking);
}
```

## API Overview

### `generateSurfaceMap(topo)`

Produces a deterministic manifest of every trail in the topo. Entries are sorted alphabetically by ID. Input and output schemas are converted to JSON Schema via `zodToJsonSchema()`.

```typescript
const map = generateSurfaceMap(app);
// {
//   version: "1.0",
//   generatedAt: "2026-03-25T10:00:00.000Z",
//   entries: [
//     { id: "entity.show", kind: "trail", input: {...}, readOnly: true, exampleCount: 2 },
//     { id: "search", kind: "trail", input: {...}, exampleCount: 1 },
//   ]
// }
```

Each `SurfaceMapEntry` includes:

- `id`, `kind` (`"trail"` | `"hike"` | `"event"`)
- `input` and `output` as JSON Schema
- Safety markers: `readOnly`, `destructive`, `idempotent`
- `deprecated`, `replacedBy`
- `follows` (for hikes), `detours`
- `exampleCount`, `description`

### `hashSurfaceMap(surfaceMap)`

SHA-256 hash of the surface map content. Excludes `generatedAt` so the same topo always produces the same hash byte-for-byte.

```typescript
const hash = hashSurfaceMap(map); // "a1b2c3d4..."
```

### `diffSurfaceMaps(prev, curr)`

Semantic diff between two surface maps. Classifies every change by severity instead of producing raw JSON diffs.

```typescript
const diff = diffSurfaceMaps(previousMap, currentMap);

diff.entries; // All changes
diff.breaking; // Breaking changes only
diff.warnings; // Warnings only
diff.info; // Informational changes
diff.hasBreaking; // Quick check
```

**Breaking change detection:**

| Change                     | Severity |
| -------------------------- | -------- |
| Trail removed              | breaking |
| Required input field added | breaking |
| Input field removed        | breaking |
| Output field removed       | breaking |
| Output field type changed  | breaking |
| Surface removed            | breaking |
| Safety marker changed      | warning  |
| Trail deprecated           | warning  |
| Follows changed            | warning  |
| Trail added                | info     |
| Optional input field added | info     |
| Output field added         | info     |
| Surface added              | info     |

### Lock File I/O

```typescript
import {
  writeSurfaceMap, // .trails/_surface.json (gitignored detail file)
  readSurfaceMap, // Read it back
  writeSurfaceLock, // surface.lock (committed, single hash line)
  readSurfaceLock, // Read the lock hash
} from '@ontrails/schema';
```

Default directory: `.trails/`. Override with `{ dir: "./custom" }`.

- `_surface.json` -- Full surface map, gitignored. For local inspection and debugging.
- `surface.lock` -- Single-line SHA-256 hash, committed to the repo. Source of truth for drift detection.

## Usage with Warden

```typescript
import {
  generateSurfaceMap,
  hashSurfaceMap,
  readSurfaceLock,
} from '@ontrails/schema';

const map = generateSurfaceMap(app);
const current = hashSurfaceMap(map);
const committed = await readSurfaceLock();

if (committed !== current) {
  // surface.lock is stale -- topo has changed
}
```

## Further Reading

- [Architecture](../../docs/architecture.md)
- [Testing Guide](../../docs/testing.md)
