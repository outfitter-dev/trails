---
id: 31
slug: backend-agnostic-store-schemas
title: Backend-Agnostic Store Schemas
status: accepted
created: 2026-04-09
updated: 2026-04-10
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 14, 16, 22, connector-extraction-and-the-with-packaging-model]
---

# ADR-0031: Backend-Agnostic Store Schemas

## Context

### The store is backend-coupled

`store()` currently bakes in relational assumptions — tables, primary keys, indexes, references. The API wears the name of the whole persistence domain but only speaks one dialect. A developer who wants to persist data in Firestore, R2, or a key-value store has no path through `store()`.

This matters because the same domain object often lives in different backends across different environments. A gist might be a SQLite row locally, a D1 row in production, and a Firestore document in an alternative deployment. The store schema describes *what* is persisted. The connector determines *how*. Today those two concerns are fused.

### Left side solved, right side open

Trails already solved this on the left side of the hexagon. One trail schema projects into CLI flags, MCP tool parameters, and HTTP request bodies via trailheads. The developer authors one schema, the framework reads it many ways.

The right side — persistence — doesn't have this yet. One store schema should project into database tables, Firestore collections, KV entries, or files via connectors. The "one write, many reads" principle[^1] applies to both sides.

### ADR-0016 established the store primitive

[ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) established `store()` as the persistence declaration and schema-to-table derivation as the mechanism. [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](../0022-drizzle-store-connector.md) implemented the first connector binding. This ADR generalizes that foundation: the store schema becomes backend-agnostic, and connectors interpret it for their specific kind.

## Decision

### Store is the persistence domain

**Store** is the category — the umbrella for "where does data go and how does it persist." The `store()` function declares *what* you persist without specifying *how*:

```typescript
const db = store({
  notes: {
    schema: noteSchema,
    identity: 'id',
    generated: ['id', 'createdAt'],
  },
});
```

A store schema declares the persistence contract for a domain object:

- Fields and types (from Zod schema)
- Identity (which field is the primary key)
- Generated fields (auto-IDs, timestamps)
- Relationships (references between entities)
- Fixtures (seed data for testing)

The schema says nothing about databases, files, or any specific backend. How it maps to concrete persistence is determined by which connector binds it.

### Store kinds

The *how* of persistence. Different shapes for different needs:

| Kind | Shape | Examples |
| --- | --- | --- |
| tabular | Tables, rows, columns, SQL queries | SQLite, Postgres, D1, MySQL |
| document | Collections, nested documents, realtime | Firestore, MongoDB, DynamoDB (doc mode) |
| file | Blobs, objects, paths, streams | S3, R2, GCS, local filesystem |
| kv | Key-value pairs, simple get/set | Redis, Cloudflare KV, DynamoDB (KV mode) |
| cache | Key-value with TTL, invalidation | Redis, in-memory, CDN cache |

The same authored store schema can project into different store kinds depending on the connector. A gist could be a database row (via Drizzle), a Firestore document (via Firebase), or a markdown file (via filesystem connector). The trail doesn't know and doesn't care.

### Same schema, many projections

This extends "one write, many reads" to the right side of the hexagon:

- **Left side:** one trail schema projects into CLI flags, MCP tool params, HTTP request bodies (via trailheads)
- **Right side:** one store schema projects into database tables, Firestore collections, KV entries, or files (via connectors)

Kind-specific metadata (SQL indexes, Firestore subcollection config) lives on the *connector binding*, not the store declaration. This keeps the declaration pure and kind-agnostic:

```typescript
// Store declaration — what to persist (kind-agnostic)
const db = store({
  notes: { schema: noteSchema, identity: 'id', generated: ['id', 'createdAt'] },
});

// Connector binding — how to persist (kind-specific)
const notesDb = drizzle(db, {
  url: './notes.sqlite',
  indexes: { notes: [{ fields: ['createdAt'], order: 'desc' }] },
});
```

The store schema declares domain-level hints (this field needs indexing, this entity references that entity). The connector interprets those hints for its specific kind.

