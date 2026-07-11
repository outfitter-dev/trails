/**
 * Cloudflare D1 store resource for Trails.
 *
 * `cloudflareD1` binds an `@ontrails/store` definition to a Cloudflare D1
 * database binding. The Workers env bridge resolves the binding per env, then
 * each table accessor persists full entities as JSON rows in D1.
 */

import {
  ConflictError,
  InternalError,
  Result,
  resource,
  ValidationError,
} from '@ontrails/core';
import type { Resource, Signal, TrailContext } from '@ontrails/core';
import { versionFieldName } from '@ontrails/store';
import type {
  AnyStoreDefinition,
  AnyStoreTable,
  EntityOf,
  FiltersOf,
  FixtureInputOf,
  StoreAccessor,
  StoreAdapterOptions,
  StoreConnection,
  StoreIdentifierOf,
  StoreListOptions,
  StoreMockSeed,
  UpsertOf,
} from '@ontrails/store';
import { bindStoreDefinition } from '@ontrails/store/adapter-support';

import { registerEnvBinding } from '../env.js';

// ---------------------------------------------------------------------------
// D1 binding shape
// ---------------------------------------------------------------------------

/** Result shape returned by D1 prepared statement `all()`. */
export interface CloudflareD1AllResult<TRow> {
  readonly results?: readonly TRow[] | undefined;
}

/** Minimal structural shape returned by D1 prepared statement `run()`. */
export interface CloudflareD1RunResult {
  readonly meta?: { readonly changes?: number | undefined } | undefined;
}

/** Minimal structural shape used from a D1 prepared statement. */
export interface CloudflareD1PreparedStatement {
  bind(...values: unknown[]): CloudflareD1PreparedStatement;
  first<TRow = Record<string, unknown>>(): Promise<TRow | null>;
  all<TRow = Record<string, unknown>>(): Promise<CloudflareD1AllResult<TRow>>;
  run(): Promise<CloudflareD1RunResult>;
}

/** Minimal structural shape used from a Cloudflare D1 database binding. */
export interface CloudflareD1Database {
  exec(query: string): Promise<unknown>;
  prepare(query: string): CloudflareD1PreparedStatement;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Connection shape returned by {@link connectD1}. */
export type CloudflareD1Connection<TStore extends AnyStoreDefinition> =
  StoreConnection<TStore>;

/** Options for {@link connectD1}. */
export interface ConnectD1Options<
  TStore extends AnyStoreDefinition = AnyStoreDefinition,
> {
  /**
   * Optional identity generator for generated identity fields. Defaults to
   * `crypto.randomUUID()`.
   */
  readonly generateIdentity?: (() => string) | undefined;
  /** Optional runtime seed rows inserted during lazy schema initialization. */
  readonly seed?: StoreMockSeed<TStore> | undefined;
  /**
   * Optional D1 table-name prefix. Defaults to `"store"`.
   *
   * `cloudflareD1` sets this to the resource id so multiple store resources
   * can share one D1 database without colliding on table names.
   */
  readonly tablePrefix?: string | undefined;
}

/** Options for {@link cloudflareD1}. */
export interface CloudflareD1Options<
  TStore extends AnyStoreDefinition = AnyStoreDefinition,
>
  extends StoreAdapterOptions<TStore>, ConnectD1Options<TStore> {
  /** The wrangler binding name (a `d1_databases` entry's `binding`). */
  readonly binding: string;
}

/** Resource shape returned by {@link cloudflareD1}. */
export type CloudflareD1Resource<TStore extends AnyStoreDefinition> = Resource<
  CloudflareD1Connection<TStore>
> & {
  readonly access: 'readwrite';
  readonly signals: TStore['signals'];
  readonly store: TStore;
  from(ctx: TrailContext): CloudflareD1Connection<TStore>;
};

// ---------------------------------------------------------------------------
// Shared row helpers
// ---------------------------------------------------------------------------

const defaultResourceId = 'store';

const defaultGenerateIdentity = (): string => {
  if (globalThis.crypto?.randomUUID !== undefined) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const encodeIdentifier = (id: unknown): string =>
  JSON.stringify(id) ?? String(id);

const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

const storageTableName = (scope: string, table: AnyStoreTable): string =>
  `${scope}.${table.name}`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && deepEqual(left[key], right[key])
    )
  );
};

