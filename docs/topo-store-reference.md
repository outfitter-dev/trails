# Topo Store Reference

Schema definitions, query patterns, and programmatic API for the topo store. For the user-facing operations guide, see [Topo Store](./topo-store.md).

## SQLite Schema

### `topo_saves`

Every topo snapshot.

```sql
CREATE TABLE topo_saves (
  id TEXT PRIMARY KEY,
  git_sha TEXT,
  git_dirty INTEGER NOT NULL,
  trail_count INTEGER NOT NULL,
  signal_count INTEGER NOT NULL,
  provision_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

### `topo_pins`

Named references to important saves.

```sql
CREATE TABLE topo_pins (
  name TEXT PRIMARY KEY,
  save_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### `topo_trails`

Trail definitions for each save.

```sql
CREATE TABLE topo_trails (
  id TEXT NOT NULL,
  intent TEXT,
  idempotent INTEGER NOT NULL,
  has_output INTEGER NOT NULL,
  has_examples INTEGER NOT NULL,
  example_count INTEGER NOT NULL,
  description TEXT,
  meta TEXT,
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id)
);
```

### `topo_crossings`

Trail composition graph.

```sql
CREATE TABLE topo_crossings (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, save_id)
);
```

### `topo_provisions`

Resource definitions.

```sql
CREATE TABLE topo_provisions (
  id TEXT NOT NULL,
  has_mock INTEGER NOT NULL,
  has_health INTEGER NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id)
);
```

### `topo_trail_provisions`

Which resources each trail declares.

```sql
CREATE TABLE topo_trail_provisions (
  trail_id TEXT NOT NULL,
  provision_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, provision_id, save_id)
);
```

### `topo_signals`

Signal definitions.

```sql
CREATE TABLE topo_signals (
  id TEXT NOT NULL,
  description TEXT,
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id)
);
```

### `topo_trail_signals`

Which signals each trail can emit.

```sql
CREATE TABLE topo_trail_signals (
  trail_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, signal_id, save_id)
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
  save_id TEXT NOT NULL
);
```

### `topo_trailheads`

Which trailheads expose which trails.

```sql
CREATE TABLE topo_trailheads (
  trail_id TEXT NOT NULL,
  trailhead TEXT NOT NULL,
  derived_name TEXT NOT NULL,
  method TEXT,
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, trailhead, save_id)
);
```

### `topo_exports`

Serialized trailhead maps and lockfiles.

```sql
CREATE TABLE topo_exports (
  save_id TEXT PRIMARY KEY,
  trailhead_map TEXT NOT NULL,
  trailhead_hash TEXT NOT NULL,
  serialized_lock TEXT NOT NULL
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
  save_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, owner_kind, schema_kind, save_id)
);
```

## Query Patterns

### Find all trails by intent

```sql
SELECT id, intent, description FROM topo_trails
WHERE save_id = ? AND intent = ?
ORDER BY id ASC
```

### Find trails using a specific resource

```sql
SELECT DISTINCT t.id, t.intent
FROM topo_trails t
JOIN topo_trail_provisions tp ON t.id = tp.trail_id AND t.save_id = tp.save_id
WHERE t.save_id = ? AND tp.provision_id = ?
```

### Find incoming callers

```sql
SELECT source_id FROM topo_crossings
WHERE save_id = ? AND target_id = ?
```

### Trails without output schemas

```sql
SELECT id, intent FROM topo_trails
WHERE save_id = ? AND has_output = 0
```

### Compare two saves (trails added)

```sql
SELECT id FROM topo_trails WHERE save_id = ?
EXCEPT
SELECT id FROM topo_trails WHERE save_id = ?
```

### Crossing closure (recursive)

```sql
WITH RECURSIVE closure(id) AS (
  VALUES(?)
  UNION
  SELECT c.target_id FROM topo_crossings c
  JOIN closure cl ON c.source_id = cl.id
  WHERE c.save_id = ?
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
store.pins.list();
store.saves.latest();
```

### `createMockTopoStore(seed?)`

Create a mock for testing.

```typescript
import { createMockTopoStore } from '@ontrails/core';

const mock = createMockTopoStore({
  trails: [{ id: 'auth.login', intent: 'write', hasOutput: true, ... }],
  resources: [{ id: 'db.main', hasMock: true, ... }],
  pins: [{ name: 'baseline', saveId: 'save-1', ... }],
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
    // store.trails, store.resources, store.pins, store.saves, store.query()
  },
});
```

### `TopoStoreRef`

Reference type for querying by save or pin:

```typescript
interface TopoStoreRef {
  readonly pin?: string;
  readonly saveId?: string;
}
```

- `{ pin: 'v1.0' }` — look up save by pin name
- `{ saveId: 'uuid' }` — use exact save ID
- `{}` — use the latest save

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
  saveId: string;
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
  saveId: string;
  usedBy: readonly string[];
}
```
