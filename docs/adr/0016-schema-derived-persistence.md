---
id: 16
slug: schema-derived-persistence
title: Schema-Derived Persistence
status: accepted
created: 2026-04-01
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [core-database-primitive, 9]
---

# ADR-0016: Schema-Derived Persistence

## Context

The hexagonal architecture places trailheads (CLI, MCP, HTTP) on the left and infrastructure (databases, caches, APIs) on the right. Trailheads have first-class framework support: `trailhead()` derives a full CLI from the trail contract, `buildMcpTools()` derives MCP tool definitions, `buildHttpRoutes()` derives HTTP routes. The left side of the hexagon is solved.

The right side is not. Every Trails app writes its own persistence layer from scratch. The Stash dogfood app[^stash] (a 19-trail GitHub Gist clone) spent ~700 lines on a hand-written SQLite store: table creation, CRUD functions, pagination helpers, FTS5 indexing, and type definitions. Every one of those lines restated information the framework already had:

- The entity shape was already defined as a Zod schema on the trail's output
- The insert shape was already defined as the trail's input schema (the output minus generated fields)
- The pagination shape was already provided by `paginatedOutput()` from `@ontrails/core/patterns`
- The operation semantics were already expressed by `intent: 'read' | 'write' | 'destroy'`
- The error conditions were already mapped by the error taxonomy (`NotFoundError`, `AlreadyExistsError`)

This is the same class of problem trailheads solved. The store is a copy of information the trail contract already contains. Trails eliminates the copies.

### The information flow question

The critical design question: which direction does the schema flow?

**Option A: Database schema is the source of truth.** Tools like Drizzle and Prisma define tables first and derive Zod schemas from them (e.g., `createInsertSchema(usersTable)`). This reverses Trails' information flow. The trail contract becomes a consumer rather than the origin.

**Option B: Zod schema is the source of truth.** The trail's Zod schema drives everything. The database schema is derived from it. This preserves the core principle: the trail is the product, everything else is a projection.

Option B is the right choice. The reasons:

1. **Zod schemas carry strictly more information than database schemas.** `.email()`, `.min(3)`, `.max(100)`, `.url()`, `.describe('...')` exist on Zod. A database column is just `text NOT NULL`. Deriving Zod from DB is lossy. Deriving DB from Zod is lossless.
2. **The trail contract is the single source of truth.** This is the core premise (ADR-0000). Trailheads, tests, governance, and now persistence all project from the same authored schema.
3. **The community already feels the pain of the reverse direction.** Drizzle community members report that `drizzle-zod` generated schemas are not useful for API validation because they always need refinement, and TypeScript performance degrades from double-inference.[^drizzle-zod] The workaround is maintaining two separate schemas — exactly the duplication Trails exists to prevent.

### The foundation

The framework already uses SQLite as its own internal database (see ADR: Core Database Primitive). The topo store projects the structural graph into `trails.db` for governance and introspection (see ADR: Topo Store). The patterns established there — Zod-to-SQLite type mapping, typed accessors, read-only provisions, escape hatches for complex queries — are proven by the framework's own usage.

`@ontrails/store` extends these patterns for app-level persistence. The framework dogfoods the query interface, provision integration, and connector model before exposing them to app developers.

## Decision

### The `@ontrails/store` package

A new package provides the framework-agnostic store model. It follows the same two-level architecture as trailheads:

| | Left side (trailheads) | Right side (store) |
|---|---|---|
| Framework-agnostic model | `CliCommand[]`, `McpTool[]`, `HttpRoute[]` | Store definitions, derived schemas, accessor contracts |
| Connector subpath | `/commander`, `/hono` | `/drizzle` (see the Drizzle Store Connector draft) |
| One-liner | `trailhead(app)` | `store({...})` |
| Escape hatch | `buildCliCommands()` then manual wiring | connector-native query access such as `conn.query()` |
| Derived from | Zod input schema + intent | Zod entity schema + persistence meta |

### Store definition

The root-package `store()` function accepts a record of table definitions. Each table binds a Zod schema to persistence metadata:

```typescript
import { store } from '@ontrails/store';
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

This root-level `store()` is the durable authored primitive. It declares the schema-derived persistence model without choosing a connector. That keeps non-Drizzle connectors first-class from the beginning and matches the rest of Trails: the authored primitive lives at the top level, connector packages project it into a runnable surface.

A connector consumes the declaration and binds it to a concrete runtime:

```typescript
import { store } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/store/drizzle';

