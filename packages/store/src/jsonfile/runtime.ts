import { ConflictError, InternalError, Result, resource } from '@ontrails/core';
import type {
  AnyStoreDefinition,
  AnyStoreTable,
  EntityOf,
  FiltersOf,
  FixtureInputOf,
  StoreAccessor,
  StoreIdentifierOf,
  StoreListOptions,
  UpsertOf,
} from '../types.js';
import { versionFieldName } from '../store.js';

import type {
  JsonFileConnection,
  JsonFileStoreOptions,
  JsonFileStoreResource,
} from './types.js';

// ---------------------------------------------------------------------------
// Mutex — single-process in-memory lock
// ---------------------------------------------------------------------------

/* eslint-disable promise/avoid-new -- Mutex requires manual promise control */
const createMutexAcquire =
  (state: { locked: boolean }, queue: (() => void)[]): (() => Promise<void>) =>
  () => {
    if (!state.locked) {
      state.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(resolve);
    });
  };
/* eslint-enable promise/avoid-new */

const createMutexRelease =
  (state: { locked: boolean }, queue: (() => void)[]): (() => void) =>
  () => {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      state.locked = false;
    }
  };

interface MutexHandle {
  readonly acquire: () => Promise<void>;
  readonly release: () => void;
}

const createMutex = (): MutexHandle => {
  const state = { locked: false };
  const queue: (() => void)[] = [];
  return {
    acquire: createMutexAcquire(state, queue),
    release: createMutexRelease(state, queue),
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultResourceId = 'store';

const defaultGenerateIdentity = (): string => Bun.randomUUIDv7();

const jsonFilePath = (dir: string, tableName: string): string =>
  `${dir}/${tableName}.json`;

const matchesFilters = (
  entity: Record<string, unknown>,
  filters: Record<string, unknown>
): boolean => {
  for (const [key, value] of Object.entries(filters)) {
    if (entity[key] !== value) {
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

// ---------------------------------------------------------------------------
// Generated field helpers (defined before use, module-level)
// ---------------------------------------------------------------------------

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
  if (!isVersioned) {
    return;
  }
  payload[versionFieldName] = resolveNextVersion(existing);
};

const checkVersionConflict = (
  tableName: string,
  isVersioned: boolean,
  input: Record<string, unknown>,
  existing: Record<string, unknown>
): void => {
  if (!isVersioned) {
    return;
  }
  const inputVersion = input[versionFieldName] as number | undefined;
  if (inputVersion === undefined) {
    return;
  }
  const currentVersion = existing[versionFieldName] as number;
  if (inputVersion !== currentVersion) {
    throw new ConflictError(
      `Version conflict on "${tableName}": expected ${String(inputVersion)}, actual ${String(currentVersion)}`
    );
  }
};

const buildUpsertPayload = (
  input: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  identityField: string,
  generateIdentity: () => string,
  generatedFields: ReadonlySet<string>,
  isVersioned: boolean
): Record<string, unknown> => {
  const payload = { ...input };
  assignIdentity(payload, identityField, generateIdentity);
  assignTimestamp(payload, generatedFields, existing === undefined);
  assignVersion(
    payload,
    isVersioned,
    existing as Record<string, unknown> | undefined
  );
  return payload;
};

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

const loadFromDisk = async <TTable extends AnyStoreTable>(
  path: string,
  identityField: string,
  index: Map<string, EntityOf<TTable>>
): Promise<void> => {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    await Bun.write(path, '[]');
    return;
  }
  const text = await file.text();
  const rows = JSON.parse(text) as EntityOf<TTable>[];
  for (const row of rows) {
    const id = String((row as Record<string, unknown>)[identityField]);
    index.set(id, row);
  }
};

const flushToDisk = async <TTable extends AnyStoreTable>(
  path: string,
  index: Map<string, EntityOf<TTable>>
): Promise<void> => {
  const rows = [...index.values()];
  await Bun.write(path, JSON.stringify(rows, null, 2));
};

// ---------------------------------------------------------------------------
// Table config — groups table metadata for passing to helpers
// ---------------------------------------------------------------------------

interface TableConfig {
  readonly generateIdentity: () => string;
  readonly generatedFields: ReadonlySet<string>;
  readonly identityField: string;
  readonly isVersioned: boolean;
  readonly tableName: string;
}

// ---------------------------------------------------------------------------
// Upsert core (extracted to stay under max-statements)
// ---------------------------------------------------------------------------

const resolveExisting = <TTable extends AnyStoreTable>(
  raw: Record<string, unknown>,
  identityField: string,
  index: Map<string, EntityOf<TTable>>
): EntityOf<TTable> | undefined => {
  const id = String(raw[identityField] ?? '');
  return id ? index.get(id) : undefined;
};

const mergeAndBuild = <TTable extends AnyStoreTable>(
  raw: Record<string, unknown>,
  existing: EntityOf<TTable> | undefined,
  identityField: string,
  generateIdentity: () => string,
  generatedFields: ReadonlySet<string>,
  isVersioned: boolean
): EntityOf<TTable> => {
  const merged = existing === undefined ? { ...raw } : { ...existing, ...raw };
  const payload = buildUpsertPayload(
    merged as Record<string, unknown>,
    existing as Record<string, unknown> | undefined,
    identityField,
    generateIdentity,
    generatedFields,
    isVersioned
  );
  return payload as EntityOf<TTable>;
};

// Flush an upsert to disk then commit to the live index. Extracted to keep
// executeUpsert under the max-statements limit.
const flushAndCommitUpsert = async <TTable extends AnyStoreTable>(
  entity: EntityOf<TTable>,
  id: string,
  index: Map<string, EntityOf<TTable>>,
  path: string
): Promise<EntityOf<TTable>> => {
  // Build the intended state, flush to disk, then update the live index.
  // This ensures the in-memory Map stays consistent with the file even if
  // the write fails.
  const next = new Map([...index, [id, entity]]);
  await flushToDisk(path, next);
  index.set(id, entity);
  return structuredClone(entity);
};

const executeUpsert = <TTable extends AnyStoreTable>(
  input: UpsertOf<TTable>,
  index: Map<string, EntityOf<TTable>>,
  path: string,
  cfg: TableConfig
): Promise<EntityOf<TTable>> => {
  const raw = input as Record<string, unknown>;
  const existing = resolveExisting(raw, cfg.identityField, index);
  if (existing !== undefined) {
    checkVersionConflict(
      cfg.tableName,
      cfg.isVersioned,
      raw,
      existing as Record<string, unknown>
    );
  }
  const entity = mergeAndBuild(
    raw,
    existing,
    cfg.identityField,
    cfg.generateIdentity,
    cfg.generatedFields,
    cfg.isVersioned
  );
  const id = String((entity as Record<string, unknown>)[cfg.identityField]);
  return flushAndCommitUpsert(entity, id, index, path);
};

// ---------------------------------------------------------------------------
// JsonFileTable — manages one table's data on disk + in memory
// ---------------------------------------------------------------------------

interface JsonFileTableOptions {
  readonly dir: string;
  readonly table: AnyStoreTable;
  readonly generateIdentity: () => string;
}

const deriveTableConfig = (options: JsonFileTableOptions): TableConfig => ({
  generateIdentity: options.generateIdentity,
  generatedFields: new Set<string>(options.table.generated),
  identityField: options.table.identity,
  isVersioned: options.table.versioned,
  tableName: options.table.name,
});

const createGetAccessor =
  <TTable extends AnyStoreTable>(
    index: Map<string, EntityOf<TTable>>
  ): ((id: StoreIdentifierOf<TTable>) => Promise<EntityOf<TTable> | null>) =>
  (id) => {
    const entity = index.get(String(id));
    return Promise.resolve(
      entity === undefined ? null : structuredClone(entity)
    );
  };

const createListAccessor =
  <TTable extends AnyStoreTable>(
    index: Map<string, EntityOf<TTable>>
  ): ((
    filters?: FiltersOf<TTable>,
    opts?: StoreListOptions
  ) => Promise<readonly EntityOf<TTable>[]>) =>
  (filters, opts) => {
    const all = [...index.values()];
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
      applyPagination(filtered, opts).map((e) => structuredClone(e))
    );
  };

// Flush a remove to disk then commit to the live index. Extracted to keep
// the remove closure under the max-statements limit.
const executeRemove = async <TTable extends AnyStoreTable>(
  key: string,
  index: Map<string, EntityOf<TTable>>,
  path: string
): Promise<{ readonly deleted: boolean }> => {
  if (!index.has(key)) {
    return { deleted: false };
  }
  // Build the intended state, flush to disk, then update the live index.
  // This ensures the in-memory Map stays consistent with the file even if
  // the write fails.
  const next = new Map([...index].filter(([k]) => k !== key));
  await flushToDisk(path, next);
  index.delete(key);
  return { deleted: true };
};

// Module-level registry: ensures all connections to the same file share one
// in-memory table instance. Keyed by resolved file path.
// Note: entries are never evicted. This is acceptable for v1 — the connector
// targets single-process, short-lived servers where the number of distinct
// table paths is bounded by the store definition.
const tableRegistry = new Map<
  string,
  StoreAccessor<AnyStoreTable> & { readonly load: () => Promise<void> }
>();

type LoadableTable<TTable extends AnyStoreTable> = StoreAccessor<TTable> & {
  readonly load: () => Promise<void>;
};

const buildAndRegisterTable = <TTable extends AnyStoreTable>(
  path: string,
  options: JsonFileTableOptions
): LoadableTable<TTable> => {
  const mutex = createMutex();
  const index = new Map<string, EntityOf<TTable>>();
  const cfg = deriveTableConfig(options);

  const upsert = async (input: UpsertOf<TTable>): Promise<EntityOf<TTable>> => {
    await mutex.acquire();
    try {
      return await executeUpsert(input, index, path, cfg);
    } finally {
      mutex.release();
    }
  };

  const remove = async (
    id: StoreIdentifierOf<TTable>
  ): Promise<{ readonly deleted: boolean }> => {
    await mutex.acquire();
    try {
      return await executeRemove(String(id), index, path);
    } finally {
      mutex.release();
    }
  };

  const instance: LoadableTable<TTable> = {
    get: createGetAccessor(index),
    list: createListAccessor(index),
    // Skip disk load when the index already has data. This prevents a
    // second `connectJsonFile` call from overwriting in-flight writes
    // (the mutex only guards individual operations, not the full load
    // sequence). It also avoids re-reading stale files on reuse.
    load: async () => {
      if (index.size > 0) {
        return;
      }
      await loadFromDisk(path, cfg.identityField, index);
    },
    remove,
    upsert,
  };
  tableRegistry.set(path, instance);
  return instance;
};

const createJsonFileTable = <TTable extends AnyStoreTable>(
  options: JsonFileTableOptions
): LoadableTable<TTable> => {
  const path = jsonFilePath(options.dir, options.table.name);
  const cached = tableRegistry.get(path) as LoadableTable<TTable> | undefined;
  return cached ?? buildAndRegisterTable<TTable>(path, options);
};

// Tracks temp directories created by mock factories so `dispose` can clean
// them up. WeakMap ensures entries are GC'd when the connection is released.
const mockTmpDirs = new WeakMap<object, string>();

const collectMockFixtures = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  seed?: JsonFileStoreOptions<TStore>['mockSeed']
): Map<string, readonly FixtureInputOf<AnyStoreTable>[]> => {
  const fixturesByTable = new Map<
    string,
    readonly FixtureInputOf<AnyStoreTable>[]
  >();

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
      fixturesByTable.set(tableName, fixtures);
    }
  }

  return fixturesByTable;
};