const matchesFilters = (
  entity: Record<string, unknown>,
  filters: Record<string, unknown>
): boolean => {
  for (const [key, value] of Object.entries(filters)) {
    if (!deepEqual(entity[key], value)) {
      return false;
    }
  }
  return true;
};

const applyPagination = <T>(
  items: readonly T[],
  options?: StoreListOptions
): readonly T[] => {
  if (options === undefined) {
    return items;
  }
  const offset = options.offset ?? 0;
  const limit = options.limit ?? items.length;
  return items.slice(offset, offset + limit);
};

const cloneEntity = <TTable extends AnyStoreTable>(
  entity: EntityOf<TTable>
): EntityOf<TTable> => structuredClone(entity);

const formatIssues = (issues: readonly { readonly message: string }[]) =>
  issues.map((issue) => issue.message).join('; ');

const parseStoredEntity = <TTable extends AnyStoreTable>(
  table: TTable,
  raw: unknown
): EntityOf<TTable> => {
  const parsed = table.schema.safeParse(raw);
  if (!parsed.success) {
    throw new InternalError(
      `D1 table "${table.name}" contains a row that does not match the store schema: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data as EntityOf<TTable>;
};

const parseWrittenEntity = <TTable extends AnyStoreTable>(
  table: TTable,
  raw: unknown
): EntityOf<TTable> => {
  const parsed = table.schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      `D1 table "${table.name}" received an invalid entity: ${formatIssues(parsed.error.issues)}`
    );
  }
  return parsed.data as EntityOf<TTable>;
};

const readIdentity = <TTable extends AnyStoreTable>(
  table: TTable,
  entity: EntityOf<TTable>
): StoreIdentifierOf<TTable> =>
  (entity as Record<string, unknown>)[
    table.identity
  ] as StoreIdentifierOf<TTable>;

const assignIdentity = (
  payload: Record<string, unknown>,
  identityField: string,
  generate: () => string
): void => {
  if (payload[identityField] === undefined) {
    payload[identityField] = generate();
  }
};

const assignTimestamp = (
  payload: Record<string, unknown>,
  generatedFields: ReadonlySet<string>,
  isNew: boolean
): void => {
  if (generatedFields.has('createdAt') && isNew) {
    payload['createdAt'] = new Date().toISOString();
  }
  if (generatedFields.has('updatedAt')) {
    payload['updatedAt'] = new Date().toISOString();
  }
};

const resolveNextVersion = (
  existing: Record<string, unknown> | undefined
): number =>
  existing === undefined ? 1 : (existing[versionFieldName] as number) + 1;

const assignVersion = (
  payload: Record<string, unknown>,
  isVersioned: boolean,
  existing: Record<string, unknown> | undefined
): void => {
  if (isVersioned) {
    payload[versionFieldName] = resolveNextVersion(existing);
  }
};

const checkVersionConflict = (
  tableName: string,
  isVersioned: boolean,
  input: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
): void => {
  if (!isVersioned) {
    return;
  }
  const inputVersion = input[versionFieldName] as number | undefined;
  if (inputVersion === undefined) {
    return;
  }
  if (existing === undefined) {
    throw new ConflictError(
      `Version conflict on "${tableName}": expected ${String(inputVersion)}, actual missing`
    );
  }
  const currentVersion = existing[versionFieldName] as number;
  if (inputVersion !== currentVersion) {
    throw new ConflictError(
      `Version conflict on "${tableName}": expected ${String(inputVersion)}, actual ${String(currentVersion)}`
    );
  }
};

const buildUpsertEntity = <TTable extends AnyStoreTable>(
  table: TTable,
  input: UpsertOf<TTable>,
  existing: EntityOf<TTable> | undefined,
  generateIdentity: () => string
): EntityOf<TTable> => {
  const raw = input as Record<string, unknown>;
  const merged =
    existing === undefined
      ? { ...raw }
      : { ...(existing as Record<string, unknown>), ...raw };
  checkVersionConflict(
    table.name,
    table.versioned,
    raw,
    existing as Record<string, unknown> | undefined
  );
  assignIdentity(merged, table.identity, generateIdentity);
  assignTimestamp(merged, new Set(table.generated), existing === undefined);
  assignVersion(merged, table.versioned, existing as Record<string, unknown>);
  return parseWrittenEntity(table, merged);
};

const buildSeedEntity = <TTable extends AnyStoreTable>(
  table: TTable,
  input: FixtureInputOf<TTable>
): EntityOf<TTable> => {
  const entity = { ...(input as Record<string, unknown>) };
  const generatedFields = new Set(table.generated);
  if (entity[table.identity] === undefined) {
    throw new ValidationError(
      `D1 runtime seed rows for "${table.name}" must define the stable identity field "${table.identity}"`
    );
  }
  const now = new Date().toISOString();
  if (generatedFields.has('createdAt') && entity['createdAt'] === undefined) {
    entity['createdAt'] = now;
  }
  if (generatedFields.has('updatedAt') && entity['updatedAt'] === undefined) {
    entity['updatedAt'] = now;
  }
  if (table.versioned && entity[versionFieldName] === undefined) {
    entity[versionFieldName] = 1;
  }
  return parseWrittenEntity(table, entity);
};

const fixtureRowsFor = (
  tableName: string,
  table: AnyStoreTable,
  seed: StoreMockSeed<AnyStoreDefinition> | undefined,
  includeTableFixtures: boolean
): readonly FixtureInputOf<AnyStoreTable>[] => {
  const seeded = seed?.[tableName] as
    | readonly FixtureInputOf<AnyStoreTable>[]
    | undefined;
  if (seeded !== undefined) {
    return seeded;
  }
  return includeTableFixtures ? table.fixtures : [];
};

const insertSeed = Symbol('cloudflare.d1.insertSeed');

type SeedAwareAccessor<TTable extends AnyStoreTable> = StoreAccessor<TTable> & {
  [insertSeed](input: FixtureInputOf<TTable>): Promise<void>;
};

const seedConnection = async <TStore extends AnyStoreDefinition>(
  connection: CloudflareD1Connection<TStore>,
  definition: TStore,
  seed: StoreMockSeed<TStore> | undefined,
  includeTableFixtures: boolean
): Promise<void> => {
  const accessors = connection as unknown as Record<
    string,
    SeedAwareAccessor<AnyStoreTable>
  >;
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    const accessor = accessors[tableName];
    if (table === undefined || accessor === undefined) {
      continue;
    }
    for (const fixture of fixtureRowsFor(
      tableName,
      table,
      seed as StoreMockSeed<AnyStoreDefinition> | undefined,
      includeTableFixtures
    )) {
      await accessor[insertSeed](fixture);
    }
  }
};

// ---------------------------------------------------------------------------
// D1 storage implementation
// ---------------------------------------------------------------------------

interface D1TableRow {
  readonly entity: string;
}

const ensureD1Table = async (
  database: CloudflareD1Database,
  tableName: string
): Promise<void> => {
  await database.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (id TEXT PRIMARY KEY, entity TEXT NOT NULL, version INTEGER)`
  );
};

const getD1Row = async <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  id: StoreIdentifierOf<TTable>
): Promise<EntityOf<TTable> | null> => {
  const row = await database
    .prepare(`SELECT entity FROM ${quoteIdentifier(tableName)} WHERE id = ?`)
    .bind(encodeIdentifier(id))
    .first<D1TableRow>();
  return row === null ? null : parseStoredEntity(table, JSON.parse(row.entity));
};