const definition = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
  },
});

export const db = connectDrizzle(definition, { url: ':memory:' });
```

Connector packages may also provide a convenience `store(...)` that collapses declaration plus binding back into one call. That convenience is a projection. The root-package declaration remains the source of truth.

**What the developer authors** (persistence-specific, cannot be derived):

- `primaryKey` — which field is the primary key
- `generated` — which fields are server-managed (auto-generated IDs, timestamps)
- `indexes` — which fields get database indexes
- `references` — foreign key relationships between tables
- `search` — searchability configuration (see the Declarative Search draft)

**What the framework derives** (from the Zod schema + meta):

- Column types (Zod type to SQL type mapping)
- NOT NULL constraints (from Zod required vs optional)
- Default values (from Zod `.default()`)
- DDL statements (CREATE TABLE, CREATE INDEX)
- Insert schemas (entity schema minus generated fields)
- Update schemas (entity schema minus generated fields, all optional)
- Typed accessor contracts (insert, get, list, update, remove) that concrete connectors realize at runtime

### A bound store is a provision

The root declaration returned by `store()` is the schema-first model. Once a connector binds it, the resulting store is a Trails provision. It has `create`, `dispose`, `mock`, and `health` built in:

```typescript
const definition = store({ /* tables */ });
const db = connectDrizzle(definition, { url: ':memory:' });

// Use in trails directly:
trail('gist.list', {
  provisions: [db],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);  // typed, same as any provision
    const gist = await conn.gists.insert(input);
    return Result.ok(gist);
  },
});
```

- **`create`**: opens a database connection, runs derived DDL if needed
- **`dispose`**: closes the connection
- **`mock`**: creates an in-memory instance with the same schema, optionally seeded with fixtures
- **`health`**: pings the connection

This eliminates the ceremony of wrapping a database in a `provision()` call. The connector-bound store collapses provision definition, table definitions, and connection management into one runnable surface — the same collapse that `trailhead()` achieves for `buildCliCommands` + `toCommander` + `program.parse()`. The authored store definition and the bound runtime stay distinct so the root package remains connector-agnostic.

### Typed accessors

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

These are the same accessor patterns the topo store uses internally for governance queries (see ADR: Topo Store). App developers and framework internals share one query model.

### Escape hatch

For queries that don't fit the CRUD pattern (joins, aggregations, window functions, CTEs), drop down to the underlying query builder:

```typescript
trail('gist.search-with-files', {
  provisions: [db],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const results = await conn.query(({ drizzle, tables }) =>
      drizzle
        .select()
        .from(tables.gists)
        .innerJoin(tables.files, eq(tables.files.gistId, tables.gists.id))
        .where(eq(tables.gists.owner, input.owner))
    );
    return Result.ok(results);
  },
});
```

The derived tables are accessible through the escape hatch. The developer writes raw queries using the connector's native query builder (Drizzle, Kysely, etc.) with the same table objects the framework derived. Derive by default, override when wrong.

### Error mapping

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

### Mocks and fixtures

The store's `mock` factory creates an in-memory instance for testing. Well-known fixture IDs solve the seed/example tension identified in the Stash retro[^stash]:

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

`testAll(app)` works with zero additional configuration. The mock store with fixtures resolves automatically when the provision context detects a test environment.

### Read-only store variant

Stores can be created as read-only, exposing only `get`, `list`, and `query` on the connection type:

```typescript
import { readonlyStore } from '@ontrails/store/drizzle';

