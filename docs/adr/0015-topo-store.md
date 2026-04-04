---
id: 15
slug: topo-store
title: Topo Store
status: accepted
created: 2026-04-02
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [14]
---

# ADR-0015: Topo Store

## Context

The resolved topology — all trails, their schemas, crossings, provisions, signals, trailhead mappings, and metadata — exists in two forms today. In memory, it's a `ReadonlyMap<string, AnyTrail>` with parallel maps for signals and provisions. On disk, it's a JSON file (the trailhead map at `.trails/_trailhead.json`).[^trailhead-map] Both are flat serializations of a graph structure.

When something wants to query the topo, it traverses these structures imperatively. The warden iterates all trails to check governance rules. The `survey` command iterates all trails to produce a human-readable summary. The `guide` command searches trails by ID or metadata. An agent connecting to an MCP trailhead gets a flat list of tools. These are all graph queries wearing imperative clothing.

"Which trails cross this trail?" is a join. "What provisions does the crossing closure of `onboard.user` need?" is a recursive CTE. "Show me all write-intent trails exposed on HTTP" is a filtered join. Today, each consumer re-implements its own traversal logic.

The core premise says "the contract is queryable." Today it's queryable in the sense that you can write TypeScript traversal code. With the topo projected into SQLite, it's queryable in the sense that you can ask questions in a language designed for asking questions.

### What changes for whom

**Warden rule authors:** A governance rule becomes a typed accessor call or a SQL query with expected results, instead of a TypeScript function that traverses Maps. "Every write-intent trail must declare an output schema" is `conn.trails.list({ intent: 'write' })` filtered by output presence. No traversal logic.

**Agents:** An MCP-connected agent can query the topo store to understand crossing graphs, find trails by intent, check which provisions a trail needs — all through structured queries rather than parsing TypeScript source.

**CI pipelines:** The lockfile becomes an export of the topo store rather than a parallel serialization. Semantic diffing becomes a database operation: compare saved topo states or diff current topo against a pin.

**The execution hot path:** Unchanged. The in-memory `ReadonlyMap` stays as the dispatch engine. The topo store is for querying, not for hot-path lookups.

## Decision

### Table schema

The topo store projects the resolved topology into relational tables within `trails.db`:
The foundational `topo_saves` and `topo_pins` tables intentionally restate ADR-0014's
core database primitive so this ADR can present the full topo store schema as a
self-contained unit.

```sql
CREATE TABLE topo_saves (
  id TEXT PRIMARY KEY,            -- UUIDv7
  git_sha TEXT,
  git_dirty INTEGER DEFAULT 0,
  trail_count INTEGER DEFAULT 0,
  signal_count INTEGER DEFAULT 0,
  provision_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE topo_pins (
  name TEXT PRIMARY KEY,          -- developer-chosen durable name
  save_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Core trail metadata
CREATE TABLE topo_trails (
  id TEXT NOT NULL,
  intent TEXT,
  idempotent INTEGER DEFAULT 0,
  has_output INTEGER DEFAULT 0,
  has_examples INTEGER DEFAULT 0,
  example_count INTEGER DEFAULT 0,
  description TEXT,
  meta TEXT,                      -- JSON blob for arbitrary metadata
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Trail crossings (composition graph)
CREATE TABLE topo_crossings (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Provisions declared per trail
CREATE TABLE topo_trail_provisions (
  trail_id TEXT NOT NULL,
  provision_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, provision_id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Provision definitions
CREATE TABLE topo_provisions (
  id TEXT NOT NULL,
  has_mock INTEGER DEFAULT 0,
  has_health INTEGER DEFAULT 0,
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Signal definitions
CREATE TABLE topo_signals (
  id TEXT NOT NULL,
  description TEXT,
  save_id TEXT NOT NULL,
  PRIMARY KEY (id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Signal emissions declared per trail
CREATE TABLE topo_trail_signals (
  trail_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, signal_id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Fire declarations (what activates a trail)
CREATE TABLE topo_fires (
  trail_id TEXT NOT NULL,
  source_type TEXT NOT NULL,      -- 'signal' | 'schedule' | 'lifecycle'
  source_id TEXT,                 -- signal ID, cron expression, or lifecycle event
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, source_type, source_id, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Trailhead mappings (which trailheads expose which trails)
CREATE TABLE topo_trailheads (
  trail_id TEXT NOT NULL,
  trailhead TEXT NOT NULL,        -- 'cli' | 'mcp' | 'http'
  derived_name TEXT NOT NULL,     -- CLI command path, MCP tool name, HTTP route
  method TEXT,                    -- HTTP method (null for CLI/MCP)
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, trailhead, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);

-- Examples stored per trail
CREATE TABLE topo_examples (
  id TEXT PRIMARY KEY,            -- UUIDv7
  trail_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  input TEXT NOT NULL,            -- JSON
  expected TEXT,                  -- JSON (null for schema-only validation)
  error TEXT,                     -- error class name (null for success cases)
  save_id TEXT NOT NULL,
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);
```