const listD1Rows = async <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  filters?: FiltersOf<TTable>,
  options?: StoreListOptions
): Promise<readonly EntityOf<TTable>[]> => {
  const rows = await database
    .prepare(`SELECT entity FROM ${quoteIdentifier(tableName)} ORDER BY id`)
    .all<D1TableRow>();
  const entities = (rows.results ?? []).map((row) =>
    parseStoredEntity(table, JSON.parse(row.entity))
  );
  const filtered =
    filters === undefined
      ? entities
      : entities.filter((entity) =>
          matchesFilters(
            entity as Record<string, unknown>,
            filters as Record<string, unknown>
          )
        );
  return applyPagination(filtered, options).map((entity) =>
    cloneEntity(entity)
  );
};

const d1ChangeCount = (result: CloudflareD1RunResult): number =>
  result.meta?.changes ?? 0;

const entityVersion = <TTable extends AnyStoreTable>(
  entity: EntityOf<TTable>
): number | undefined =>
  (entity as Record<string, unknown>)[versionFieldName] as number | undefined;

interface D1UpsertOutcome<TTable extends AnyStoreTable> {
  readonly entity: EntityOf<TTable>;
  readonly previous: EntityOf<TTable> | null;
}

interface D1RemoveOutcome<TTable extends AnyStoreTable> {
  readonly deleted: boolean;
  readonly entity: EntityOf<TTable> | null;
}

