# Stage 07 — @ontrails/schema

> Surface maps, diffing, and lock files. The machine-readable contract for CI and governance.

---

## Overview

`@ontrails/schema` generates a deterministic, machine-readable manifest of every trail in the topo -- the **surface map**. It hashes the surface map into a single-line `surface.lock` for content-addressed drift detection. It diffs surface maps semantically (trails added/modified/removed) instead of producing raw JSON diffs.

Warden consumes this package for drift detection. The `trails survey` CLI command consumes it for `--diff` comparisons. CI uses `surface.lock` to gate pushes.

---

## Prerequisites

- **Stage 01 complete** -- `@ontrails/core` ships `trail()`, `hike()`, `event()`, `topo()`, `Topo` type, `zodToJsonSchema()`.
- The `Topo` type must expose all trail specs including their `input`/`output` schemas, `surfaces`, markers (`readOnly`, `destructive`, `idempotent`), `follows`, `detours`, `examples`, and `deprecated`/`replacedBy` fields.

---

## Implementation Guide

### Package Setup

```text
packages/schema/
  package.json
  tsconfig.json
  src/
    index.ts                # Public API
    generate.ts             # generateSurfaceMap
    hash.ts                 # hashSurfaceMap
    diff.ts                 # diffSurfaceMaps
    io.ts                   # File I/O (read/write)
    types.ts                # SurfaceMap, SurfaceMapEntry, DiffResult, etc.
    __tests__/
      generate.test.ts
      hash.test.ts
      diff.test.ts
      io.test.ts
```

**package.json:**

```json
{
  "name": "@ontrails/schema",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "@ontrails/core": "workspace:*"
  }
}
```

### `generateSurfaceMap(topo)` -- Create the Manifest

```typescript
export interface SurfaceMapEntry {
  readonly id: string;
  readonly kind: 'trail' | 'route' | 'event';
  readonly surfaces: readonly string[];
  readonly input?: JsonSchema;
  readonly output?: JsonSchema;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly deprecated?: boolean;
  readonly replacedBy?: string;
  readonly follows?: readonly string[];
  readonly detours?: Record<string, readonly string[]>;
  readonly exampleCount: number;
  readonly description?: string;
}

export interface SurfaceMap {
  readonly version: string;
  readonly generatedAt: string;
  readonly entries: readonly SurfaceMapEntry[];
}

export function generateSurfaceMap(topo: Topo): SurfaceMap;
```

**Determinism requirements:**

- Entries sorted alphabetically by `id`.
- JSON schema output from `zodToJsonSchema()` is deterministic (no random keys, no timestamps).
- `generatedAt` is included in the full surface map file but excluded from the hash computation (see below).
- Object keys within each entry are sorted lexicographically.

**Implementation:**

1. Iterate all trails in the topo (sorted by `id`).
2. For each trail, build a `SurfaceMapEntry`:
   - Convert `input` and `output` Zod schemas to JSON Schema via `zodToJsonSchema()` from `@ontrails/core`.
   - Count examples (`exampleCount` instead of including example data -- keeps the map compact).
   - Include safety markers, follows, detours, deprecation info.
3. Return the complete `SurfaceMap` with a version identifier (e.g., `"1.0"`) and timestamp.

### `hashSurfaceMap(surfaceMap)` -- SHA-256 for `surface.lock`

```typescript
export function hashSurfaceMap(surfaceMap: SurfaceMap): string;
```

Produces a deterministic SHA-256 hash of the surface map content:

1. Create a copy of the surface map without the `generatedAt` field (timestamps would cause hash changes on every generation).
2. Serialize to JSON with sorted keys (`JSON.stringify` with a replacer that sorts keys, or use a canonical JSON serialization).
3. Compute SHA-256 using `Bun.hash()` or `crypto.createHash("sha256")`.
4. Return the hex-encoded hash string.

**Determinism is critical.** The same topo must produce the same hash byte-for-byte. This means:

- No floating-point instability in JSON serialization.
- No insertion-order dependence in object keys.
- No timestamps or random values in the hash input.

### `diffSurfaceMaps(prev, curr)` -- Semantic Diffing

```typescript
export interface DiffEntry {
  readonly id: string;
  readonly kind: 'trail' | 'route' | 'event';
  readonly change: 'added' | 'removed' | 'modified';
  readonly severity: 'info' | 'warning' | 'breaking';
  readonly details: readonly string[];
}

export interface DiffResult {
  readonly entries: readonly DiffEntry[];
  readonly breaking: readonly DiffEntry[];
  readonly warnings: readonly DiffEntry[];
  readonly info: readonly DiffEntry[];
  readonly hasBreaking: boolean;
}

export function diffSurfaceMaps(prev: SurfaceMap, curr: SurfaceMap): DiffResult;
```

**Diff logic:**

1. **Added trails** -- IDs in `curr` but not in `prev`. Severity: `info`.
2. **Removed trails** -- IDs in `prev` but not in `curr`. Severity: `breaking`.
3. **Modified trails** -- IDs in both, with differences. Per-field diff:

| Field Change | Severity | Detail Message |
| --- | --- | --- |
| Required input field added | `breaking` | `Required input field "type" added` |
| Optional input field added | `info` | `Optional input field "filter" added` |
| Input field removed | `breaking` | `Input field "name" removed` |
| Output field added | `info` | `Output field "createdAt" added` |
| Output field removed | `breaking` | `Output field "id" removed` |
| Output field type changed | `breaking` | `Output field "count" type changed: number -> string` |
| Surface added | `info` | `Surface "mcp" added` |
| Surface removed | `breaking` | `Surface "cli" removed` |
| Safety marker changed | `warning` | `readOnly changed: true -> false` |
| Description changed | `info` | `Description updated` |
| Deprecated added | `warning` | `Deprecated (replaced by entity.show)` |
| Follows changed | `warning` | `Follows changed: added "search", removed "lookup"` |

**Schema comparison** for input/output fields uses JSON Schema diffing:

- Compare the `properties` objects in the JSON schemas.
- Check `required` arrays for additions/removals.
- Compare `type` fields for type changes.
- Deep comparison for nested objects.

### Surface Map File I/O

#### `writeSurfaceMap(surfaceMap, options?)`

```typescript
export interface WriteOptions {
  /** Directory to write to. Defaults to ".trails/" */
  readonly dir?: string;
}

export async function writeSurfaceMap(
  surfaceMap: SurfaceMap,
  options?: WriteOptions
): Promise<string>;
```

Writes the full surface map to `<dir>/_surface.json` (gitignored detail file). Returns the file path.

**The `_surface.json` file is gitignored.** It's a build artifact for local inspection, not committed.

#### `readSurfaceMap(options?)`

```typescript
export async function readSurfaceMap(options?: {
  dir?: string;
}): Promise<SurfaceMap | null>;
```

Reads `_surface.json` from the specified directory. Returns `null` if the file doesn't exist.

#### `writeSurfaceLock(hash, options?)`

```typescript
export async function writeSurfaceLock(
  hash: string,
  options?: { dir?: string }
): Promise<string>;
```

Writes the hash to `<dir>/surface.lock` as a single line. Returns the file path.

**The `surface.lock` file is committed.** It's the source of truth for contract drift detection.

#### `readSurfaceLock(options?)`

```typescript
export async function readSurfaceLock(options?: {
  dir?: string;
}): Promise<string | null>;
```

Reads `surface.lock` and returns the hash string. Returns `null` if the file doesn't exist.

### Integration with Warden (Drift Detection)

Warden calls `@ontrails/schema` to detect drift:

```typescript
import {
  generateSurfaceMap,
  hashSurfaceMap,
  readSurfaceLock,
} from '@ontrails/schema';

const surfaceMap = generateSurfaceMap(app.topo);
const currentHash = hashSurfaceMap(surfaceMap);
const committedHash = await readSurfaceLock();

if (committedHash !== currentHash) {
  // Drift detected -- surface.lock is stale
}
```

