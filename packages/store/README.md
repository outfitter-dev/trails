# @ontrails/store

Schema-derived persistence for Trails.

The root package owns the connector-agnostic `store(...)` declaration. External connector packages such as `@ontrails/with-drizzle` bind that declaration to a concrete runtime, and first-party built-ins such as `@ontrails/store/jsonfile` live as opt-in subpaths on the same package.

## The two layers

### 1. Declare the store contract

```typescript
import { store } from '@ontrails/store';

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
});
```

This declaration is pure metadata:

- full entity schema
- insert schema
- update schema
- fixture schema
- generated-field metadata
- indexes
- references

No database connection is opened here. The returned value is the durable authored source of truth.

### 2. Bind it to a concrete runtime

```typescript
import { store } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/with-drizzle';

const definition = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
  },
});

export const db = connectDrizzle(definition, {
  id: 'db.main',
  url: ':memory:',
});
```

The bound store is a resource. Use it directly in trails:

```typescript
export const list = trail('gist.list', {
  resources: [db],
  intent: 'read',
  blaze: async (_input, ctx) => {
    const conn = db.from(ctx);
    const gists = await conn.gists.list();
    return Result.ok(gists);
  },
});
```

## Typed accessors

Every table on a bound connection exposes typed CRUD accessors:

```typescript
const conn = db.from(ctx);

const created = await conn.gists.insert({
  owner: 'matt',
  description: 'Hello, Trails',
});

const found = await conn.gists.get(created.id);
const page = await conn.gists.list({ owner: 'matt' }, { limit: 20, offset: 0 });
const updated = await conn.gists.update(created.id, {
  description: 'Updated description',
});
const removed = await conn.gists.remove(created.id);
```

Types are derived from the Zod schema:

- `insert()` uses the entity schema minus generated fields
- `update()` uses the entity schema minus generated fields, then makes it partial
- `get()` returns `Entity | null`
- `list()` accepts typed partial filters and pagination options

## Fixtures and mocks

Fixtures belong on the root definition:

```typescript
export const db = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    fixtures: [
      { id: 'g_1', owner: 'matt', description: 'Seed gist' },
    ],
  },
});
```

When a connector binds the store, those fixtures feed the resource mock automatically. Connector options can also add or override seed data for tests.

That means `testAll(app)` can auto-resolve connector-bound store resources without extra ceremony, as long as the resource is registered in the topo.

## Read-only bindings

Use the Drizzle connector's read-only helpers when a trail should inspect persisted state without exposing writes:

```typescript
import { connectReadOnlyDrizzle, readonlyStore } from '@ontrails/with-drizzle';

const analytics = connectReadOnlyDrizzle(definition, {
  id: 'analytics.db',
  url: './data/analytics.sqlite',
});

const auditLog = readonlyStore(
  {
    entries: {
      schema: auditEntrySchema,
      primaryKey: 'id',
      generated: ['id', 'createdAt'],
    },
  },
  { id: 'audit.db', url: './data/audit.sqlite' }
);
```

Read-only bindings expose `get()`, `list()`, and `query()`, but not `insert()`, `update()`, or `remove()`.

## Drizzle escape hatch

Complex queries use the connector-native query builder through `query()`:

```typescript
const conn = db.from(ctx);

const rows = await conn.query(({ drizzle, tables }) =>
  drizzle
    .select()
    .from(tables.gists)
);
```

This keeps the default happy path derived and typed, while still giving you full access to the underlying connector when the CRUD accessors are not enough.

## Connector conveniences

`@ontrails/with-drizzle` also exports one-line conveniences when you want declaration and binding together:

```typescript
import { store, readonlyStore } from '@ontrails/with-drizzle';

export const writable = store(
  {
    gists: {
      schema: gistSchema,
      primaryKey: 'id',
      generated: ['id', 'createdAt', 'updatedAt'],
    },
  },
  { url: ':memory:' }
);

export const readonly = readonlyStore(
  {
    gists: {
      schema: gistSchema,
      primaryKey: 'id',
      generated: ['id', 'createdAt', 'updatedAt'],
    },
  },
  { url: './data/gists.sqlite' }
);
```

These are conveniences, not the architectural source of truth. The root package still owns the durable authored `store(...)` model.

## Schema export for external tooling

If you need the raw derived Drizzle tables for tooling such as `drizzle-kit`, use `getSchema()`:

```typescript
import { getSchema } from '@ontrails/with-drizzle';

const schema = getSchema(db);
```

## Installation

```bash
bun add @ontrails/store zod
```

Add Drizzle only when you want the external SQLite/ORM connector:

```bash
bun add @ontrails/with-drizzle
```

## Migration

The Drizzle binding now lives in `@ontrails/with-drizzle`.

- Replace `import { ... } from '@ontrails/store/drizzle'` with `import { ... } from '@ontrails/with-drizzle'`
- Keep connector-agnostic store declarations on `@ontrails/store`
