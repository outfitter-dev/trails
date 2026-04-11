---
id: 22
slug: drizzle-store-connector
title: Drizzle Binds Schema-Derived Stores to SQLite
status: accepted
created: 2026-04-01
updated: 2026-04-03
owners: ['[galligan](https://github.com/galligan)']
depends_on: [16, 9]
---

# ADR-0022: Drizzle Binds Schema-Derived Stores to SQLite

## Context

[ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) defines the store model: the root package owns the durable `store(...)` declaration, and connectors bind that declaration to a concrete runtime later.

That leaves one practical decision open: what should the first concrete connector be?

The connector should stay subordinate to the root `store(...)` declaration. It should not replace the authored primitive, introduce a second schema language, or force developers to step outside the same contract-first shape the rest of Trails uses.

The first connector also needs to be useful enough for real application work and for framework dogfooding:

- bind a store definition to a concrete resource
- derive real database tables from the authored schema
- expose typed CRUD accessors
- provide a truthful escape hatch for complex queries
- supply mock and fixture behavior so `testAll(app)` keeps working

Three options were considered:

**Raw `bun:sqlite`.** Small and direct, but it would push query composition, schema projection, and fixture ergonomics back onto the application too early.

**Prisma.** Powerful, but built around a separate schema DSL and generation step. That conflicts with the root decision that the authored Zod schema is the source of truth.

**Drizzle.** TypeScript-native, close to SQL, lightweight, Bun-friendly, and comfortable as an escape hatch without introducing a second authored schema.

Drizzle is the best first connector. It keeps the store story honest: the developer authors one schema-first contract, and the connector projects it into a runnable SQLite store.

## Decision

### Lives at `@ontrails/with-drizzle`

The first concrete connector lives in its own workspace package:

```typescript
import { connectDrizzle } from '@ontrails/with-drizzle';
```

This follows the same architectural pattern as trailhead connectors. The root package owns the connector-agnostic model. The `with-*` package binds it to a concrete runtime.

> Originally shipped as the `@ontrails/store/drizzle` subpath; [ADR-0029](./0029-connector-extraction-and-the-with-packaging-model.md) promoted connectors to their own workspace packages.

### The root package keeps the durable `store(...)` primitive

The root `@ontrails/store` package continues to own the authored primitive:

```typescript
import { store } from '@ontrails/store';

const definition = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
  },
});
```

The Drizzle connector binds that definition later:

```typescript
import { connectDrizzle } from '@ontrails/with-drizzle';

export const db = connectDrizzle(definition, {
  id: 'db.main',
  url: ':memory:',
});
```

This keeps non-Drizzle connectors first-class from the beginning. The developer does not have to author a Drizzle-specific store definition just to use the framework's persistence model.

### The connector exports both binding APIs and one-line conveniences

The connector exports two primary binding functions:

- `connectDrizzle(definition, options)` for writable bindings
- `connectReadOnlyDrizzle(definition, options)` for read-only bindings

It also exports convenience wrappers that collapse declaration plus binding into one call:

- `store(tables, options)` for writable bindings
- `readonlyStore(tables, options)` for read-only bindings

Those convenience functions are projections. They are ergonomics, not the architectural source of truth.

### SQLite-first and Bun-native

The shipped Drizzle connector targets SQLite through Bun's native SQLite runtime.

That means the current connector decides:

- Bun SQLite is the first production path
- store fixtures and mocks run against SQLite too
- the derived table projection is SQLite-specific today

It does **not** decide that every future connector must use SQLite. It only decides the first concrete implementation.

### The connector binds stores as resources

A bound Drizzle store is a Trails resource. It exposes:

- `create` to open the SQLite database and ensure the derived schema exists
- `dispose` to close the client
- `mock` to build an in-memory store seeded from definition fixtures and optional connector-level seed data
- `health` to verify the underlying client is alive

That means a connector-bound store can participate in trails exactly like any other resource:

```typescript
trail('gist.list', {
  resources: [db],
  blaze: async (_input, ctx) => {
    const conn = db.from(ctx);
    return Result.ok(await conn.gists.list());
  },
});
```

### The default surface is typed CRUD plus a connector-native escape hatch

The connection exposes typed accessors derived from the store definition:

- `insert`
- `get`
- `list`
- `update`
- `remove`

When those are not enough, the connector exposes `query()`:

```typescript
const rows = await conn.query(({ drizzle, tables }) =>
  drizzle
    .select()
    .from(tables.gists)
);
```

The escape hatch is honest. Trails does not invent a second query language. It hands the developer the native Drizzle query builder and the derived tables that already back the store.

### Raw schema access stays available

The connector exports `getSchema(binding)` so tooling can access the derived Drizzle tables directly:

```typescript
import { getSchema } from '@ontrails/with-drizzle';

const schema = getSchema(db);
```

This keeps external tooling such as migration workflows or local inspection aligned with the same derived schema the runtime uses.

## Consequences

### Positive

- **One authored persistence model.** The root `store(...)` definition remains the only thing the developer has to author.
- **No second schema language.** The connector consumes the same Zod-first contract the rest of Trails already uses.
- **The happy path is typed and small.** Most application code uses the generated CRUD accessors.
- **The escape hatch is already familiar.** Complex queries use Drizzle itself instead of a Trails-specific abstraction.
- **Testing stays first-class.** Connector-bound stores participate in resource mocks and fixture seeding, so contract testing still works without ceremony.

### Tradeoffs

- **The first connector is SQLite-specific.** Postgres and other runtimes remain future work.
- **Drizzle becomes an important peer dependency.** The connector gains the normal maintenance cost of an external library integration.
- **The connector owns the Zod-to-SQLite projection.** If Drizzle's table APIs change, the connector needs to adapt.

### Non-decisions

- Whether to add a future raw `bun:sqlite` connector
- Whether to add a future Postgres connector
- Whether to expose transaction helpers as part of the connector surface
- How search, FTS, or vector access should layer onto stores

## References

- [ADR-0016: Schema-Derived Persistence](0016-schema-derived-persistence.md) — the root store model this connector binds
- [ADR-0009: First-Class Resources](0009-first-class-resources.md) — the resource lifecycle a bound store participates in
- [docs/tenets.md](../tenets.md) — governing design principles for derived, queryable, contract-first systems
- Drizzle ORM documentation: <https://orm.drizzle.team>