### Progressive persistence

A developer's persistence choices evolve as their project matures. The store schema stays the same. Only the connector changes:

**Stage 1: JSON files.** Quick and simple. Good for prototyping.

```typescript
import { jsonFile } from '@ontrails/with-jsonfile';
const gists = jsonFile(db, { dir: './data' });
```

**Stage 2: Local database.** Need queries, FTS, performance.

```typescript
import { drizzle } from '@ontrails/with-drizzle';
const gists = drizzle(db, { url: './data/gists.sqlite' });
```

**Stage 3: Cloud deployment.** Production infrastructure.

```typescript
import { d1 } from '@ontrails/with-cloudflare/d1';
const gists = d1(db, { database: 'gists-prod' });
```

Trails don't change. Tests don't change. Store schema doesn't change. The connector swap is a one-line diff.

### Change signals from store writes

When a store accessor performs a write, it can automatically fire a signal. These signals are *projected* from the store schema — the developer doesn't author them:

```typescript
const db = store({
  notes: {
    schema: noteSchema,
    identity: 'id',
    // Framework derives: notes.created, notes.updated, notes.removed signals
  },
});
```

This is pure derivation. The store schema is the single authored artifact. The signals are reads of it.

### Version tracking

An optional flag on the store schema. The framework manages a version field, increments on every write, and enables conflict detection:

```typescript
const db = store({
  notes: {
    schema: noteSchema,
    identity: 'id',
    versioned: true,  // framework adds + manages a version field
  },
});
```

Version tracking enables drift detection as a warden governance rule — if two resources hold the same entity, the warden can compare versions and report drift. This is governance, not a sync engine.

### Multi-resource sync is trails reacting to signals

Multi-resource synchronization does not require new primitives. It is expressed entirely with existing Trails concepts: trails, signals, and resources.

One-way sync (primary → projection):

```typescript
const reindex = trail('note.reindex', {
  pattern: 'sync',
  on: [contentChanged],
  resources: [fileStore, indexDb],
  intent: 'write',
  blaze: async (input, ctx) => {
    const files = fileStore.from(ctx);
    const index = indexDb.from(ctx);
    const content = await files.notes.get(input.id);
    const metadata = extractFrontmatter(content.body);
    await index.notes.upsert({ id: input.id, ...metadata });
    return Result.ok({ reindexed: input.id });
  },
});
```

Bidirectional sync uses two trails — one per direction. Conflict resolution uses a reconcile trail with domain-specific strategy:

```typescript
const resolveConflict = trail('note.resolve-conflict', {
  pattern: 'reconcile',
  on: [noteConflict],
  resources: [localDb],
  intent: 'write',
  blaze: async (input, ctx) => {
    const winner = input.localVersion > input.remoteVersion
      ? input.local
      : input.remote;
    const db = localDb.from(ctx);
    await db.notes.upsert(winner);
    return Result.ok({ resolved: input.id, strategy: 'last-write-wins' });
  },
});
```

No sync engine. No bidirectional mapping declarations. No conflict resolution DSL. Just trails that move data between resources in response to signals. Testable, governable, visible in the topo graph.

### The Obsidian test

The motivating validation: could you build Obsidian with Trails?

Locally, Obsidian is markdown files in a folder. In the cloud, it's structured data in a database, content in blob storage, and a search index. The store schema is the same in both cases — notes have titles, bodies, frontmatter, links, attachments.

```text
Local profile:
  notes.body     → markdown files on disk (fs connector)
  notes.metadata → derived from frontmatter at read time
  assets         → files in attachments folder
  index          → built at startup by scanning

Cloud profile:
  notes.body     → R2 objects (Cloudflare connector)
  notes.metadata → D1 rows (Cloudflare connector)
  assets         → R2 objects (Cloudflare connector)
  index          → Vectorize (Cloudflare connector)
```

Sync between local files and the database index uses sync trails reacting to change signals. Conflict resolution uses reconcile trails. Same trails. Same store schema. Same trail factories. Different connectors per profile.