const seedMockTable = async (
  accessor: StoreAccessor<AnyStoreTable>,
  fixtures: readonly FixtureInputOf<AnyStoreTable>[]
): Promise<void> => {
  for (const fixture of fixtures) {
    await accessor.upsert(fixture as UpsertOf<AnyStoreTable>);
  }
};

const seedMockConnection = async <TStore extends AnyStoreDefinition>(
  connection: JsonFileConnection<TStore['tables']>,
  definition: TStore,
  seed?: JsonFileStoreOptions<TStore>['mockSeed']
): Promise<void> => {
  const fixturesByTable = collectMockFixtures(definition, seed);
  if (fixturesByTable.size === 0) {
    return;
  }

  const accessors = connection as Record<string, StoreAccessor<AnyStoreTable>>;
  for (const tableName of definition.tableNames) {
    const accessor = accessors[tableName];
    const fixtures = fixturesByTable.get(tableName);
    if (accessor === undefined || fixtures === undefined) {
      continue;
    }
    await seedMockTable(accessor, fixtures);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect to a JSON-file-backed store.
 *
 * Creates one `<tableName>.json` file per table in the target directory.
 * Each file holds a JSON array of entities. The entire dataset is loaded
 * into memory on connect and flushed to disk on every write.
 */
export const connectJsonFile = async <TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: JsonFileStoreOptions<TStore>
): Promise<JsonFileConnection<TStore['tables']>> => {
  const { dir, generateIdentity = defaultGenerateIdentity } = options;
  const connection = {} as Record<string, StoreAccessor<AnyStoreTable>>;

  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    if (table === undefined) {
      continue;
    }
    const accessor = createJsonFileTable({
      dir,
      generateIdentity,
      table,
    }) as LoadableTable<AnyStoreTable>;
    await accessor.load();
    connection[tableName] = accessor;
  }

  return Object.freeze(connection) as JsonFileConnection<TStore['tables']>;
};