const upsertWithOutcome = Symbol('cloudflare.d1.upsertWithOutcome');
const removeWithOutcome = Symbol('cloudflare.d1.removeWithOutcome');

type OutcomeAwareAccessor<TTable extends AnyStoreTable> =
  StoreAccessor<TTable> & {
    [removeWithOutcome](
      id: StoreIdentifierOf<TTable>
    ): Promise<D1RemoveOutcome<TTable>>;
    [upsertWithOutcome](
      input: UpsertOf<TTable>
    ): Promise<D1UpsertOutcome<TTable>>;
  };

const throwVersionConflict = <TTable extends AnyStoreTable>(
  table: TTable,
  expectedVersion: number,
  current: EntityOf<TTable> | null
): never => {
  const actualVersion =
    current === null ? 'missing' : String(entityVersion(current));
  throw new ConflictError(
    `Version conflict on "${table.name}": expected ${String(expectedVersion)}, actual ${actualVersion}`
  );
};

const updateD1RowIfUnchanged = async <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  entity: EntityOf<TTable>,
  previous: EntityOf<TTable>,
  expectedVersion: number | undefined
): Promise<boolean> => {
  const id = readIdentity(table, entity);
  const expectedVersionClause =
    expectedVersion === undefined ? '' : ' AND version = ?';
  const result = await database
    .prepare(
      `UPDATE ${quoteIdentifier(tableName)} SET entity = ?, version = ? WHERE id = ? AND entity = ?${expectedVersionClause}`
    )
    .bind(
      JSON.stringify(entity),
      entityVersion(entity) ?? null,
      encodeIdentifier(id),
      JSON.stringify(previous),
      ...(expectedVersion === undefined ? [] : [expectedVersion])
    )
    .run();
  return d1ChangeCount(result) > 0;
};

const insertD1RowIfMissing = async <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  entity: EntityOf<TTable>
): Promise<boolean> => {
  const result = await database
    .prepare(
      `INSERT INTO ${quoteIdentifier(tableName)} (id, entity, version) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`
    )
    .bind(
      encodeIdentifier(readIdentity(table, entity)),
      JSON.stringify(entity),
      entityVersion(entity) ?? null
    )
    .run();
  return d1ChangeCount(result) > 0;
};

const seedD1Tables = async <TStore extends AnyStoreDefinition>(
  database: CloudflareD1Database,
  definition: TStore,
  tablePrefix: string,
  seed: StoreMockSeed<TStore> | undefined,
  includeTableFixtures: boolean
): Promise<void> => {
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    if (table === undefined) {
      continue;
    }
    const d1TableName = storageTableName(tablePrefix, table);
    for (const fixture of fixtureRowsFor(
      tableName,
      table,
      seed as StoreMockSeed<AnyStoreDefinition> | undefined,
      includeTableFixtures
    )) {
      await insertD1RowIfMissing(
        database,
        d1TableName,
        table,
        buildSeedEntity(table, fixture)
      );
    }
  }
};