### Schema cache as a column

The topo store subsumes the schema cache. Each trail's derived JSON Schema is stored alongside its structural metadata:

```sql
CREATE TABLE topo_schemas (
  trail_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'input' | 'output'
  zod_hash TEXT NOT NULL,         -- content hash of the Zod schema's ._def tree
  json_schema TEXT NOT NULL,      -- pre-computed JSON Schema (zodToJsonSchema output)
  save_id TEXT NOT NULL,
  PRIMARY KEY (trail_id, kind, save_id),
  FOREIGN KEY (save_id) REFERENCES topo_saves(id)
);
```

On build/refresh:

1. For each trail, compute `hash(schema._def)`.
2. Check: does a row exist with this `trail_id`, `kind`, and `zod_hash`?
3. Hit: reuse the stored `json_schema`. Skip `zodToJsonSchema()`.
4. Miss: compute `zodToJsonSchema()`, store the result.

This targets the single most expensive startup operation. For a 100-trail topo, the initial build computes all schemas (~100-200ms). Subsequent builds with one changed trail recompute one schema (~1-2ms) and reuse 99 cached results.

The cache is safe because the Zod schema is the source of truth. If the schema changes, its content hash changes, the cache misses, and the JSON Schema is recomputed.

### Population lifecycle

**Build-time (CI):**

`topo()` constructs the in-memory topology from module exports as today. A new build step, `populateTopoStore(topo, db)`, writes a saved topo state and projects the in-memory topo into SQLite tables. This happens once per CI run.

```text
Module exports -> topo() -> ReadonlyMap (in-memory) -> populateTopoStore() -> trails.db
```

**Dev mode:**

