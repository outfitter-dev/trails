---
slug: schema-derived-persistence
title: Schema-Derived Persistence
status: draft
created: 2026-04-01
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9]
---

# ADR: Schema-Derived Persistence

## Context

The hexagonal architecture places trailheads (CLI, MCP, HTTP) on the left and infrastructure (databases, caches, APIs) on the right. Trailheads have first-class framework support: `trailhead()` derives a full CLI from the trail contract, `buildMcpTools()` derives MCP tool definitions, `buildHttpRoutes()` derives HTTP routes. The left side of the hexagon is solved.

The right side is not. Today, every Trails app writes its own persistence layer from scratch. The Stash dogfood app (a 19-trail GitHub Gist clone) spent ~700 lines on a hand-written SQLite store: table creation, CRUD functions, pagination helpers, FTS5 indexing, and type definitions. Every one of those lines restated information the framework already had:

- The entity shape was already defined as a Zod schema on the trail's output
- The insert shape was already defined as the trail's input schema (the output minus generated fields)
- The pagination shape was already provided by `paginatedOutput()` from `@ontrails/core/patterns`
- The operation semantics were already expressed by `intent: 'read' | 'write' | 'destroy'`
- The error conditions were already mapped by the error taxonomy (`NotFoundError`, `AlreadyExistsError`)

This is the same class of problem trailheads solved. The store is a copy of information the trail contract already contains. Trails eliminates the copies.

### The information flow question

The critical design question: which direction does the schema flow?

**Option A: Database schema is the source of truth.** Tools like Drizzle and Prisma define tables first and derive Zod schemas from them (e.g., `createInsertSchema(usersTable)`). This reverses Trails' information flow. The trail contract becomes a consumer rather than the origin.

**Option B: Zod schema is the source of truth.** The trail's Zod schema drives everything, and the database schema is derived from it. This preserves the core principle: the trail is the product, everything else is a projection.

We choose Option B. The reasons:

1. **Zod schemas carry strictly more information than database schemas.** `.email()`, `.min(3)`, `.max(100)`, `.url()`, `.describe('...')` exist on Zod. A database column is just `text NOT NULL`. Deriving Zod from DB is lossy. Deriving DB from Zod is lossless.

2. **The trail contract is the single source of truth.** This is the core premise (ADR-000). Trailheads, tests, governance, and now persistence all project from the same authored schema.

3. **The community already feels the pain of the reverse direction.** Drizzle community members report that `drizzle-zod` generated schemas aren't useful for API validation because they always need refinement, and TypeScript performance degrades from double-inference. The workaround is maintaining two separate schemas, which is exactly the duplication Trails exists to prevent.

## Decision

### Part 1: `@ontrails/store` package

A new package, `@ontrails/store`, provides the framework-agnostic store model. It follows the same two-level architecture as trailheads:

| | Left side (trailheads) | Right side (store) |
|---|---|---|
| Framework-agnostic model | `CliCommand[]`, `McpTool[]`, `HttpRoute[]` | Table definitions, typed accessors |
| Connector subpath | `/commander`, `/hono` | `/drizzle` (see the Drizzle Store Connector draft) |
| One-liner | `trailhead(app)` | `store({...})` |
| Escape hatch | `buildCliCommands()` then manual wiring | `conn.query()` for raw queries |
| Derived from | Zod input schema + intent | Zod entity schema + persistence metadata |

### Part 2: Store definition

The `store()` function accepts a record of table definitions. Each table binds a Zod schema to persistence metadata:

```typescript
import { store } from '@ontrails/store/drizzle';
import { gistSchema, fileSchema, commentSchema } from './schema';

export const db = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    indexes: ['owner', 'createdAt'],
  },
  files: {
    schema: fileSchema,
    primaryKey: 'id',
    generated: ['id'],
    references: { gistId: 'gists' },
  },
  comments: {
    schema: commentSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt'],
    references: { gistId: 'gists' },
  },
});
```

**What the developer authors** (persistence-specific, cannot be derived):

- `primaryKey` -- which field is the primary key
- `generated` -- which fields are server-managed (auto-generated IDs, timestamps)
- `indexes` -- which fields get database indexes
- `references` -- foreign key relationships between tables
- `search` -- searchability configuration (see the Declarative Search draft)

**What the framework derives** (from the Zod schema + metadata):

- Column types (Zod type to SQL type mapping)
- NOT NULL constraints (from Zod required vs optional)
- Default values (from Zod `.default()`)
- DDL statements (CREATE TABLE, CREATE INDEX)
- Insert schemas (entity schema minus generated fields)
- Update schemas (entity schema minus generated fields, all optional)
- Typed accessor methods (insert, get, list, update, remove)

### Part 3: The store IS a service

The store returned by `store()` is already a Trails service. It has `create`, `dispose`, `mock`, and `health` built in:

```typescript
// No separate provision() call needed
const db = store({ /* tables */ });

// In trail implementations:
blaze: async (input, ctx) => {
  const conn = db.from(ctx);  // typed, same as any service
  const gist = await conn.gists.insert(input);
  return Result.ok(gist);
}
```

- **`create`**: opens a database connection, runs derived DDL if needed
- **`dispose`**: closes the connection
- **`mock`**: creates an in-memory instance with the same schema, optionally seeded with fixtures
- **`health`**: pings the connection