const removeD1Row = async <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  id: StoreIdentifierOf<TTable>
): Promise<D1RemoveOutcome<TTable>> => {
  const row = await database
    .prepare(
      `DELETE FROM ${quoteIdentifier(tableName)} WHERE id = ? RETURNING entity`
    )
    .bind(encodeIdentifier(id))
    .first<D1TableRow>();
  if (row === null) {
    return { deleted: false, entity: null };
  }
  return {
    deleted: true,
    entity: parseStoredEntity(table, JSON.parse(row.entity)),
  };
};

const createD1Accessor = <TTable extends AnyStoreTable>(
  database: CloudflareD1Database,
  tableName: string,
  table: TTable,
  ensureReady: () => Promise<void>,
  generateIdentity: () => string
): StoreAccessor<TTable> => {
  const writeWithOutcome = async (
    input: UpsertOf<TTable>
  ): Promise<D1UpsertOutcome<TTable>> => {
    await ensureReady();
    const raw = input as Record<string, unknown>;
    const inputId = raw[table.identity] as
      | StoreIdentifierOf<TTable>
      | undefined;
    const expectedVersion = table.versioned
      ? (raw[versionFieldName] as number | undefined)
      : undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const observed =
        inputId === undefined
          ? null
          : await getD1Row(database, tableName, table, inputId);
      const candidate = buildUpsertEntity(
        table,
        input,
        observed ?? undefined,
        generateIdentity
      );
      if (observed === null) {
        if (await insertD1RowIfMissing(database, tableName, table, candidate)) {
          return { entity: cloneEntity(candidate), previous: null };
        }
        continue;
      }
      if (
        await updateD1RowIfUnchanged(
          database,
          tableName,
          table,
          candidate,
          observed,
          expectedVersion
        )
      ) {
        return {
          entity: cloneEntity(candidate),
          previous: observed,
        };
      }
      if (expectedVersion !== undefined) {
        return throwVersionConflict(
          table,
          expectedVersion,
          await getD1Row(
            database,
            tableName,
            table,
            readIdentity(table, observed)
          )
        );
      }
    }
    throw new InternalError(
      `D1 upsert for "${table.name}" could not commit after repeated concurrent writes`
    );
  };

  const removeAndReturn = async (
    id: StoreIdentifierOf<TTable>
  ): Promise<D1RemoveOutcome<TTable>> => {
    await ensureReady();
    return await removeD1Row(database, tableName, table, id);
  };

  const accessor: OutcomeAwareAccessor<TTable> = {
    async get(id) {
      await ensureReady();
      const entity = await getD1Row(database, tableName, table, id);
      return entity === null ? null : cloneEntity(entity);
    },
    async list(filters, options) {
      await ensureReady();
      return await listD1Rows(database, tableName, table, filters, options);
    },
    async remove(id) {
      const outcome = await removeAndReturn(id);
      return { deleted: outcome.deleted };
    },
    async upsert(input) {
      const outcome = await writeWithOutcome(input);
      return outcome.entity;
    },
    [removeWithOutcome]: removeAndReturn,
    [upsertWithOutcome]: writeWithOutcome,
  };
  return accessor;
};

// ---------------------------------------------------------------------------
// In-memory mock implementation
// ---------------------------------------------------------------------------

const sortedMemoryRows = <TTable extends AnyStoreTable>(
  rows: ReadonlyMap<string, EntityOf<TTable>>
): readonly EntityOf<TTable>[] =>
  [...rows.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);

