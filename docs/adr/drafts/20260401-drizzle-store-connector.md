---
slug: drizzle-store-connector
title: Drizzle Store Connector
status: draft
created: 2026-04-01
updated: 2026-04-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [16, 9]
---

# ADR: Drizzle Store Connector

## Context

The Schema-Derived Persistence draft defines the framework-agnostic store abstraction: Zod schemas as source of truth, typed accessors, provision lifecycle. This ADR decides the first concrete connector.

The connector's job is mechanical: translate `StoreDefinition` into real database tables and execute queries against them. It follows the same pattern as trailhead connectors: `@ontrails/cli` defines the abstract `CliCommand[]` model, `@ontrails/cli/commander` wires it to Commander.js. The store package defines the abstract `StoreDefinition`, the Drizzle connector wires it to Drizzle ORM.

### Why Drizzle

Three options were considered:

**Raw `bun:sqlite`.** Zero dependencies, maximum control. But the developer writes SQL strings, loses type-safe query building, and handles connection management manually. Good for a minimal connector, but doesn't address the query builder escape hatch needed for complex operations.

**Prisma.** Larger ecosystem, schema-first design. But Prisma's schema language is a separate DSL (not TypeScript), the generation step adds build complexity, and the client is heavier than needed for the common Trails use case.

**Drizzle.** TypeScript-native schema definitions, SQL-like query builder, lightweight, supports SQLite and Postgres, and has first-party Zod integration (though in the wrong direction, table-to-Zod). Drizzle's query builder is the right escape hatch for complex operations. Its `drizzle-kit` handles migrations. The mental model (write SQL in TypeScript) aligns with Trails' "no magic" philosophy.

Drizzle is the recommended first connector. The store abstraction (Schema-Derived Persistence draft) is connector-agnostic, so a raw `bun:sqlite` connector or a Prisma connector can be added later without affecting the core model.

## Decision

### 1. Lives at `@ontrails/store/drizzle`

Follows the established subpath convention:

```typescript
import { store } from '@ontrails/store/drizzle';
```

Drizzle ORM and the relevant dialect driver (e.g., `drizzle-orm/sqlite-core`) are peer dependencies. The connector does not re-export Drizzle. The developer installs Drizzle alongside the connector, the same way Commander is installed alongside `@ontrails/cli`.

### 2. `deriveTable()` converts Zod schemas to Drizzle table definitions

The core mechanical function. Given a Zod object schema and persistence metadata, produces a Drizzle table object:

```typescript
import { deriveTable } from '@ontrails/store/drizzle';

// Input: Zod schema + persistence metadata
const gistsTable = deriveTable('gists', gistSchema, {
  primaryKey: 'id',
  generated: ['id', 'createdAt', 'updatedAt'],
  indexes: ['owner', 'createdAt'],
});

// Output: a real Drizzle table definition, equivalent to:
// sqliteTable('gists', {
//   id: text('id').primaryKey(),
//   owner: text('owner').notNull(),
//   description: text('description').notNull(),
//   isPublic: integer('is_public', { mode: 'boolean' }).default(true),
//   ...
// })
```

The derived table is a standard Drizzle table object. It works with Drizzle's query builder, `drizzle-kit` migrations, and Drizzle Studio. Nothing about it is Trails-specific. This means the developer can always eject from the derivation and hand-write a Drizzle table if needed.

### 3. `store()` composes `deriveTable` with provision lifecycle

The `store()` function from `@ontrails/store/drizzle` is the one-liner that produces a complete service:

```typescript
import { store } from '@ontrails/store/drizzle';

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
}, {
  // Connection options
  dialect: 'sqlite',               // or 'postgres'
  url: ':memory:',                  // or file path, or connection string
  // Optional: override mock behavior
  mock: {
    seed: async (conn) => {
      await conn.gists.insert({ owner: 'alice', description: 'Seed gist' });
    },
  },
});
```

Internally, `store()`:

1. Calls `deriveTable()` for each entity to produce Drizzle table definitions
2. Creates a Drizzle database instance with the derived schema
3. Wraps it in the typed accessor API from the Schema-Derived Persistence draft
4. Returns a provision-compatible object with `create`, `dispose`, `mock`, and `health`

### 4. SQLite-first, Postgres-second

The initial implementation targets SQLite (via `bun:sqlite` or `better-sqlite3`), matching the Stash dogfood's use case and the Trails ecosystem's Bun-native orientation. Postgres support follows using the same `store()` API with `dialect: 'postgres'`.

Dialect differences are handled internally:

