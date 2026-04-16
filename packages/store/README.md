# @ontrails/store

Schema-derived persistence for Trails.

The root package owns the connector-agnostic `store(...)` declaration. External connector packages such as `@ontrails/drizzle` bind that declaration to a concrete runtime, and first-party built-ins such as `@ontrails/store/jsonfile` live as opt-in subpaths on the same package.

## The two layers

### 1. Declare the store contract

```typescript
import { store } from '@ontrails/store';

export const db = store({
  gists: {
    schema: gistSchema,
    identity: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    indexed: ['owner', 'createdAt'],
    versioned: true,
  },
  files: {
    schema: fileSchema,
    identity: 'id',
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
- derived change signals (`table.signals.created|updated|removed`)
- identity field
- generated-field metadata
- optional framework-managed version tracking
- indexed markers
- references

No database connection is opened here. The returned value is the durable authored source of truth.

### 2. Bind it to a concrete runtime

```typescript
import { store } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/drizzle';

const definition = store({
  gists: {
    schema: gistSchema,
    identity: 'id',
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

### Built-in local backend

For a zero-extra-package local backend, use the first-party JSON file binding:

```typescript
import { store } from '@ontrails/store';
import { jsonFile } from '@ontrails/store/jsonfile';

const definition = store({
  gists: {
    schema: gistSchema,
    identity: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
  },
});

export const db = jsonFile(definition, {
  dir: './data',
});
```

## Typed accessors

Every writable table on a bound connection exposes the connector-agnostic accessor contract:

```typescript
const conn = db.from(ctx);

const created = await conn.gists.upsert({
  ownerId: 'matt',
  description: 'Hello, Trails',
});

const found = await conn.gists.get(created.id);
const page = await conn.gists.list({ ownerId: 'matt' }, { limit: 20, offset: 0 });
const updated = await conn.gists.upsert({
  description: 'Updated description',
  id: created.id,
  ownerId: 'matt',
});
const removed = await conn.gists.remove(created.id);
```

Types are derived from the Zod schema:

- `upsert()` uses the fixture/entity shape with generated fields optional
- `get()` returns `Entity | null`
- `list()` accepts typed partial filters and pagination options
- `versioned: true` adds a framework-managed `version` field to returned entities and lets `upsert()` accept an expected `version` for optimistic concurrency

Each normalized table also derives typed change signals from the same schema:

```typescript
const created = definition.tables.gists.signals.created;
const updated = definition.tables.gists.signals.updated;
const removed = definition.tables.gists.signals.removed;
```

Writable bindings fire those signals automatically when you access the resource through `db.from(ctx)` inside a trail context.

Tabular connectors such as `@ontrails/drizzle` also expose `insert()` and `update()` as convenience methods when the backend natively distinguishes create and patch operations.

## Fixtures and mocks

Fixtures belong on the root definition:

```typescript
export const db = store({
  gists: {
    schema: gistSchema,
    identity: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    fixtures: [
      { id: 'g_1', ownerId: 'matt', description: 'Seed gist' },
    ],
  },
});
```

When a connector binds the store, those fixtures feed the resource mock automatically. Connector options can also add or override seed data for tests.

That means `testAll(app)` can auto-resolve connector-bound store resources without extra ceremony, as long as the resource is registered in the topo.

## Read-only bindings

Use the Drizzle connector's read-only helpers when a trail should inspect persisted state without exposing writes:

```typescript
import { connectReadOnlyDrizzle, readonlyStore } from '@ontrails/drizzle';

const analytics = connectReadOnlyDrizzle(definition, {
  id: 'analytics.db',
  url: './data/analytics.sqlite',
});

const auditLog = readonlyStore(
  {
    entries: {
      schema: auditEntrySchema,
      identity: 'id',
      generated: ['id', 'createdAt'],
    },
  },
  { id: 'audit.db', url: './data/audit.sqlite' }
);
```

Read-only bindings expose `get()`, `list()`, and `query()`, but not `upsert()`, `remove()`, `insert()`, or `update()`.

## Accessor contract testing

Connectors can reuse the shared writable-accessor contract tests from `@ontrails/store/testing`:

```typescript
import { createStoreAccessorContractCases } from '@ontrails/store/testing';
```

That helper provides reusable cases for the baseline `get()`, `list()`, `upsert()`, and `remove()` behavior so connector suites only need to wrap them with their normal `test(...)` calls and add backend-specific coverage on top.

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

`@ontrails/drizzle` also exports one-line conveniences when you want declaration and binding together:

```typescript
import { store, readonlyStore } from '@ontrails/drizzle';

export const writable = store(
  {
    gists: {
      schema: gistSchema,
      identity: 'id',
      generated: ['id', 'createdAt', 'updatedAt'],
    },
  },
  { url: ':memory:' }
);

export const readonly = readonlyStore(
  {
    gists: {
      schema: gistSchema,
      identity: 'id',
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
import { getSchema } from '@ontrails/drizzle';

const schema = getSchema(db);
```

## Installation

```bash
bun add @ontrails/store zod
```

Add Drizzle only when you want the external SQLite/ORM connector:

```bash
bun add @ontrails/drizzle
```

## Migration

The Drizzle binding now lives in `@ontrails/drizzle`.

- Replace `import { ... } from '@ontrails/store/drizzle'` with `import { ... } from '@ontrails/drizzle'`
- Keep connector-agnostic store declarations on `@ontrails/store`
