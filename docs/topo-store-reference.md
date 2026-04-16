# Topo Store Reference

Schema definitions, query patterns, and programmatic API for the topo store. For the user-facing operations guide, see [Topo Store](./topo-store.md).

## SQLite Schema

### `topo_snapshots`

Every topo snapshot. Pinned snapshots have a non-null `pinned_as` name.

```sql
CREATE TABLE topo_snapshots (
  id TEXT PRIMARY KEY,
  git_sha TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  trail_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  pinned_as TEXT,
  created_at TEXT NOT NULL
);
```

### `topo_trails`

Trail definitions for each snapshot.

```sql
CREATE TABLE topo_trails (
  id TEXT NOT NULL,
  intent TEXT,
  idempotent INTEGER NOT NULL DEFAULT 0,
  has_output INTEGER NOT NULL DEFAULT 0,
  has_examples INTEGER NOT NULL DEFAULT 0,
  example_count INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  meta TEXT,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_crossings`

Trail composition graph.

```sql
CREATE TABLE topo_crossings (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_resources`

Resource definitions. Renamed from `topo_provisions` per ADR-0023.

```sql
CREATE TABLE topo_resources (
  id TEXT NOT NULL,
  has_mock INTEGER NOT NULL DEFAULT 0,
  has_health INTEGER NOT NULL DEFAULT 0,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_trail_resources`

Which resources each trail declares. Renamed from `topo_trail_provisions` per ADR-0023.

```sql
CREATE TABLE topo_trail_resources (
  trail_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, resource_id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_signals`

Signal definitions.

```sql
CREATE TABLE topo_signals (
  id TEXT NOT NULL,
  description TEXT,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_trail_signals`

Which signals each trail can emit.

```sql
CREATE TABLE topo_trail_signals (
  trail_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, signal_id, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_examples`

Trail examples with input, expected output, and error cases.

```sql
CREATE TABLE topo_examples (
  id TEXT PRIMARY KEY,
  trail_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input TEXT NOT NULL,
  expected TEXT,
  error TEXT,
  snapshot_id TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_surfaces`

Which surfaces expose which trails.

```sql
CREATE TABLE topo_surfaces (
  trail_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  derived_name TEXT NOT NULL,
  method TEXT,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, surface, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_exports`

Serialized surface maps and lockfiles.

```sql
CREATE TABLE topo_exports (
  snapshot_id TEXT PRIMARY KEY,
  surface_map TEXT NOT NULL,
  surface_hash TEXT NOT NULL,
  serialized_lock TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

### `topo_schemas`

Cached JSON schemas (avoids recomputing `zodToJsonSchema()`).

```sql
CREATE TABLE topo_schemas (
  owner_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  schema_kind TEXT NOT NULL,
  zod_hash TEXT NOT NULL,
  json_schema TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, owner_kind, schema_kind, snapshot_id),
  FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
);
```

## Query Patterns

### Find all trails by intent

```sql
SELECT id, intent, description FROM topo_trails
WHERE snapshot_id = ? AND intent = ?
ORDER BY id ASC
```

### Find trails using a specific resource

```sql
SELECT DISTINCT t.id, t.intent
FROM topo_trails t
JOIN topo_trail_resources tp ON t.id = tp.trail_id AND t.snapshot_id = tp.snapshot_id
WHERE t.snapshot_id = ? AND tp.resource_id = ?
```

### Find incoming callers

```sql
SELECT source_id FROM topo_crossings
WHERE snapshot_id = ? AND target_id = ?
```

### Trails without output schemas

```sql
SELECT id, intent FROM topo_trails
WHERE snapshot_id = ? AND has_output = 0
```

### Compare two snapshots (trails added)

```sql
SELECT id FROM topo_trails WHERE snapshot_id = ?
EXCEPT
SELECT id FROM topo_trails WHERE snapshot_id = ?
```

### Crossing closure (recursive)

```sql
WITH RECURSIVE closure(id) AS (
  VALUES(?)
  UNION
  SELECT c.target_id FROM topo_crossings c
  JOIN closure cl ON c.source_id = cl.id
  WHERE c.snapshot_id = ?
)
SELECT id FROM closure
```

## Programmatic API

### `createTopoStore(options?)`

Create a read-only interface.

```typescript
import { createTopoStore } from '@ontrails/core';

const store = createTopoStore({ rootDir: '/path/to/workspace' });
store.trails.list({ intent: 'write' });
store.resources.get('db.main');
store.snapshots.list({ pinned: true });
store.snapshots.latest();
```

### `createMockTopoStore(seed?)`

Create a mock for testing.

```typescript
import { createMockTopoStore } from '@ontrails/core';

const mock = createMockTopoStore({
  trails: [{ id: 'auth.login', intent: 'write', hasOutput: true, ... }],
  resources: [{ id: 'db.main', hasMock: true, ... }],
});
```

### `topoStore` resource

Read-only resource for accessing the topo store in trails.

```typescript
import { topoStore } from '@ontrails/core';

trail('warden.check', {
  resources: [topoStore],
  blaze: async (_input, ctx) => {
    const store = topoStore.from(ctx);
    // store.trails, store.resources, store.snapshots, store.query()
  },
});
```

### `TopoStoreRef`

Reference type for querying by snapshot or pin:

```typescript
interface TopoStoreRef {
  readonly pin?: string;
  readonly snapshotId?: string;
}
```

- `{ pin: 'v1.0' }` — look up snapshot by pin name
- `{ snapshotId: 'uuid' }` — use exact snapshot ID
- `{}` — use the latest snapshot

## Record Types

### `TopoStoreTrailRecord`

```typescript
{
  id: string;
  kind: 'trail';
  intent: 'read' | 'write' | 'destroy';
  safety: '-' | 'read' | 'write' | 'destroy';
  idempotent: boolean;
  hasOutput: boolean;
  hasExamples: boolean;
  exampleCount: number;
  description: string | null;
  meta: Readonly<Record<string, unknown>> | null;
  snapshotId: string;
}
```

### `TopoStoreTrailDetailRecord`

Extends trail record with `crosses`, `detours`, `resources`, and `examples` arrays.

### `TopoStoreResourceRecord`

```typescript
{
  id: string;
  kind: 'resource';
  lifetime: 'singleton';
  health: 'available' | 'none';
  description: string | null;
  hasMock: boolean;
  hasHealth: boolean;
  snapshotId: string;
  usedBy: readonly string[];
}
```
