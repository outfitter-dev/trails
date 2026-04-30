---
id: 14
slug: core-database-primitive
title: Core Database Primitive
status: accepted
created: 2026-04-02
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0014: Core Database Primitive

## Context

Trails is Bun-native. Bun ships `bun:sqlite` as a first-class built-in: in-process, zero-latency, WAL-capable, with prepared statements and transactions. It adds no dependency. It's the same non-dependency as `node:fs`.

Today the framework has exactly one SQLite usage: the tracing DevStore in `@ontrails/tracing`, which records execution tracks to `.trails/dev/tracing.db`.[^devstore] It's an island. The tracing writes to it; nothing else reads from it or benefits from its existence.

Meanwhile, the framework generates and consumes several categories of structural and operational data that are persisted as JSON files or held in memory:

- **The surface map** (`.trails/_surface.json`) — a deterministic manifest of every trail, signal, and resource in the topo. Generated at build time by `deriveSurfaceMap()`.[^surface-map]
- **The lockfile** (`.trails/trails.lock`) — a serialized record of the resolved topology for CI diffing.
- **Schema derivations** — `zodToJsonSchema()` output computed fresh on every startup and build.
- **Execution records** — the tracing DevStore, isolated from all structural data.

These are different kinds of framework data with different lifecycles, but they share a need: structured storage with query access. JSON files optimize for serialization. In-memory Maps optimize for key lookup. Neither optimizes for the kinds of questions the framework increasingly needs to answer: graph traversals, filtered joins, aggregate queries, cross-cutting analysis of structure and behavior together.

### The write restriction principle

The framework's internal database is infrastructure, not an API surface. Application trails should never write to it. The database captures what the framework knows about itself: the contract graph, execution observations, cached derivations. Application code reads this data (through governed resources) but never modifies it.

This is the same principle behind `ReadonlyMap` on the topo. The topo is derived from module exports and frozen. The database is derived from the topo and execution, and is write-restricted to the framework.

## Decision

### Single database in `.trails/`

The framework maintains a single SQLite database at `.trails/trails.db`. This file is created on first use and managed entirely by the framework runtime and CLI tools.

The `.trails/` directory is already established (the tracing DevStore uses `.trails/dev/tracing.db`). Consolidating into one database eliminates the isolated DevStore file and enables cross-cutting queries between structural and execution data.

**WAL mode** is enabled by default for concurrent read access. **NORMAL synchronous** mode balances durability with performance for development data.

### Write restriction

The database has two connection modes:

**Write connection (framework-internal only):**

- Used by the build system (topo population, schema cache)
- Used by the tracing (execution recording)
- Used by CLI commands that manage topo history and local framework state (`trails topo pin`, `trails dev clean`, `trails dev reset`)
- Not exposed as a resource. Not available to trail blazes. Not importable by app code.

**Read connection (resource, governed):**

- Exposed as a read-only resource for warden trails and dev tooling
- Opened with SQLite's `readonly: true` flag (database-level enforcement, not just a type)
- The resource's type surface exposes `list`, `get`, and `query` but not `insert`, `update`, or `remove`
- Available in dev and CI. Not loaded in production (the database may not exist).

```typescript
// Conceptual — illustrates the write-restriction architecture.
// Actual internal paths: @ontrails/core/internal/trails-db (openWriteTrailsDb)
import { getWriteConnection } from '@ontrails/core/internal/db';

// Resource for warden trails and dev tooling
import { topoStore } from '@ontrails/core';

trail('warden.write-needs-output', {
  resources: [topoStore],
  intent: 'read',
  blaze: async (input, ctx) => {
    const conn = topoStore.from(ctx);
    const writeTrails = await conn.trails.list({ intent: 'write' });
    // read-only: conn.trails.insert() is a type error
  },
});
```

### Table namespacing

Tables in `trails.db` are organized by subsystem. Each subsystem owns its schema and migration logic:

| Prefix | Subsystem | Lifecycle |
|---|---|---|
| `topo_*` | Topo store and snapshot history (pins are snapshots with `pinned_as` set) | Rebuilt on build/refresh; pinned snapshots are user-managed |
| `track_*` | Tracing (execution records) | Append-only, pruned |
| `cache_*` | Non-topo derivation caches and local framework caches | Populated on build, invalidated by content hash |

This avoids collision as subsystems evolve independently. Each subsystem manages its own table creation, and a version table tracks schema versions per subsystem for safe migration.

### Topo snapshots and pins

The topo store records every saved topo state, then lets developers pin the meaningful ones:

```sql
CREATE TABLE topo_snapshots (
  id TEXT PRIMARY KEY,        -- UUIDv7
  pinned_as TEXT UNIQUE,      -- developer-chosen durable name (null for autosaves)
  git_sha TEXT,               -- HEAD at snapshot time (null if not a git repo)
  git_dirty INTEGER,          -- 1 if working tree had uncommitted changes
  trail_count INTEGER,        -- summary stats for quick display
  signal_count INTEGER,
  resource_count INTEGER,
  created_at TEXT NOT NULL     -- ISO 8601
);
```

Every build and topo refresh writes an **autosave** (a snapshot with `pinned_as = NULL`). Autosaves form the continuous structural history of the app.

Developers create **pins** to keep and name important topo states (setting `pinned_as` to the chosen name):