const createMemoryAccessor = <TTable extends AnyStoreTable>(
  table: TTable,
  generateIdentity: () => string
): StoreAccessor<TTable> => {
  const rows = new Map<string, EntityOf<TTable>>();

  const writeWithOutcome = (
    input: UpsertOf<TTable>
  ): Promise<D1UpsertOutcome<TTable>> => {
    const raw = input as Record<string, unknown>;
    const inputId = raw[table.identity] as
      | StoreIdentifierOf<TTable>
      | undefined;
    const existing =
      inputId === undefined ? undefined : rows.get(encodeIdentifier(inputId));
    const entity = buildUpsertEntity(table, input, existing, generateIdentity);
    rows.set(encodeIdentifier(readIdentity(table, entity)), entity);
    return Promise.resolve({
      entity: cloneEntity(entity),
      previous: existing === undefined ? null : cloneEntity(existing),
    });
  };

  const accessor: OutcomeAwareAccessor<TTable> & SeedAwareAccessor<TTable> = {
    get: (id) => {
      const entity = rows.get(encodeIdentifier(id));
      return Promise.resolve(entity === undefined ? null : cloneEntity(entity));
    },
    list: (filters, options) => {
      const all = sortedMemoryRows(rows);
      const filtered =
        filters === undefined
          ? all
          : all.filter((entity) =>
              matchesFilters(
                entity as Record<string, unknown>,
                filters as Record<string, unknown>
              )
            );
      return Promise.resolve(
        applyPagination(filtered, options).map((entity) => cloneEntity(entity))
      );
    },
    remove: async (id) => {
      const outcome = await accessor[removeWithOutcome](id);
      return { deleted: outcome.deleted };
    },
    async upsert(input) {
      const outcome = await writeWithOutcome(input);
      return outcome.entity;
    },
    [removeWithOutcome]: (id) => {
      const key = encodeIdentifier(id);
      const existing = rows.get(key);
      const deleted = rows.delete(key);
      return Promise.resolve({
        deleted,
        entity: existing === undefined ? null : cloneEntity(existing),
      });
    },
    [insertSeed]: (input) => {
      const entity = buildSeedEntity(table, input);
      const key = encodeIdentifier(readIdentity(table, entity));
      if (!rows.has(key)) {
        rows.set(key, entity);
      }
      return Promise.resolve();
    },
    [upsertWithOutcome]: writeWithOutcome,
  };
  return accessor;
};

const buildConnection = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  createAccessor: <TTable extends AnyStoreTable>(
    table: TTable,
    tableName: string
  ) => StoreAccessor<TTable>
): CloudflareD1Connection<TStore> => {
  const connection = {} as Record<string, StoreAccessor<AnyStoreTable>>;
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    if (table !== undefined) {
      connection[tableName] = createAccessor(table, tableName);
    }
  }
  return Object.freeze(connection) as CloudflareD1Connection<TStore>;
};

const createMemoryConnection = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: ConnectD1Options<TStore> = {}
): CloudflareD1Connection<TStore> =>
  buildConnection(definition, (table) =>
    createMemoryAccessor(
      table,
      options.generateIdentity ?? defaultGenerateIdentity
    )
  );

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

type BoundFireFn = NonNullable<TrailContext['fire']>;

const fireDerivedSignal = async <TTable extends AnyStoreTable>(
  fire: BoundFireFn,
  signal: Signal<unknown>,
  entity: EntityOf<TTable>
): Promise<void> => {
  try {
    await fire(signal, entity);
  } catch (error) {
    console.warn(
      `[cloudflare:d1] signal "${signal.id}" emission threw:`,
      error
    );
  }
};

const inputIdentity = <TTable extends AnyStoreTable>(
  table: TTable,
  input: UpsertOf<TTable>
): StoreIdentifierOf<TTable> | undefined =>
  input[table.identity as keyof UpsertOf<TTable> & string] as
    | StoreIdentifierOf<TTable>
    | undefined;

const changedEntity = <TTable extends AnyStoreTable>(
  previous: EntityOf<TTable> | null,
  next: EntityOf<TTable> | null
): next is EntityOf<TTable> =>
  previous !== null && next !== null && !deepEqual(previous, next);