| Concern | SQLite | Postgres |
| --- | --- | --- |
| Boolean columns | `integer` with mode: boolean | native `boolean` |
| Datetime columns | `text` (ISO 8601) | `timestamp` |
| UUID columns | `text` | native `uuid` |
| JSON columns | `text` (serialized) | `jsonb` |
| Enum columns | `text` with CHECK constraint | custom enum type |
| Auto-increment | `integer` primary key | `serial` or `identity` |
| FTS | FTS5 virtual table | `tsvector` + GIN index |
| Vector search | sqlite-vec extension | pgvector extension |

The dialect abstraction lives in the connector, not in `@ontrails/store` core. The store abstraction doesn't know about SQL dialects.

### 5. Migration support via drizzle-kit

The derived Drizzle tables work with `drizzle-kit` for migration generation:

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
import { getSchema } from '@ontrails/store/drizzle';
import { db } from './store';

export default defineConfig({
  schema: getSchema(db),  // exports the derived Drizzle tables
  dialect: 'sqlite',
  dbCredentials: { url: './data/stash.db' },
});
```

`getSchema(db)` exports the raw Drizzle table definitions so drizzle-kit can diff them against the database and generate migrations. The developer runs `drizzle-kit generate` and `drizzle-kit migrate` as normal. Trails does not own the migration lifecycle.

### 6. The escape hatch: `conn.query()` and `conn.drizzle`

For queries that the typed accessors don't cover (joins, aggregations, CTEs, subqueries), the connection exposes the underlying Drizzle instance:

```typescript
const conn = db.from(ctx);

// Named escape hatch: passes derived tables as arguments
const results = await conn.query(({ gists, files }) =>
  conn.drizzle
    .select({ gistId: gists.id, fileCount: sql`count(${files.id})` })
    .from(gists)
    .leftJoin(files, eq(files.gistId, gists.id))
    .groupBy(gists.id)
);

// Direct Drizzle access for maximum control
const raw = conn.drizzle;
```

The `conn.query()` helper provides the derived tables as named parameters so the developer doesn't have to import them separately. The `conn.drizzle` property is the raw Drizzle database instance for complete control.

### 7. Transaction support

Write operations can be wrapped in transactions:

```typescript
blaze: async (input, ctx) => {
  const conn = db.from(ctx);
  
  return conn.transaction(async (tx) => {
    const gist = await tx.gists.insert(input);
    for (const file of input.files) {
      await tx.files.insert({ ...file, gistId: gist.id });
    }
    return Result.ok(gist);
  });
}
```

The `tx` object has the same typed accessors as `conn`, but all operations run within a single database transaction. If any operation throws or returns `Result.err`, the transaction is rolled back.

For SQLite, transactions use `BEGIN IMMEDIATE` by default (serializable). For Postgres, the isolation level is configurable.

## Consequences

### Positive

- **Drizzle handles what Drizzle is good at.** Query building, connection pooling, migration generation, SQL dialect differences. Trails doesn't reinvent any of this.
- **The escape hatch is Drizzle's query builder.** Developers who know Drizzle can drop down to it at any point. No learning a Trails-specific query language. No abstraction cliff.
- **drizzle-kit works as-is.** Migration tooling, Drizzle Studio, and the Drizzle ecosystem all work because the derived tables are standard Drizzle table objects.
- **SQLite and Postgres from day one.** The same `store()` API works for both dialects. An app can start with SQLite (zero infrastructure) and move to Postgres (production scale) by changing the dialect and connection string.

### Tradeoffs

- **Drizzle is a peer dependency.** The developer must install Drizzle alongside `@ontrails/store`. This is the same pattern as Commander for CLI, but it's an additional dependency. Developers who want zero ORM dependencies would need a future raw `bun:sqlite` connector.
- **The Zod-to-Drizzle mapping is a new trailhead.** If Drizzle changes its column builder API, the mapping needs to be updated. The mapping is small and the Drizzle API is stable, but it's a maintenance trailhead.
- **Complex schemas may need column overrides.** The automatic Zod-to-SQL mapping handles the common cases. Unusual column types (PostGIS geometry, custom domains, composite types) require explicit overrides.

### What this does NOT decide

- Whether to ship a raw `bun:sqlite` connector without Drizzle. Possible future work for zero-dependency use cases.
- How FTS and vector search integrate with the Drizzle connector. That's the Declarative Search draft.
- Whether `conn.query()` returns typed results or `unknown`. The Drizzle query builder provides its own type inference; Trails should not duplicate it.

## References

- ADR: Schema-Derived Persistence (draft) -- the abstract store model this connector implements
- [ADR-0009: Services](../0009-first-class-provisions.md) -- the provision lifecycle the store produces
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- trailheads as thin wrappers, same pattern for store
- Drizzle ORM documentation: <https://orm.drizzle.team>