```bash
trails topo pin "before auth refactor"
trails topo history
trails topo diff --since "before auth refactor"
```

Pins are durable names on topo snapshots. They are not a second storage primitive. They are a retention and discovery affordance on top of autosaved topo history.

**Retention policy:**

- Pinned snapshots persist until explicitly unpinned. They are deliberate developer landmarks.
- Unpinned snapshots are pruned to the most recent N (configurable, default 50).
- Tracing records are pruned to a configurable maximum (default 10,000) or age window (default 7 days), whichever is reached first.

### Lifecycle by environment

| Environment | Database exists? | Write behavior | Read behavior |
|---|---|---|---|
| **Production** | No | Nothing writes | Nothing reads. The in-memory topo is the execution engine. |
| **Dev** | Yes | Topo populated on startup and file-watch refresh. Tracing appends on execution. Schema cache updated on build. | Read-only resource available. Dev intelligence queries. `trails dev stats`. |
| **CI** | Yes (ephemeral) | Topo populated at build time. Warden trails query it. Lockfile exported from it. | Read-only resource for warden trails. Discarded after the pipeline completes. |

In production, the framework operates exactly as it does today: in-memory topo, no SQLite overhead, no database file. The database is a development and governance tool, not a runtime dependency.

### CLI tooling

```bash
# Topo history
trails topo                         # Show the current topo summary
trails topo history                 # List pins and recent autosaves
trails topo pin "name"              # Pin the current topo snapshot
trails topo diff --since "name"     # Structural diff since a pin or prior snapshot
trails topo unpin "name"            # Remove a pin but keep the underlying snapshot eligible for pruning
trails topo compile                 # Write .trails/trails.lock from the current topo
trails topo verify                  # Verify .trails/trails.lock reflects the current topo

# Developer maintenance
trails dev stats                    # Table sizes, row counts, file size, and retention overview
trails dev clean                    # Prune unpinned snapshots, old tracks, and stale caches
trails dev reset                    # Drop and recreate local Trails framework state
```

### Configuration

Retention and behavior are configurable through the standard Trails config:

```yaml
# trails.config.yaml
db:
  retention:
    snapshots: 50           # unpinned snapshot count (pinned snapshots exempt)
    tracks: 10000          # max execution records
    trackAge: 7d           # max age for execution records
  enabled: true            # false to disable entirely (e.g., in CI-only repos)
```

All values have sensible defaults. Zero configuration required.

## Consequences

### Positive

- **One database, many consumers.** Structural data, execution records, cached derivations, topo snapshots, and pins colocate. Cross-cutting queries become joins, not cross-system integrations.
- **No new dependency.** `bun:sqlite` is a Bun built-in. Core gains a capability without gaining a dependency.
- **Write restriction is enforced, not conventional.** SQLite's `readonly: true` connection flag plus TypeScript type narrowing. App code cannot accidentally write to framework data.
- **Production is unaffected.** The database only exists in dev and CI. The in-memory topo remains the execution engine. Zero overhead in production.
- **Topo history enables evolution tracking.** Snapshots plus pins create a queryable history of the app's structural evolution without forcing developers to think in database internals.

### Tradeoffs

- **`.trails/trails.db` is a binary file.** It should be in `.gitignore`. `.trails/trails.lock` remains the git-tracked text artifact. The database is the queryable local tool.
- **SQLite WAL mode creates `-wal` and `-shm` companion files.** These are transient and auto-cleaned, but developers may see them in `.trails/`.
- **Bun-native coupling.** `bun:sqlite` is a Bun built-in. If Trails ever targets Node.js, this would need `better-sqlite3` as a fallback. Acceptable: Trails is Bun-native by design.

### What this does NOT decide

- What tables the topo store contains (see ADR: Topo Store)
- How signals drive governance and lockfile generation (see ADR: Signal-Driven Governance)
- How app-level persistence works (see ADR: Schema-Derived Persistence)
- Migration strategy for the database schema itself (framework-internal, not user-facing)

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — the trail is the product, everything else is a projection
- [ADR-0009: First-Class Resources](0009-first-class-resources.md) — the resource primitive that the read-only store resource builds on
- [ADR-0013: Tracing](0013-tracing.md) — the execution recording primitive whose DevStore consolidates into this database
- [ADR-0015: Topo Store](0015-topo-store.md) — the structural graph projected into this database
- [ADR-0018: Signal-Driven Governance](0018-signal-driven-governance.md) — the framework lifecycle as a topo
- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) — app-level persistence building on the patterns established here

[^devstore]: The DevStore default path is `.trails/dev/tracing.db`. See `packages/tracing/src/stores/dev.ts`.

### Amendment log

- 2026-04-16: In-place vocabulary update per ADR-0035 Cutover 3 — `generateTrailheadMap` → `deriveSurfaceMap`, `writeTrailheadMap` → `writeSurfaceMap`, `_trailhead.json` → `_surface.json`, `trailhead map` → `surface map`. Schema tables updated: `topo_saves` + `topo_pins` collapsed into `topo_snapshots` with nullable `pinned_as` column.

[^surface-map]: The surface map is generated by `deriveSurfaceMap()` in `@ontrails/schema` and written to `.trails/_surface.json` by `writeSurfaceMap()`. See [ADR-0008: Deterministic Surface Derivation](0008-deterministic-trailhead-derivation.md).