## Non-goals

- **Building a sync engine.** Multi-resource sync is expressed as trails reacting to signals. The framework provides change signals (derived), version tracking (opt-in), and drift detection (warden rule). The developer writes the sync logic.
- **CRDT or distributed consensus.** The framework does not attempt to solve distributed systems problems. Conflict resolution is a domain concern expressed in reconcile trails with explicit strategies.
- **Store kind abstraction at 1.0.** The kind taxonomy (tabular, document, file, kv, cache) is the design direction. The initial implementation focuses on tabular (already working via Drizzle) and expands as connectors are built.

## Consequences

### Positive

- **"One write, many reads" extended to persistence.** One store schema, many persistence backends. The same principle that makes trailheads work now makes connectors work.
- **Progressive persistence.** Start with JSON files, graduate to SQLite, deploy to D1 — same schema, same trails, one-line connector swap.
- **No sync primitives.** Multi-resource consistency uses existing concepts (trails, signals, resources). The framework's concept count doesn't grow.
- **Change signals are derived.** Store write signals project from the schema. No new authoring.

### Tradeoffs

- **Kind-specific metadata placement.** SQL indexes, Firestore subcollection config, and similar concerns must live on the connector binding, not the store declaration. This keeps the store pure but means kind-specific optimization requires touching the connector config. The alternative — kind hints on the store schema — risks making "kind-agnostic" declarations require kind-specific authoring.
- **`store()` API may need reshaping.** The current API bakes in relational concepts (`primaryKey`, `indexes`, `references`). If the store is truly kind-agnostic, some fields become domain-level hints that connectors interpret rather than hard structural requirements. The boundary between hint and requirement needs careful design.

### Risks

- **Abstraction leakage.** The promise "same schema, different backend" breaks if a developer relies on backend-specific query patterns. Tabular connectors support SQL-like queries; file connectors support path-based access. The store accessor interface must be general enough to be useful across kinds without being so abstract that it's useless.

## Non-decisions

- **Profile selects the loadout.** How a deployment profile chooses which connector backs which resource is a configuration concern. Deferred to [ADR: Resource Bundles](20260409-resource-bundles.md) (draft).
- **Store schema splits/merges.** One entity across multiple persistence targets (note body in R2, metadata in D1) — the sync trail handles the data flow, but the initial binding needs design.
- **Store accessor interface.** The generalized accessor API across store kinds. Currently the accessor is tabular-shaped (`.get()`, `.list()`, `.upsert()`, `.remove()`). How this extends to file (`.read()`, `.write()`, `.stream()`) and kv (`.get()`, `.set()`, `.delete()`) needs design per kind.

## References

- [ADR-0009: First-Class Resources](../0009-first-class-resources.md) — the resource primitive that connectors produce and stores bind through
- [ADR-0014: Core Database Primitive](../0014-core-database-primitive.md) — the database primitive that store builds on
- [ADR-0016: Schema-Derived Persistence](../0016-schema-derived-persistence.md) — the store contract this ADR generalizes to be backend-agnostic
- [ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite](../0022-drizzle-store-connector.md) — the first connector implementation, validating the schema-to-backend pattern
- [ADR-0029: Connector Extraction and the `with-*` Packaging Model](0029-connector-extraction-and-the-with-packaging-model.md) — the packaging model connectors live in
- [ADR: Resource Bundles](20260409-resource-bundles.md) (draft) — the bundling mechanism for connector and pack resources, including profile-based overrides
- [ADR: `deriveTrail()` and Trail Factories](20260409-derivetrail-and-trail-factories.md) (draft) — trail factories that compose with store schemas (`crud`, `sync`, `reconcile`)
- [Tenets: One write, many reads](../../tenets.md) — the governing principle extended to persistence
- [Tenets: Schema always exists](../../tenets.md) — store schemas are typed and always present

[^1]: [Tenets: One write, many reads](../../tenets.md)