const isOutcomeAwareAccessor = <TTable extends AnyStoreTable>(
  accessor: StoreAccessor<TTable>
): accessor is OutcomeAwareAccessor<TTable> => upsertWithOutcome in accessor;

const bindWritableAccessorSignals = <TTable extends AnyStoreTable>(
  table: TTable,
  accessor: StoreAccessor<TTable>,
  fire: BoundFireFn
): StoreAccessor<TTable> =>
  Object.freeze({
    ...accessor,
    async remove(id: StoreIdentifierOf<TTable>) {
      if (isOutcomeAwareAccessor(accessor)) {
        const outcome = await accessor[removeWithOutcome](id);
        if (outcome.entity !== null) {
          await fireDerivedSignal(fire, table.signals.removed, outcome.entity);
        }
        return { deleted: outcome.deleted };
      }
      const existing = await accessor.get(id);
      const removed = await accessor.remove(id);
      if (removed.deleted && existing !== null) {
        await fireDerivedSignal(fire, table.signals.removed, existing);
      }
      return removed;
    },
    async upsert(input: UpsertOf<TTable>) {
      if (isOutcomeAwareAccessor(accessor)) {
        const outcome = await accessor[upsertWithOutcome](input);
        if (outcome.previous === null) {
          await fireDerivedSignal(fire, table.signals.created, outcome.entity);
        } else if (changedEntity(outcome.previous, outcome.entity)) {
          await fireDerivedSignal(fire, table.signals.updated, outcome.entity);
        }
        return outcome.entity;
      }

      const existingId = inputIdentity(table, input);
      const existing =
        existingId === undefined ? null : await accessor.get(existingId);
      const written = await accessor.upsert(input);

      if (existing === null) {
        await fireDerivedSignal(fire, table.signals.created, written);
        return written;
      }
      if (changedEntity(existing, written)) {
        await fireDerivedSignal(fire, table.signals.updated, written);
      }
      return written;
    },
  });

const bindConnectionSignals = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  connection: CloudflareD1Connection<TStore>,
  fire: BoundFireFn
): CloudflareD1Connection<TStore> => {
  const bound = {} as Record<string, StoreAccessor<AnyStoreTable>>;
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    const accessor = connection[tableName];
    if (table !== undefined && accessor !== undefined) {
      bound[tableName] = bindWritableAccessorSignals(
        table,
        accessor as StoreAccessor<typeof table>,
        fire
      );
    }
  }
  return Object.freeze(bound) as CloudflareD1Connection<TStore>;
};

const bindResourceConnection = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  connection: CloudflareD1Connection<TStore>,
  fire: TrailContext['fire']
): CloudflareD1Connection<TStore> =>
  fire === undefined
    ? connection
    : bindConnectionSignals(definition, connection, fire);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect a store definition to a D1 database binding.
 *
 * The returned connection is synchronous to create so it can flow through the
 * Workers env bridge. Schema creation and optional seeding run lazily before
 * the first accessor operation.
 *
 * @example
 * ```ts
 * import { connectD1 } from '@ontrails/cloudflare/d1';
 *
 * const conn = connectD1(definition, env.DB);
 * const note = await conn.notes.upsert({ id: 'n1', title: 'Hello' });
 * ```
 */
export const connectD1 = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  database: CloudflareD1Database,
  options: ConnectD1Options<TStore> = {}
): CloudflareD1Connection<TStore> => {
  const generateIdentity = options.generateIdentity ?? defaultGenerateIdentity;
  const tablePrefix = options.tablePrefix ?? defaultResourceId;
  let ready: Promise<void> | undefined;

  const initialize = async (): Promise<void> => {
    for (const tableName of definition.tableNames) {
      const table = definition.tables[tableName];
      if (table !== undefined) {
        await ensureD1Table(database, storageTableName(tablePrefix, table));
      }
    }
    await seedD1Tables(database, definition, tablePrefix, options.seed, false);
  };

  const initializeReady = async (): Promise<void> => {
    try {
      await initialize();
    } catch (error) {
      ready = undefined;
      throw error;
    }
  };

  const ensureReady = (): Promise<void> => {
    ready ??= initializeReady();
    return ready;
  };

  return buildConnection(definition, (table) =>
    createD1Accessor(
      database,
      storageTableName(tablePrefix, table),
      table,
      ensureReady,
      generateIdentity
    )
  );
};

