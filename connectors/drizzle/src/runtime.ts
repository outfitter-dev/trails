import { Database } from 'bun:sqlite';
import {
  AlreadyExistsError,
  InternalError,
  Result,
  ValidationError,
  resource,
} from '@ontrails/core';
import { store as defineStore } from '@ontrails/store';
import type {
  AnyStoreDefinition,
  AnyStoreTable,
  EntityOf,
  FixtureInputOf,
  InsertOf,
  ReadOnlyStoreConnection,
  StoreAccessMode,
  StoreFieldKey,
  StoreIdentifierOf,
  StoreTableConnection,
  StoreTablesInput,
  UpsertOf,
  UpdateOf,
} from '@ontrails/store';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import {
  createSqliteSchemaStatements,
  describeField,
  deriveDrizzleTables,
} from './schema.js';
import type {
  ConnectDrizzleOptions,
  DrizzleMockSeed,
  DrizzleStoreConnection,
  DrizzleStoreResource,
  DrizzleStoreSchema,
  ReadOnlyDrizzleOptions,
  ReadOnlyDrizzleStoreConnection,
} from './types.js';

const defaultResourceId = 'store';
const connectionClients = new WeakMap<object, Database>();

const cloneValue = <T>(value: T): T => structuredClone(value);

const openSqliteDatabase = (url: string, readOnly: boolean): Database => {
  const client = new Database(
    url,
    readOnly ? { readonly: true } : { create: true }
  );
  client.run('PRAGMA foreign_keys = ON');

  if (!readOnly) {
    client.run('PRAGMA journal_mode = WAL');
    client.run('PRAGMA synchronous = NORMAL');
  }

  return client;
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const storeTableNames = <TStore extends AnyStoreDefinition>(
  definition: TStore
): readonly Extract<keyof TStore['tables'], string>[] =>
  definition.tableNames as readonly Extract<keyof TStore['tables'], string>[];

const registerConnection = <TConnection extends object>(
  connection: TConnection,
  client: Database
): TConnection => {
  connectionClients.set(connection, client);
  return connection;
};

const closeConnection = (connection: object): void => {
  connectionClients.get(connection)?.close();
  connectionClients.delete(connection);
};

const mapDatabaseError = (tableName: string, error: unknown): Error => {
  if (
    error instanceof ValidationError ||
    error instanceof AlreadyExistsError ||
    error instanceof InternalError
  ) {
    return error;
  }

  // ZodError from .parse() should surface as ValidationError, not InternalError.
  const resolved = asError(error);
  if (resolved.name === 'ZodError') {
    return new ValidationError(
      `Store table "${tableName}" input failed schema validation: ${resolved.message}`,
      { cause: resolved }
    );
  }
  if (resolved.message.includes('UNIQUE constraint failed')) {
    return new AlreadyExistsError(
      `Drizzle store insert for table "${tableName}" violated a uniqueness constraint`,
      { cause: resolved }
    );
  }

  if (resolved.message.includes('FOREIGN KEY constraint failed')) {
    return new ValidationError(
      `Drizzle store insert for table "${tableName}" violated a foreign key constraint`,
      { cause: resolved }
    );
  }

  return new InternalError(
    `Drizzle store encountered an unexpected error for table "${tableName}": ${resolved.message}`,
    { cause: resolved }
  );
};

const formatIssues = (
  issues: readonly { readonly message: string }[]
): string => issues.map((issue) => issue.message).join('; ');

const parseEntity = <TTable extends AnyStoreTable>(
  table: TTable,
  value: unknown
): EntityOf<TTable> => {
  const parsed = table.schema.safeParse(value);
  if (!parsed.success) {
    throw new InternalError(
      `Drizzle store for table "${table.name}" returned an entity that does not match the schema: ${formatIssues(parsed.error.issues)}`
    );
  }

  return parsed.data as EntityOf<TTable>;
};

const normalizeWriteInput = (
  input: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );

const baseFieldKind = <TTable extends AnyStoreTable>(
  table: TTable,
  field: StoreFieldKey<TTable['schema']>
): string =>
  describeField(
    field as string,
    table.schema.shape[field as keyof typeof table.schema.shape] as z.ZodType
  ).kind;

const TIMESTAMP_FIELD_NAMES = new Set([
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
]);

const ID_FIELD_SUFFIX_RE = /[Ii]d$/;

/**
 * Synthesize a value for a generated field during insert.
 *
 * The connector recognizes these conventions for generated fields:
 *
 * - **Primary key** (`integer` type): auto-increment, left to SQLite.
 * - **Timestamp fields** (`createdAt`, `updatedAt`, `created_at`,
 *   `updated_at`): materialized as `new Date()` (date type) or ISO 8601
 *   string (text type).
 * - **ID-like text fields** (name ends with `Id` or `id`): filled with
 *   `Bun.randomUUIDv7()`.
 *
 * Any other generated `text` field that does not match a recognized convention
 * throws a `ValidationError` — the developer must either supply a value or
 * give the field a Zod default.
 *
 * All other generated field types fall through to `undefined`, letting the
 * schema's Zod default (if any) apply during validation.
 */
const generatedTimestamp = (kind: string): unknown =>
  kind === 'date' ? new Date() : new Date().toISOString();

const generatedTextValue = (tableName: string, fieldName: string): unknown => {
  if (ID_FIELD_SUFFIX_RE.test(fieldName)) {
    return Bun.randomUUIDv7();
  }
  throw new ValidationError(
    `Store table "${tableName}" has a generated text field "${fieldName}" that does not match a recognized convention (timestamp or ID field). Supply a value or add a Zod default.`
  );
};

const generatedValueForInsert = <TTable extends AnyStoreTable>(
  table: TTable,
  field: StoreFieldKey<TTable['schema']>
): unknown => {
  const fieldName = field as string;
  const kind = baseFieldKind(table, field);

  if (field === table.primaryKey && kind === 'integer') {
    return undefined;
  }
  if (TIMESTAMP_FIELD_NAMES.has(fieldName)) {
    return generatedTimestamp(kind);
  }
  if (kind === 'text') {
    return generatedTextValue(table.name, fieldName);
  }
  throw new ValidationError(
    `Store table "${table.name}" has a generated field "${fieldName}" of unrecognized type "${kind}". Only "integer" (primary key), "text", and timestamp fields are supported as generated fields. Supply a value or add a Zod default.`
  );
};

const materializeGeneratedFields = <TTable extends AnyStoreTable>(
  table: TTable,
  input: Record<string, unknown>
): Record<string, unknown> => {
  const next = { ...input };

  for (const field of table.generated) {
    if (next[field] !== undefined) {
      continue;
    }

    const generated = generatedValueForInsert(
      table,
      field as StoreFieldKey<TTable['schema']>
    );
    if (generated !== undefined) {
      next[field] = generated;
    }
  }

  return next;
};

const validateFixturePayload = <TTable extends AnyStoreTable>(
  table: TTable,
  input: Record<string, unknown>
): Record<string, unknown> => {
  const parsed = table.fixtureSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Store table "${table.name}" insert payload is invalid after generated-field materialization: ${formatIssues(parsed.error.issues)}`
    );
  }

  return normalizeWriteInput(parsed.data as Record<string, unknown>);
};

const applyGeneratedInsertFields = <TTable extends AnyStoreTable>(
  table: TTable,
  input: Record<string, unknown>
): Record<string, unknown> =>
  validateFixturePayload(table, materializeGeneratedFields(table, input));

const applyGeneratedUpdateFields = <TTable extends AnyStoreTable>(
  table: TTable,
  input: Record<string, unknown>
): Record<string, unknown> => {
  const updatedAtKey = (['updatedAt', 'updated_at'] as const).find((key) =>
    table.generated.includes(key as StoreFieldKey<TTable['schema']>)
  );

  if (!updatedAtKey) {
    return normalizeWriteInput(input);
  }

  const kind = baseFieldKind(
    table,
    updatedAtKey as StoreFieldKey<TTable['schema']>
  );

  return normalizeWriteInput({
    ...input,
    [updatedAtKey]:
      input[updatedAtKey] ??
      (kind === 'date' ? new Date() : new Date().toISOString()),
  });
};

interface VisitFrame {
  readonly expanded: boolean;
  readonly tableName: string;
}

const ensureNotCyclic = (
  visiting: ReadonlySet<string>,
  tableName: string
): void => {
  if (!visiting.has(tableName)) {
    return;
  }

  throw new ValidationError(
    `Store definition contains a reference cycle involving "${tableName}", which the SQLite connector cannot seed automatically`
  );
};

const pushVisitDependencies = (
  stack: VisitFrame[],
  definition: AnyStoreDefinition,
  visited: ReadonlySet<string>,
  tableName: string
): void => {
  const table = definition.tables[tableName];
  if (table === undefined) {
    return;
  }

  for (const target of Object.values(table.references).toReversed()) {
    if (target !== undefined && !visited.has(target)) {
      stack.push({ expanded: false, tableName: target });
    }
  }
};

const finishVisitFrame = (
  frame: VisitFrame,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: string[]
): void => {
  visiting.delete(frame.tableName);
  visited.add(frame.tableName);
  ordered.push(frame.tableName);
};

const startVisitFrame = (
  stack: VisitFrame[],
  definition: AnyStoreDefinition,
  visiting: Set<string>,
  visited: Set<string>,
  tableName: string
): void => {
  ensureNotCyclic(visiting, tableName);
  visiting.add(tableName);
  stack.push({ expanded: true, tableName });
  pushVisitDependencies(stack, definition, visited, tableName);
};

const visitTableForSeeding = (
  definition: AnyStoreDefinition,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: string[],
  tableName: string
): void => {
  const stack: VisitFrame[] = [{ expanded: false, tableName }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }

    if (frame.expanded) {
      finishVisitFrame(frame, visiting, visited, ordered);
      continue;
    }

    if (!visited.has(frame.tableName)) {
      startVisitFrame(stack, definition, visiting, visited, frame.tableName);
    }
  }
};

const topologicalTableOrder = (
  definition: AnyStoreDefinition
): readonly string[] => {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];

  for (const tableName of definition.tableNames) {
    visitTableForSeeding(definition, visiting, visited, ordered, tableName);
  }

  return Object.freeze(ordered);
};

const ensureSqliteSchema = (
  client: Database,
  definition: AnyStoreDefinition
): void => {
  for (const statement of createSqliteSchemaStatements(definition)) {
    client.run(statement);
  }
};

const primaryKeyColumn = (
  table: AnySQLiteTable,
  field: string
): AnySQLiteColumn => table[field as keyof typeof table] as AnySQLiteColumn;

const buildFilterConditions = (
  drizzleTable: AnySQLiteTable,
  filters: Record<string, unknown> | undefined
): ReturnType<typeof eq>[] =>
  filters === undefined
    ? []
    : Object.entries(filters)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) =>
          eq(primaryKeyColumn(drizzleTable, field), value as never)
        );

const createReadOnlyAccessor = <
  TStore extends AnyStoreDefinition,
  TName extends keyof TStore['tables'] & string,
>(
  definitionTable: TStore['tables'][TName],
  drizzleTable: DrizzleStoreSchema<TStore>[TName],
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>
): ReadOnlyStoreConnection<TStore>[TName] => ({
  get(id) {
    try {
      const row = db
        .select()
        .from(drizzleTable)
        .where(
          eq(
            primaryKeyColumn(drizzleTable, definitionTable.primaryKey),
            id as never
          )
        )
        .get();

      return Promise.resolve(
        row === null || row === undefined
          ? null
          : cloneValue(parseEntity(definitionTable, row))
      );
    } catch (error) {
      return Promise.reject(mapDatabaseError(definitionTable.name, error));
    }
  },
  list(filters, options) {
    try {
      const conditions = buildFilterConditions(
        drizzleTable,
        filters as Record<string, unknown> | undefined
      );
      const base = db.select().from(drizzleTable).$dynamic();
      const filtered =
        conditions.length > 0 ? base.where(and(...conditions)) : base;
      const rows = filtered
        .limit(options?.limit ?? -1)
        .offset(options?.offset ?? 0)
        .all();

      return Promise.resolve(
        rows.map((row) => cloneValue(parseEntity(definitionTable, row)))
      );
    } catch (error) {
      return Promise.reject(mapDatabaseError(definitionTable.name, error));
    }
  },
});

const createWritableAccessor = <
  TStore extends AnyStoreDefinition,
  TName extends keyof TStore['tables'] & string,
>(
  definitionTable: TStore['tables'][TName],
  drizzleTable: DrizzleStoreSchema<TStore>[TName],
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>
): StoreTableConnection<TStore>[TName] => {
  type Table = TStore['tables'][TName];
  type Identifier = StoreIdentifierOf<Table>;

  const findRowById = (id: Identifier): Record<string, unknown> | undefined =>
    db
      .select()
      .from(drizzleTable)
      .where(
        eq(
          primaryKeyColumn(drizzleTable, definitionTable.primaryKey),
          id as never
        )
      )
      .get() as Record<string, unknown> | undefined;

  const readEntity = (id: Identifier): EntityOf<Table> | null => {
    const existing = findRowById(id);

    return existing === undefined
      ? null
      : (cloneValue(parseEntity(definitionTable, existing)) as EntityOf<Table>);
  };

  const insertEntity = (input: Record<string, unknown>): EntityOf<Table> => {
    const row = db
      .insert(drizzleTable)
      .values(applyGeneratedInsertFields(definitionTable, input) as never)
      .returning()
      .get();

    return cloneValue(parseEntity(definitionTable, row)) as EntityOf<Table>;
  };

  const updateEntity = (
    id: Identifier,
    input: Record<string, unknown>
  ): EntityOf<Table> | null => {
    const userFields = normalizeWriteInput(input);
    if (Object.keys(userFields).length === 0) {
      throw new ValidationError(
        `Store table "${definitionTable.name}" update requires at least one field to set.`
      );
    }

    const fields = applyGeneratedUpdateFields(definitionTable, userFields);
    const row = db
      .update(drizzleTable)
      .set(fields as never)
      .where(
        eq(
          primaryKeyColumn(drizzleTable, definitionTable.primaryKey),
          id as never
        )
      )
      .returning()
      .get();

    return row === undefined
      ? null
      : (cloneValue(parseEntity(definitionTable, row)) as EntityOf<Table>);
  };

  const patchFromUpsert = (
    input: Record<string, unknown>
  ): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(input).filter(
        ([field, value]) =>
          field !== definitionTable.identity && value !== undefined
      )
    );

  const upsertEntity = (input: Record<string, unknown>): EntityOf<Table> => {
    const identifier = input[definitionTable.identity] as
      | Identifier
      | undefined;

    if (identifier === undefined) {
      return insertEntity(input);
    }

    const patch = patchFromUpsert(input);
    if (Object.keys(patch).length === 0) {
      return readEntity(identifier) ?? insertEntity(input);
    }

    return updateEntity(identifier, patch) ?? insertEntity(input);
  };

  return {
    ...createReadOnlyAccessor(definitionTable, drizzleTable, db),
    insert(input) {
      try {
        const parsed = definitionTable.insertSchema.parse(
          input
        ) as InsertOf<Table>;

        return Promise.resolve(insertEntity(parsed as Record<string, unknown>));
      } catch (error) {
        return Promise.reject(mapDatabaseError(definitionTable.name, error));
      }
    },
    remove(id) {
      try {
        const deleted = db
          .delete(drizzleTable)
          .where(
            eq(
              primaryKeyColumn(drizzleTable, definitionTable.primaryKey),
              id as never
            )
          )
          .returning({
            deletedId: primaryKeyColumn(
              drizzleTable,
              definitionTable.primaryKey
            ),
          })
          .get();

        return Promise.resolve({ deleted: deleted !== undefined });
      } catch (error) {
        return Promise.reject(mapDatabaseError(definitionTable.name, error));
      }
    },
    update(id, input) {
      try {
        const parsed = definitionTable.updateSchema.parse(
          input
        ) as UpdateOf<Table>;

        return Promise.resolve(
          updateEntity(id as Identifier, parsed as Record<string, unknown>)
        );
      } catch (error) {
        return Promise.reject(mapDatabaseError(definitionTable.name, error));
      }
    },
    upsert(input) {
      try {
        const parsed = definitionTable.fixtureSchema.parse(
          input
        ) as UpsertOf<Table>;
        const normalized = normalizeWriteInput(
          parsed as Record<string, unknown>
        );

        return Promise.resolve(upsertEntity(normalized));
      } catch (error) {
        return Promise.reject(mapDatabaseError(definitionTable.name, error));
      }
    },
  };
};

/** Collect non-empty fixture arrays keyed by table name. */
const collectFixtures = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  seed?: DrizzleMockSeed<TStore>
): Map<string, readonly FixtureInputOf<AnyStoreTable>[]> => {
  const result = new Map<string, readonly FixtureInputOf<AnyStoreTable>[]>();
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    if (table === undefined) {
      continue;
    }
    const fixtures =
      (seed?.[tableName] as
        | readonly FixtureInputOf<typeof table>[]
        | undefined) ?? table.fixtures;
    if (fixtures.length > 0) {
      result.set(tableName, fixtures);
    }
  }
  return result;
};

/** Insert fixture rows in topological order. */
const insertFixtureRows = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  tables: DrizzleStoreSchema<TStore>,
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>,
  fixturesByTable: Map<string, readonly FixtureInputOf<AnyStoreTable>[]>
): void => {
  for (const tableName of topologicalTableOrder(definition)) {
    const defTable = definition.tables[tableName];
    const drizzleTable = tables[tableName];
    const fixtures = fixturesByTable.get(tableName);
    if (!defTable || !drizzleTable || !fixtures) {
      continue;
    }
    for (const fixture of fixtures) {
      db.insert(drizzleTable)
        .values(
          applyGeneratedInsertFields(
            defTable,
            fixture as Record<string, unknown>
          ) as never
        )
        .run();
    }
  }
};

const seedFixtures = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  tables: DrizzleStoreSchema<TStore>,
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>,
  seed?: DrizzleMockSeed<TStore>
): void => {
  const fixturesByTable = collectFixtures(definition, seed);
  if (fixturesByTable.size === 0) {
    return;
  }
  insertFixtureRows(definition, tables, db, fixturesByTable);
};

const createReadOnlyConnection = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  tables: DrizzleStoreSchema<TStore>,
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>,
  client: Database
): ReadOnlyDrizzleStoreConnection<TStore> => {
  const connection = {
    async query(run) {
      return await run({ drizzle: db, tables });
    },
  } as ReadOnlyDrizzleStoreConnection<TStore>;

  for (const tableName of storeTableNames(definition)) {
    const definitionTable = definition.tables[tableName];
    const drizzleTable = tables[tableName];
    if (definitionTable === undefined || drizzleTable === undefined) {
      continue;
    }

    Object.defineProperty(connection, tableName, {
      enumerable: true,
      value: createReadOnlyAccessor(
        definitionTable as TStore['tables'][typeof tableName],
        drizzleTable,
        db
      ),
    });
  }

  return Object.freeze(
    registerConnection(connection, client)
  ) as ReadOnlyDrizzleStoreConnection<TStore>;
};

const createWritableConnection = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  tables: DrizzleStoreSchema<TStore>,
  db: ReturnType<typeof drizzle<DrizzleStoreSchema<TStore>>>,
  client: Database
): DrizzleStoreConnection<TStore> => {
  const connection = {
    async query(run) {
      return await run({ drizzle: db, tables });
    },
  } as DrizzleStoreConnection<TStore>;

  for (const tableName of storeTableNames(definition)) {
    const definitionTable = definition.tables[tableName];
    const drizzleTable = tables[tableName];
    if (definitionTable === undefined || drizzleTable === undefined) {
      continue;
    }

    Object.defineProperty(connection, tableName, {
      enumerable: true,
      value: createWritableAccessor(
        definitionTable as TStore['tables'][typeof tableName],
        drizzleTable,
        db
      ),
    });
  }

  return Object.freeze(
    registerConnection(connection, client)
  ) as DrizzleStoreConnection<TStore>;
};

const buildResourceShape = <
  TStore extends AnyStoreDefinition,
  TConnection,
  TAccess extends StoreAccessMode,
>(
  value: ReturnType<typeof resource<TConnection>>,
  store: TStore,
  tables: DrizzleStoreSchema<TStore>,
  access: TAccess
): DrizzleStoreResource<TStore, TConnection, TAccess> =>
  Object.freeze({
    ...value,
    access,
    store,
    tables,
  });

const connectionHealth = (
  connection: object
): Result<{ readonly ok: true }, Error> => {
  const client = connectionClients.get(connection);
  if (client === undefined) {
    return Result.err(
      new InternalError('Drizzle store connection is missing its SQLite client')
    );
  }

  try {
    client.query('SELECT 1').get();
    return Result.ok({ ok: true });
  } catch (error) {
    return Result.err(asError(error));
  }
};

/**
 * Bind a store definition to a Drizzle-backed SQLite resource.
 *
 * The returned resource manages its own connection lifecycle. The `mock()`
 * factory creates an in-memory SQLite database seeded with fixtures — callers
 * who obtain a mock connection are responsible for calling `closeConnection()`
 * when done, or letting the connection be garbage-collected (the underlying
 * `Database` client is tracked via `WeakMap`).
 *
 * Note: the `search` field on `StoreTableInput` is not yet interpreted by
 * this connector — it is reserved for future full-text search support.
 */
export const connectDrizzle = <const TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: ConnectDrizzleOptions<TStore>
): DrizzleStoreResource<
  TStore,
  DrizzleStoreConnection<TStore>,
  'readwrite'
> => {
  const tables = deriveDrizzleTables(definition);

  return buildResourceShape(
    resource(options.id ?? defaultResourceId, {
      create: () => {
        try {
          const client = openSqliteDatabase(options.url, false);
          try {
            ensureSqliteSchema(client, definition);
          } catch (error) {
            client.close();
            throw error;
          }
          const db = drizzle({ client, schema: tables });
          return Result.ok(
            createWritableConnection(definition, tables, db, client)
          );
        } catch (error) {
          return Result.err(
            new InternalError(
              `Drizzle store failed to open database at "${options.url}": ${asError(error).message}`,
              { cause: asError(error) }
            )
          );
        }
      },
      description:
        options.description ??
        'Drizzle-backed writable store bound from an @ontrails/store definition.',
      dispose: (connection) => {
        closeConnection(connection);
      },
      health: connectionHealth,
      mock: () => {
        const client = openSqliteDatabase(':memory:', false);
        try {
          ensureSqliteSchema(client, definition);
          const db = drizzle({ client, schema: tables });
          seedFixtures(definition, tables, db, options.mockSeed);
          return createWritableConnection(definition, tables, db, client);
        } catch (error) {
          client.close();
          throw error;
        }
      },
    }),
    definition,
    tables,
    'readwrite'
  );
};

export const connectReadOnlyDrizzle = <const TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: ReadOnlyDrizzleOptions
): DrizzleStoreResource<
  TStore,
  ReadOnlyDrizzleStoreConnection<TStore>,
  'readonly'
> => {
  const tables = deriveDrizzleTables(definition);

  return buildResourceShape(
    resource(options.id ?? defaultResourceId, {
      create: () => {
        try {
          const client = openSqliteDatabase(options.url, true);
          const db = drizzle({ client, schema: tables });
          return Result.ok(
            createReadOnlyConnection(definition, tables, db, client)
          );
        } catch (error) {
          return Result.err(
            new InternalError(
              `Drizzle read-only store failed to open database at "${options.url}": ${asError(error).message}`,
              { cause: asError(error) }
            )
          );
        }
      },
      description:
        options.description ??
        'Drizzle-backed read-only store bound from an @ontrails/store definition.',
      dispose: (connection) => {
        closeConnection(connection);
      },
      health: connectionHealth,
    }),
    definition,
    tables,
    'readonly'
  );
};

export const store = <const TTables extends StoreTablesInput>(
  tables: TTables,
  options: ConnectDrizzleOptions<ReturnType<typeof defineStore<TTables>>>
): DrizzleStoreResource<
  ReturnType<typeof defineStore<TTables>>,
  DrizzleStoreConnection<ReturnType<typeof defineStore<TTables>>>,
  'readwrite'
> => connectDrizzle(defineStore(tables), options);

export const readonlyStore = <const TTables extends StoreTablesInput>(
  tables: TTables,
  options: ReadOnlyDrizzleOptions
): DrizzleStoreResource<
  ReturnType<typeof defineStore<TTables>>,
  ReadOnlyDrizzleStoreConnection<ReturnType<typeof defineStore<TTables>>>,
  'readonly'
> => connectReadOnlyDrizzle(defineStore(tables), options);

export const getSchema = <TStore extends AnyStoreDefinition>(
  binding: Pick<
    DrizzleStoreResource<TStore, unknown, StoreAccessMode>,
    'tables'
  >
): DrizzleStoreSchema<TStore> => binding.tables;