### Integration with CI

CI verifies `surface.lock` on every push:

```bash
# Generate fresh surface map and compare hash
trails survey generate   # writes _surface.json + surface.lock
git diff --exit-code surface.lock  # fail if surface.lock changed
```

Or, using the `trails warden --exit-code` command which includes drift detection.

**Self-healing (optional):** On hash mismatch, CI can regenerate `surface.lock`, commit it, and push. Single attempt, aborts if other files are dirty.

### Package Exports Summary

```typescript
// Generation
export { generateSurfaceMap } from './generate.js';
export { hashSurfaceMap } from './hash.js';
export { diffSurfaceMaps } from './diff.js';

// File I/O
export {
  writeSurfaceMap,
  readSurfaceMap,
  writeSurfaceLock,
  readSurfaceLock,
} from './io.js';

// Types
export type {
  SurfaceMap,
  SurfaceMapEntry,
  DiffEntry,
  DiffResult,
} from './types.js';
```

---

## Testing Requirements

### `generate.test.ts`

- `generateSurfaceMap` produces entries for all trails in the topo.
- Entries are sorted alphabetically by id.
- Trail with input/output schemas produces valid JSON Schema entries.
- Trail without output schema has `output: undefined`.
- Safety markers (readOnly, destructive, idempotent) are included when set.
- `exampleCount` reflects the number of examples on the trail.
- Route entries include `follows` array.
- Entries with `deprecated: true` include `replacedBy` when set.
- Determinism: calling `generateSurfaceMap` twice with the same topo produces identical output.

### `hash.test.ts`

- `hashSurfaceMap` produces a valid SHA-256 hex string (64 characters).
- Same surface map -> same hash (deterministic).
- Different surface maps -> different hashes.
- `generatedAt` field does not affect the hash (two maps differing only in timestamp produce the same hash).
- Hash is stable across runs (no floating-point or key-order instability).

### `diff.test.ts`

- Added trail detected and classified as `info`.
- Removed trail detected and classified as `breaking`.
- Required input field added classified as `breaking`.
- Optional input field added classified as `info`.
- Output field removed classified as `breaking`.
- Output field type changed classified as `breaking`.
- Surface removed classified as `breaking`.
- Safety marker changed classified as `warning`.
- Description change classified as `info`.
- Deprecation added classified as `warning`.
- `DiffResult.hasBreaking` is true when any breaking entries exist.
- `DiffResult.breaking`, `warnings`, `info` arrays are correctly partitioned.
- Empty diff (identical maps) produces no entries.

### `io.test.ts`

- `writeSurfaceMap` writes valid JSON to `_surface.json`.
- `readSurfaceMap` reads it back and produces identical data.
- `readSurfaceMap` returns `null` for missing file.
- `writeSurfaceLock` writes a single line with the hash.
- `readSurfaceLock` reads the hash back.
- `readSurfaceLock` returns `null` for missing file.
- Default directory is `.trails/`.
- Custom directory option works.

---

## Definition of Done

- [ ] `generateSurfaceMap(topo)` produces a deterministic, complete manifest of all trails.
- [ ] `hashSurfaceMap(surfaceMap)` produces a stable SHA-256 hash, ignoring `generatedAt`.
- [ ] `diffSurfaceMaps(prev, curr)` performs semantic diffing with correct severity classification.
- [ ] Breaking change detection covers: trail removal, required input addition, output field removal, output type change, surface removal.
- [ ] File I/O functions read and write `_surface.json` and `surface.lock` correctly.
- [ ] `_surface.json` is gitignored; `surface.lock` is committed.
- [ ] Determinism verified: same topo -> same map -> same hash, every time.
- [ ] All tests pass.
- [ ] Package exports are clean -- no internal types leak.