On `trails dev` startup, the topo store is populated from the current topo. On file changes (detected by Bun's file watcher), the topo is rebuilt from module exports and the store is refreshed. The refresh writes a new autosave, then incrementally reuses unchanged rows where possible.

The refresh emits a `topo.saved` signal (see ADR: Signal-Driven Governance), which downstream consumers can fire on. `trails topo pin` emits `topo.pinned` when a saved topo state is deliberately retained under a durable name.

**Production:**

The topo store does not exist. The in-memory topo is the execution engine. No SQLite overhead.

### Read-only provision

The topo store is exposed as a framework-provided read-only provision:

```typescript
import { topoStore } from '@ontrails/core';

trail('warden.write-needs-output', {
  provisions: [topoStore],
  intent: 'read',
  blaze: async (input, ctx) => {
    const conn = topoStore.from(ctx);

    const writeTrails = await conn.trails.list({ intent: 'write' });
    const missing = writeTrails.filter(t => !t.hasOutput);

    if (missing.length === 0) return Result.ok({ pass: true, diagnostics: [] });

    return Result.ok({
      pass: false,
      diagnostics: missing.map(t => ({
        trailId: t.id,
        message: 'Write-intent trail missing output schema',
        severity: 'error',
      })),
    });
  },
});
```

The provision connection type does not expose write methods. This is enforced at both the TypeScript level (the type omits `insert`/`update`/`remove`) and the SQLite level (`readonly: true` on the connection).

**Escape hatch for complex queries:**

```typescript
const conn = topoStore.from(ctx);

// Crossing closure via recursive CTE
const closure = await conn.query(sql`
  WITH RECURSIVE closure(id) AS (
    VALUES(${trailId})
    UNION
    SELECT c.target_id FROM topo_crossings c
    JOIN closure cl ON c.source_id = cl.id
    WHERE c.save_id = ${currentSaveId}
  )
  SELECT t.* FROM topo_trails t
  WHERE t.id IN closure AND t.save_id = ${currentSaveId}
`);
```

### Evolution tracking

Because every topo row carries a `save_id`, the database contains a time series of the app's structural evolution. Pins turn selected saves into durable references. This enables queries that no other tool can answer:

```sql
-- Trails added since a named pin
SELECT t.id FROM topo_trails t
WHERE t.save_id = :current
  AND t.id NOT IN (
    SELECT id FROM topo_trails
    WHERE save_id = (SELECT save_id FROM topo_pins WHERE name = :pin)
  );

-- Trails that changed intent
SELECT c.id, c.intent as current_intent, p.intent as previous_intent
FROM topo_trails c
JOIN topo_trails p ON c.id = p.id
WHERE c.save_id = :current AND p.save_id = :previous
  AND c.intent IS NOT p.intent;

-- Crossing graph diff between two saved topo states
SELECT source_id, target_id, 'added' as change
FROM topo_crossings WHERE save_id = :current
EXCEPT SELECT source_id, target_id, 'added' FROM topo_crossings WHERE save_id = :previous
UNION ALL
SELECT source_id, target_id, 'removed' as change
FROM topo_crossings WHERE save_id = :previous
EXCEPT SELECT source_id, target_id, 'removed' FROM topo_crossings WHERE save_id = :current;
```

This is the `trails topo diff` concept made continuous. The lockfile captures the latest state as a text file for git. The topo store captures autosave history and pins for queryable analysis.

### Lockfile as an export

The lockfile (`.trails/trails.lock`) becomes a deterministic text export of the current topo state:

```bash
trails topo export          # Write .trails/trails.lock from the current topo
trails topo diff --lock     # Compare current topo against .trails/trails.lock
trails topo verify          # CI: fail if .trails/trails.lock is stale
```

The topo store is the queryable source of truth. The lockfile is its text projection for git diffing. The database generates the lockfile, not the other way around.

### Dev intelligence joins

Because the topo store and tracker records colocate in `trails.db`, cross-cutting queries become joins:

```sql
-- Latency by intent (structure + behavior)
SELECT t.intent,
  COUNT(*) as invocations,
  ROUND(AVG(tr.ended_at - tr.started_at), 1) as avg_ms
FROM topo_trails t
JOIN track_records tr ON t.id = tr.trail_id
WHERE t.save_id = :current AND tr.ended_at IS NOT NULL
GROUP BY t.intent;

-- Error rates for trails that cross user.get
SELECT tr.trail_id, COUNT(*) as errors
FROM track_records tr
WHERE tr.status = 'err' AND tr.trail_id IN (
  SELECT source_id FROM topo_crossings
  WHERE target_id = 'user.get' AND save_id = :current
)
GROUP BY tr.trail_id ORDER BY errors DESC;
```

The structural graph (what's declared) and the execution record (what happened) are in the same database. Questions that span both become one query.

## Consequences

### Positive

- **The contract is queryable in a query language.** Graph traversals, filtered joins, aggregate analysis, and recursive closures are SQL, not imperative TypeScript.
- **Schema cache eliminates redundant computation.** The most expensive startup operation (`zodToJsonSchema`) runs once per schema change, not once per build.
- **Evolution is trackable.** Save-tagged rows create a time series of structural changes. Pins are developer-controlled durable references into that history.
- **The warden becomes simpler.** Governance rules become typed accessor calls or SQL queries with expected results, not Map traversal functions.
- **Dev intelligence gets structure.** Joining topo data with tracker data answers questions neither could answer alone.
- **Agents get deep introspection.** An agent can query the crossing graph, provision dependencies, and intent classifications without parsing TypeScript.

### Tradeoffs

- **Two representations of the topo.** The in-memory `ReadonlyMap` stays for execution. The SQLite store exists for querying. They derive from the same source but could theoretically diverge if the population step has bugs. Mitigated: `testAll` can verify consistency.
- **Startup cost in dev.** Populating the topo store adds time to `trails dev` startup. For a 100-trail app, this is estimated at sub-100ms (100 INSERTs with indexes). Subsequent refreshes are incremental diffs.
- **Save accumulation.** Autosaves are pruned by the retention policy (see ADR: Core Database Primitive). Pins persist until removed.

### What this does NOT decide

- How signals drive lockfile generation and warden execution (see ADR: Signal-Driven Governance)
- How app-level persistence works (see ADR: Schema-Derived Persistence)
- Specific warden rule implementations (the warden package evolves to use the topo store provision, but the migration is incremental)
- FTS5 or vector search on topo data (future: agent discovery could benefit, but not in scope)

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — "the contract is queryable"
- [ADR-0008: Deterministic Trailhead Derivation](0008-deterministic-trailhead-derivation.md) — the trailhead map that the topo store subsumes
- [ADR-0013: Tracker](0013-tracker.md) — execution records that colocate with topo data for cross-cutting queries
- [ADR-0014: Core Database Primitive](0014-core-database-primitive.md) — the `trails.db` foundation this builds on
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md) — the lockfile projection exported from topo state
- [ADR-0018: Signal-Driven Governance](0018-signal-driven-governance.md) — how topo saves and pins drive downstream behavior

[^trailhead-map]: The trailhead map is generated by `generateTrailheadMap()` in `@ontrails/schema` and written to `.trails/_trailhead.json` by `writeTrailheadMap()`. See `packages/schema/src/io.ts`.