const isD1Binding = (value: unknown): value is CloudflareD1Database => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<
    Record<keyof CloudflareD1Database, unknown>
  >;
  return (
    typeof candidate.exec === 'function' &&
    typeof candidate.prepare === 'function'
  );
};

const createD1Mock = async <TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: CloudflareD1Options<TStore>
): Promise<CloudflareD1Connection<TStore>> => {
  const connection = createMemoryConnection(definition, options);
  await seedConnection(connection, definition, options.mockSeed, true);
  return connection;
};

/**
 * Author a Trails resource wrapping a Cloudflare D1 database binding.
 *
 * The binding arrives through the Workers env bridge, so `create` refuses to
 * run outside a Worker. Tests use the in-memory mock factory, seeded from
 * table fixtures or `mockSeed`, and Miniflare can provide a real D1 binding
 * without a Cloudflare account.
 *
 * @example
 * ```ts
 * import { cloudflareD1 } from '@ontrails/cloudflare/d1';
 * import { store } from '@ontrails/store';
 * import { trail, Result } from '@ontrails/core';
 * import { z } from 'zod';
 *
 * const definition = store({
 *   notes: {
 *     identity: 'id',
 *     schema: z.object({ id: z.string(), title: z.string() }),
 *   },
 * });
 * const db = cloudflareD1(definition, { binding: 'DB', id: 'notes.store' });
 *
 * const saveNote = trail('note.save', {
 *   implementation: async (input, ctx) => Result.ok(await db.from(ctx).notes.upsert(input)),
 *   input: z.object({ id: z.string(), title: z.string() }),
 *   intent: 'write',
 *   output: z.object({ id: z.string(), title: z.string() }),
 *   resources: [db],
 * });
 * ```
 */
export const cloudflareD1 = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: CloudflareD1Options<TStore>
): CloudflareD1Resource<TStore> => {
  const scope = options.id ?? defaultResourceId;
  const store = bindStoreDefinition(definition, scope) as TStore;
  const base = resource<CloudflareD1Connection<TStore>>(scope, {
    create: () =>
      Result.err(
        new InternalError(
          `Resource "${scope}" wraps Cloudflare D1 binding "${options.binding}", which only exists on a Workers env. Serve the topo with createWorkersHandler from @ontrails/cloudflare/workers, or rely on the in-memory mock in tests.`,
          { context: { binding: options.binding, resourceId: scope } }
        )
      ),
    description:
      options.description ??
      `Cloudflare D1 database bound to "${options.binding}"`,
    meta: {
      ...options.meta,
      'cloudflare.binding': options.binding,
      'cloudflare.service': 'd1',
    },
    mock: () => createD1Mock(store, options),
    signals: store.signals,
  });
  const d1Resource = Object.freeze({
    ...base,
    access: 'readwrite' as const,
    from(ctx: TrailContext) {
      return bindResourceConnection(store, base.from(ctx), ctx.fire);
    },
    signals: store.signals,
    store,
  }) as CloudflareD1Resource<TStore>;

  registerEnvBinding(d1Resource, {
    binding: options.binding,
    fromEnv: (value) =>
      isD1Binding(value)
        ? Result.ok(
            connectD1(store, value, {
              generateIdentity: options.generateIdentity,
              seed: options.seed,
              tablePrefix: options.tablePrefix ?? scope,
            })
          )
        : Result.err(
            new InternalError(
              `Worker env binding "${options.binding}" for resource "${scope}" is not a D1 database. Check the d1_databases entry in your wrangler configuration.`,
              { context: { binding: options.binding, resourceId: scope } }
            )
          ),
  });
  return d1Resource;
};