This eliminates the ceremony of wrapping a database in a `provision()` call. The store collapses the provision definition, table definitions, and connection management into one declaration. Like `trailhead()` collapsing `buildCliCommands` + `toCommander` + `program.parse()`.

### Part 4: Typed accessors

Each table on the store connection exposes typed CRUD methods:

```typescript
const conn = db.from(ctx);

// Insert -- input type is schema minus generated fields
const gist = await conn.gists.insert(input);

// Get by primary key -- returns entity or null
const found = await conn.gists.get(id);

// List with typed filters and pagination
const page = await conn.gists.list(
  { owner: 'matt' },
  { limit: 20, offset: 0 }
);

// Partial update
const updated = await conn.gists.update(id, { description: 'New desc' });

// Delete
await conn.gists.remove(id);
```

Types are inferred entirely from the Zod schema:

- `insert()` accepts `Omit<Entity, GeneratedFields>`
- `get()` returns `Entity | null`
- `list()` accepts partial filter criteria typed from the schema's fields
- `update()` accepts `Partial<Omit<Entity, GeneratedFields>>`
- `remove()` returns `{ deleted: boolean }`

### Part 5: Escape hatch

For queries that don't fit the CRUD pattern (joins, aggregations, window functions, CTEs), drop down to the underlying query builder:

```typescript
blaze: async (input, ctx) => {
  const conn = db.from(ctx);
  const results = await conn.query(({ gists, files }) =>
    conn.drizzle
      .select()
      .from(gists)
      .innerJoin(files, eq(files.gistId, gists.id))
      .where(eq(gists.owner, input.owner))
  );
  return Result.ok(results);
}
```

The derived tables are accessible through the escape hatch. The developer writes raw queries using the connector's native query builder (Drizzle, Kysely, etc.) with the same table objects the framework derived. Override what's wrong.

### Part 6: Error mapping

The store accessors return `Result` and map database errors to the Trails error taxonomy:

| Database condition | Trails error |
|---|---|
| Row not found (get returns null) | The accessor returns null; the Entity Trail Factories draft wraps as `NotFoundError` |
| Unique constraint violation | `AlreadyExistsError` |
| Foreign key violation | `ValidationError` |
| Connection failure | `NetworkError` |
| Query timeout | `TimeoutError` |
| Unknown database error | `InternalError` |

This extends the error taxonomy's reach from trailheads to storage. The same `NotFoundError` that maps to HTTP 404 and CLI exit code 2 now also represents a missing database row. The developer returns `Result.err(new NotFoundError(...))` regardless of whether the trail is reading from memory, a database, or an external API.

### Part 7: Mock and fixtures

The store's `mock` factory creates an in-memory instance for testing. Well-known fixture IDs solve the seed/example tension identified in the Stash retro:

```typescript
const db = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    fixtures: [
      { id: 'seed-1', owner: 'alice', description: 'Test gist', isPublic: true },
      { id: 'seed-2', owner: 'bob', description: 'Private gist', isPublic: false },
    ],
  },
});
```

Fixtures are:

- Inserted into the mock store on creation
- Available to trail examples via well-known IDs (`input: { id: 'seed-1' }`)
- Validated against the entity schema at definition time
- Visible to the warden for governance checks

`testAll(app)` works with zero additional configuration. The mock store with fixtures is resolved automatically when the provision context detects a test environment.

## Consequences

### Positive

- **~700 lines of store code per app eliminated.** Table definitions, CRUD functions, pagination helpers, and type definitions are all derived from Zod schemas.
- **The trail contract drives persistence.** No reversed information flow. One schema, many projections.
- **Fixtures solve the seed/example tension.** Deterministic IDs on the store definition, referenced by trail examples. No workarounds.
- **Error mapping extends the taxonomy.** Database errors join the same deterministic mapping that trailheads use.
- **Testing works unchanged.** `testAll(app)` uses the mock store automatically. Zero configuration.

### Tradeoffs

- **Zod-to-SQL type mapping is opinionated.** The mapping is finite and deterministic, but some edge cases (JSON columns, custom types) require overrides.
- **The store is not an ORM.** Complex queries require the escape hatch. The typed accessors cover CRUD; joins, aggregations, and advanced SQL are explicit.
- **Migration is out of scope.** The store derives DDL for the current schema state. Schema evolution (ALTER TABLE, data migrations) is delegated to the connector's migration tooling (e.g., drizzle-kit).

### What this does NOT decide

- Which database connectors ship (see the Drizzle Store Connector draft)
- Entity-level trail derivation patterns (see the Entity Trail Factories draft)
- Search and indexing beyond basic column indexes (see the Declarative Search draft)
- Transaction semantics beyond single-operation ACID

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- the trail is the product, everything else is a projection
- [ADR-0005: Framework-Agnostic HTTP Route Model](../0005-framework-agnostic-http-route-model.md) -- the two-level architecture pattern this mirrors
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) -- deterministic derivation, now extended to storage
- [ADR-0009: Services](../0009-first-class-provisions.md) -- the provision primitive that the store builds on
- ADR: Drizzle Store Connector (draft) -- the first database connector
- ADR: Declarative Search (draft) -- searchability as a store declaration
- ADR: Entity Trail Factories (draft) -- trail factories derived from store tables