const analyticsDb = readonlyStore(
  { events: { schema: eventSchema, primaryKey: 'id' } },
  { url: './data/analytics.sqlite' }
);
```

This is the same pattern used internally by the topo store provision (see ADR: Topo Store). The read-only variant:

- Omits `insert`, `update`, and `remove` from the TypeScript connection type
- Opens the SQLite connection with `readonly: true` (database-level enforcement)
- Has no `mock` factory (read-only stores are backed by real data, not fixtures)

Use cases: connecting to an external analytics database, reading from a shared data source, querying the topo store or another framework-managed database from an app trail.

### Zod-to-SQL type mapping

The mapping from Zod types to SQL column types is deterministic:

| Zod type | SQL type | Notes |
|---|---|---|
| `z.string()` | `TEXT` | |
| `z.number()` | `REAL` | |
| `z.number().int()` | `INTEGER` | |
| `z.boolean()` | `INTEGER` | 0/1 |
| `z.date()` | `TEXT` | ISO 8601 |
| `z.enum([...])` | `TEXT` | CHECK constraint with enum values |
| `z.array(...)` | `TEXT` | JSON-serialized |
| `z.object(...)` | `TEXT` | JSON-serialized |
| `z.string().uuid()` | `TEXT` | |
| `z.string().email()` | `TEXT` | |
| `z.string().url()` | `TEXT` | |
| `z.optional()` | removes NOT NULL | |
| `z.default(v)` | `DEFAULT v` | |
| `z.nullable()` | removes NOT NULL | |
| Branded types | base SQL type | brand is a TypeScript-only concern |

This mapping is the same one used by the topo store for its internal tables and by the schema cache. One mapping function, used by both the framework and app developers.

**Override for edge cases:** When the derived column type isn't right, override per-field:

```typescript
store({
  posts: {
    schema: postSchema,
    primaryKey: 'id',
    generated: ['id'],
    columns: {
      body: { type: 'TEXT', collation: 'NOCASE' },
      metadata: { type: 'JSON' },  // connector-specific
    },
  },
});
```

Overrides are explicit and visible in the store definition. The framework derives the default; the developer overrides what's wrong.

## Consequences

### Positive

- **~700 lines of store code per app eliminated.** Table definitions, CRUD functions, pagination helpers, and type definitions are all derived from Zod schemas.
- **The trail contract drives persistence.** No reversed information flow. One schema, many projections.
- **Framework-proven patterns.** The typed accessors, escape hatch, and provision integration are stress-tested by the framework's own topo store before app developers use them.
- **Fixtures solve the seed/example tension.** Deterministic IDs on the store definition, referenced by trail examples. No workarounds.
- **Error mapping extends the taxonomy.** Database errors join the same deterministic mapping that trailheads use.
- **Testing works unchanged.** `testAll(app)` uses the mock store automatically. Zero configuration.
- **Read-only variant unifies internal and external patterns.** The topo store provision and an app's read-only database connection use the same API.

### Tradeoffs

- **Zod-to-SQL type mapping is opinionated.** The mapping is finite and deterministic, but edge cases (JSON columns, custom types) require per-field overrides.
- **The store is not an ORM.** Complex queries require the escape hatch. Typed accessors cover CRUD; joins, aggregations, and advanced SQL are explicit drop-downs to the connector's query builder.
- **Migration is out of scope.** The store derives DDL for the current schema state. Schema evolution (ALTER TABLE, data migrations) is delegated to the connector's migration tooling (e.g., `drizzle-kit`).

### What this does NOT decide

- **Which database connectors ship.** See the Drizzle Store Connector draft.
- **Entity-level trail derivation via `mark()`.** See the Entity Trail Factories draft.
- **Search and indexing beyond basic column indexes.** See the Declarative Search draft.
- **Transaction semantics beyond single-operation ACID.**

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) — the trail is the product, everything else is a projection
- [ADR-0005: Framework-Agnostic HTTP Route Model](../0005-framework-agnostic-http-route-model.md) — the two-level architecture pattern this mirrors
- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) — deterministic derivation, now extended to storage
- [ADR-0009: First-Class Provisions](../0009-first-class-provisions.md) — the provision primitive that the store builds on
- [ADR-0014: Core Database Primitive](../0014-core-database-primitive.md) — the `trails.db` foundation and patterns this extends
- [ADR-0015: Topo Store](../0015-topo-store.md) — the framework's own usage of the store patterns
- ADR: Drizzle Store Connector (draft) — the first database connector
- ADR: Declarative Search (draft) — searchability as a store declaration
- ADR: Entity Trail Factories (draft) — trail factories derived from store tables via `mark()`

[^stash]: The Stash dogfood app — a 19-trail GitHub Gist clone built overnight by an agent. Findings were captured in the Stash retro session.
[^drizzle-zod]: A recurring theme in the Drizzle community: `drizzle-zod` schemas need refinement for API validation and the double-inference path degrades TypeScript performance.
