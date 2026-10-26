import {
  ConflictError,
  createObserveLogger,
  InternalError,
  normalizeObserve,
  Result,
  resource,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
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
import { bindStoreDefinition } from '../adapter-support.js';
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

const executeUpsert = async <TTable extends AnyStoreTable>(
  input: UpsertOf<TTable>,
  index: Map<string, EntityOf<TTable>>,
  path: string,
  cfg: TableConfig
): Promise<{
  readonly previous: EntityOf<TTable> | undefined;
  readonly written: EntityOf<TTable>;
}> => {
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
  const previous = index.get(id);
  const written = await flushAndCommitUpsert(entity, id, index, path);
  return { previous, written };
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

interface JsonFileTableReuseConfig {
  readonly generateIdentity: (() => string) | undefined;
  readonly generatedFields: readonly string[];
  readonly identityField: string;
  readonly isVersioned: boolean;
}

const usesGeneratedIdentity = (config: {
  readonly generatedFields: readonly string[];
  readonly identityField: string;
}): boolean => config.generatedFields.includes(config.identityField);

const deriveTableReuseConfig = (
  options: JsonFileTableOptions
): JsonFileTableReuseConfig => {
  const generatedFields = [...options.table.generated].toSorted();
  return {
    generateIdentity: usesGeneratedIdentity({
      generatedFields,
      identityField: options.table.identity,
    })
      ? options.generateIdentity
      : undefined,
    generatedFields,
    identityField: options.table.identity,
    isVersioned: options.table.versioned,
  };
};

const diffTableReuseConfig = (
  cached: JsonFileTableReuseConfig,
  incoming: JsonFileTableReuseConfig
): readonly string[] => {
  const mismatches: string[] = [];

  if (cached.identityField !== incoming.identityField) {
    mismatches.push('identityField');
  }

  if (cached.isVersioned !== incoming.isVersioned) {
    mismatches.push('versioned');
  }

  if (
    cached.generatedFields.length !== incoming.generatedFields.length ||
    cached.generatedFields.some(
      (field, index) => field !== incoming.generatedFields[index]
    )
  ) {
    mismatches.push('generatedFields');
  }

  if (cached.generateIdentity !== incoming.generateIdentity) {
    mismatches.push('generateIdentity');
  }

  return mismatches;
};

const assertCompatibleTableReuse = (
  path: string,
  cached: JsonFileTableReuseConfig,
  incoming: JsonFileTableReuseConfig
): void => {
  const mismatches = diffTableReuseConfig(cached, incoming);
  if (mismatches.length === 0) {
    return;
  }

  throw new ConflictError(
    `JSON file table reuse conflict for "${path}": ${mismatches.join(', ')} differ across connections. Reuse the same table config for a shared path or isolate the stores to different directories.`
  );
};

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
// Note: entries are never evicted. This is acceptable for v1 — the adapter
// targets single-process, short-lived servers where the number of distinct
// table paths is bounded by the store definition.
interface JsonFileTableRegistration<TTable extends AnyStoreTable> {
  readonly accessor: LoadableTable<TTable>;
  readonly reuseConfig: JsonFileTableReuseConfig;
}

const tableRegistry = new Map<
  string,
  JsonFileTableRegistration<AnyStoreTable>
>();

const bindSignals = Symbol('jsonfile.bindSignals');

interface SignalBinding {
  readonly table: AnyStoreTable;
  readonly fire: NonNullable<TrailContext['fire']>;
  readonly logger: TrailContext['logger'];
}

type BindableTable<TTable extends AnyStoreTable> = StoreAccessor<TTable> & {
  readonly [bindSignals]: (
    binding: SignalBinding | undefined
  ) => StoreAccessor<TTable>;
};

type LoadableTable<TTable extends AnyStoreTable> = BindableTable<TTable> & {
  readonly load: () => Promise<void>;
};

interface TableChange<TTable extends AnyStoreTable> {
  readonly kind: 'created' | 'updated' | 'removed';
  readonly entity: EntityOf<TTable>;
}

/**
 * Mirrors the awaited, write-preserving emission boundary in
 * adapters/drizzle/src/runtime.ts:1046 (fireDerivedSignal).
 */
const fireChange = async <TTable extends AnyStoreTable>(
  binding: SignalBinding,
  { kind, entity }: TableChange<TTable>
): Promise<void> => {
  const signal = binding.table.signals[kind];
  try {
    await binding.fire(signal, entity);
  } catch (error) {
    try {
      const log = normalizeObserve(binding.logger)?.log;
      if (log !== undefined) {
        createObserveLogger(log, 'store.jsonfile', {}).warn(
          `Signal "${signal.id}" emission threw after a successful write`,
          { error }
        );
      }
    } catch {
      // Diagnostic failures cannot turn a persisted mutation into a failed write.
    }
  }
};

interface TableState<TTable extends AnyStoreTable> {
  readonly index: Map<string, EntityOf<TTable>>;
  readonly mutex: MutexHandle;
  readonly path: string;
  readonly cfg: TableConfig;
}

const createUpsert =
  <TTable extends AnyStoreTable>(
    { index, mutex, path, cfg }: TableState<TTable>,
    binding?: SignalBinding
  ) =>
  async (input: UpsertOf<TTable>): Promise<EntityOf<TTable>> => {
    await mutex.acquire();
    let change: TableChange<TTable> | undefined;
    let written: EntityOf<TTable>;
    try {
      const result = await executeUpsert(input, index, path, cfg);
      ({ written } = result);
      if (
        binding !== undefined &&
        (result.previous === undefined ||
          !Bun.deepEquals(result.previous, written))
      ) {
        change = {
          entity: written,
          kind: result.previous === undefined ? 'created' : 'updated',
        };
      }
    } finally {
      mutex.release();
    }
    if (binding !== undefined && change !== undefined) {
      await fireChange(binding, change);
    }
    return written;
  };

const createRemove =
  <TTable extends AnyStoreTable>(
    { index, mutex, path }: TableState<TTable>,
    binding?: SignalBinding
  ) =>
  async (
    id: StoreIdentifierOf<TTable>
  ): Promise<{ readonly deleted: boolean }> => {
    await mutex.acquire();
    let change: TableChange<TTable> | undefined;
    let removed: { readonly deleted: boolean };
    try {
      const existing = index.get(String(id));
      removed = await executeRemove(String(id), index, path);
      if (binding !== undefined && removed.deleted && existing !== undefined) {
        change = { entity: structuredClone(existing), kind: 'removed' };
      }
    } finally {
      mutex.release();
    }
    if (binding !== undefined && change !== undefined) {
      await fireChange(binding, change);
    }
    return removed;
  };

const createAccessor = <TTable extends AnyStoreTable>(
  state: TableState<TTable>,
  binding?: SignalBinding
): BindableTable<TTable> => {
  const accessor: StoreAccessor<TTable> = {
    get: createGetAccessor(state.index),
    list: createListAccessor(state.index),
    remove: createRemove(state, binding),
    upsert: createUpsert(state, binding),
  };
  return Object.defineProperty(accessor, bindSignals, {
    value: (nextBinding: SignalBinding | undefined) =>
      nextBinding === binding
        ? accessor
        : Object.freeze(createAccessor(state, nextBinding)),
  }) as BindableTable<TTable>;
};

const buildAndRegisterTable = <TTable extends AnyStoreTable>(
  path: string,
  options: JsonFileTableOptions
): LoadableTable<TTable> => {
  const mutex = createMutex();
  const index = new Map<string, EntityOf<TTable>>();
  const cfg = deriveTableConfig(options);

  const state: TableState<TTable> = { cfg, index, mutex, path };

  const instance: LoadableTable<TTable> = Object.assign(createAccessor(state), {
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
  });
  tableRegistry.set(path, {
    accessor: instance,
    reuseConfig: deriveTableReuseConfig(options),
  });
  return instance;
};

/**
 * Return a cached or freshly-built table instance for the given path.
 *
 * @remarks
 * Tables are shared per resolved file path so multiple connections stay
 * coherent in-process. Reuse is only allowed when table-affecting config
 * matches exactly; otherwise the adapter throws instead of silently
 * inheriting the first connection's runtime semantics.
 */
const createJsonFileTable = <TTable extends AnyStoreTable>(
  options: JsonFileTableOptions
): LoadableTable<TTable> => {
  const path = jsonFilePath(options.dir, options.table.name);
  const cached = tableRegistry.get(path) as
    | JsonFileTableRegistration<TTable>
    | undefined;
  if (cached === undefined) {
    return buildAndRegisterTable<TTable>(path, options);
  }

  assertCompatibleTableReuse(
    path,
    cached.reuseConfig,
    deriveTableReuseConfig(options)
  );
  return cached.accessor;
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

const bindConnectionSignals = <TStore extends AnyStoreDefinition>(
  definition: TStore,
  connection: JsonFileConnection<TStore['tables']>,
  { fire, logger }: Pick<TrailContext, 'fire' | 'logger'>
): JsonFileConnection<TStore['tables']> => {
  const bound = { ...connection };
  let changed = false;
  for (const tableName of definition.tableNames) {
    const table = definition.tables[tableName];
    const accessor = connection[tableName] as
      | Partial<BindableTable<AnyStoreTable>>
      | undefined;
    if (table !== undefined && accessor?.[bindSignals] !== undefined) {
      const next = accessor[bindSignals](
        fire === undefined ? undefined : { fire, logger, table }
      );
      if (next === accessor) {
        continue;
      }
      changed = true;
      Object.defineProperty(bound, tableName, {
        enumerable: true,
        value: next,
      });
    }
  }
  return changed ? Object.freeze(bound) : connection;
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
): JsonFileStoreResource<TStore['tables']> => {
  const scope = options.id ?? defaultResourceId;
  const store = bindStoreDefinition(definition, scope) as TStore;

  const value = resource(scope, {
    create: async () => {
      try {
        return Result.ok(await connectJsonFile(store, options));
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
    description:
      options.description ??
      'JSON-file-backed store bound from an @ontrails/store definition.',
    dispose: async (connection) => {
      const tmpDir = mockTmpDirs.get(connection as object);
      if (tmpDir !== undefined) {
        const { rm } = await import('node:fs/promises');
        await rm(tmpDir, { force: true, recursive: true });
        mockTmpDirs.delete(connection as object);
        for (const tableName of store.tableNames) {
          tableRegistry.delete(jsonFilePath(tmpDir, tableName));
        }
      }
    },
    meta: options.meta,
    mock: async () => {
      const { mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const tmpDir = await mkdtemp(join(tmpdir(), 'jsonfile-mock-'));
      const connection = await connectJsonFile(store, {
        ...options,
        dir: tmpDir,
      });
      await seedMockConnection(connection, store, options.mockSeed);
      mockTmpDirs.set(connection as object, tmpDir);
      return connection;
    },
    signals: store.signals,
  });
  return Object.freeze({
    ...value,
    from(ctx: TrailContext) {
      return bindConnectionSignals(store, value.from(ctx), ctx);
    },
  });
};
