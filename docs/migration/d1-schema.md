# D1 schema migrations

D1 store connections now assume their physical tables already exist. `connectD1()` and `cloudflareD1()` perform no schema creation or automatic runtime seeding by default. Apply reviewed SQL before running code that needs it. This changes the previous lazy-bootstrap default.

`renderD1SchemaSql()` renders the initial physical layout from a store definition. It produces deterministic, create-only SQL in sorted table order, with quoted identifiers and `id TEXT PRIMARY KEY`, `entity TEXT NOT NULL`, and nullable `version INTEGER` columns. It does not compare existing databases, infer an upgrade sequence, transform JSON entities, or apply SQL. Wrangler owns migration files, application, and history through its existing [D1 migration workflow](https://developers.cloudflare.com/d1/reference/migrations/).

## Initial production schema

Keep the runtime binding and SQL prefix on the same authored options. A direct `connectD1()` connection defaults to prefix `store`; a `cloudflareD1()` resource defaults to its resource id. An explicit `tablePrefix` overrides either default. Multiple resources in one database need distinct resolved prefixes.

```ts
// src/database.ts
import { cloudflareD1 } from '@ontrails/cloudflare/d1';
import type { CloudflareD1Options } from '@ontrails/cloudflare/d1';
import { definition } from './store.js';

export const databaseOptions: CloudflareD1Options<typeof definition> = {
  binding: 'DB',
  id: 'notes.store',
};
export const db = cloudflareD1(definition, databaseOptions);
```

Create a versioned migration with Wrangler, then put the reviewed renderer output in that migration file:

```sh
bunx wrangler d1 migrations create DB initial_store
```

```ts
// An app-owned, explicit SQL export step; the renderer itself performs no I/O.
import { renderD1SchemaSql } from '@ontrails/cloudflare/d1';
import { db, databaseOptions } from './src/database.js';

console.log(renderD1SchemaSql(db.store, {
  tablePrefix: databaseOptions.tablePrefix ?? db.id,
}));
```

Use the filename Wrangler actually created. Review its contents and apply it to the local database:

```sh
bunx wrangler d1 migrations apply DB --local
```

Exercise the real app's CRUD against that local binding. An authorized operator then applies the same reviewed migration to the selected remote database before deploying code that requires it:

```sh
bunx wrangler d1 migrations apply DB --remote
```

These commands are an application workflow, not operations performed by the renderer or driver. Choose the correct Wrangler config/environment and database binding. See the [Wrangler D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1) for migration creation and local/remote selection.

## Later schema and data changes

Keep applied migration files immutable. Add a new migration for each later change. For example, an authored migration can add a newly introduced physical store table:

```sql
CREATE TABLE "notes.store.archive" (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  version INTEGER
);
```

The initial renderer is not a schema-diff planner. Rendering the expanded store can show its full baseline, but does not identify which statements are new, validate old columns, or author an upgrade for you. Review the new migration explicitly and test it against a populated copy of the prior schema.

Entity fields are stored inside JSON. Changing a Zod field does not imply an `ALTER TABLE` or transform stored rows. Renames, removals, backfills and identity changes need authored schema/data operations. Runtime seeds are not a production migration mechanism. Secondary indexes remain separate work; this change does not add indexes or claim that indexes accelerate the driver's current JavaScript filtering.

## Adopt an existing lazy-created database

Retain the old resource id or explicit `tablePrefix`; changing it addresses different physical tables. Before adopting a baseline, inspect every physical table and verify its exact layout, key behavior and existing rows. For the example resource above:

```sql
PRAGMA table_info("notes.store.notes");
SELECT id, entity, version FROM "notes.store.notes" LIMIT 10;
```

The expected column facts are:

| Column | Type | NOT NULL | Primary key |
| --- | --- | --- | --- |
| `id` | `TEXT` | 0 | 1 |
| `entity` | `TEXT` | 1 | 0 |
| `version` | `INTEGER` | 0 | 0 |

Also review the actual table definition, constraints, indexes and row compatibility. The column list alone does not prove all schema and data invariants. Use your normal reviewed backup and migration process, and verify that existing rows remain readable and writable under the new app. The local native regression verifies the old bootstrap layout and preserved data before baseline adoption.

Only after confirming compatibility should the initial create-only SQL enter the migration history. Its `IF NOT EXISTS` statements leave compatible existing tables and rows in place. They do not check or repair incompatible tables: if layout differs, author and test the necessary explicit migration instead. Do not drop tables or overwrite user rows to make the baseline apply.

## Development and tests

For disposable local/test databases, opt into the previous lazy bootstrap explicitly:

```ts
const local = connectD1(definition, database, {
  autoCreate: true,
  seed: { notes: [{ id: 'example', body: 'local example' }] },
});
```

The same `autoCreate: true` option is available on `cloudflareD1()`. This is an explicit escape hatch; the library does not guess whether an env is production. Seeds require that opt-in and explicit stable identities, and remain insert-only so rematerialization cannot overwrite user edits. A configured runtime seed without `autoCreate: true` throws a `ValidationError` at connection/resource construction. Missing tables in the default path fail through the existing D1 error boundary, with no catch-and-create fallback.

Table fixtures and `mockSeed` keep their in-memory behavior without `autoCreate`; `testAll(app)` remains configuration-free. To upgrade existing tests that intentionally exercise lazy D1 bootstrap, add `autoCreate: true`. Production apps should instead remove runtime seeds, adopt/apply reviewed migrations, and use the default connection.