/**
 * Create a JSON-file-backed store resource.
 *
 * Returns a `Resource` that can be registered in a topo and resolved from
 * trail context via `db.from(ctx)`.
 */
export const jsonFile = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  options: JsonFileStoreOptions<TStore>
): JsonFileStoreResource<TStore['tables']> =>
  resource(options.id ?? defaultResourceId, {
    create: async () => {
      try {
        return Result.ok(await connectJsonFile(definition, options));
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return Result.err(
          new InternalError(
            `JSON file store failed to initialize in "${options.dir}": ${err.message}`,
            { cause: err }
          )
        );
      }
    },
    dispose: async (connection) => {
      const tmpDir = mockTmpDirs.get(connection as object);
      if (tmpDir !== undefined) {
        const { rm } = await import('node:fs/promises');
        await rm(tmpDir, { force: true, recursive: true });
        mockTmpDirs.delete(connection as object);
        for (const tableName of definition.tableNames) {
          tableRegistry.delete(jsonFilePath(tmpDir, tableName));
        }
      }
    },
    mock: async () => {
      const { mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const tmpDir = await mkdtemp(join(tmpdir(), 'jsonfile-mock-'));
      const connection = await connectJsonFile(definition, {
        ...options,
        dir: tmpDir,
      });
      await seedMockConnection(connection, definition, options.mockSeed);
      mockTmpDirs.set(connection as object, tmpDir);
      return connection;
    },
  });

export { jsonFile as store };
