import type { SQLQueryBindings } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';

import { NotFoundError } from './errors.js';
import { resource } from './resource.js';
import { Result } from './result.js';
import type { TopoPinRecord, TopoSaveRecord } from './internal/topo-saves.js';
import {
  TOPO_SCHEMA_VERSION,
  ensureTopoHistorySchema,
  getTopoPin,
} from './internal/topo-saves.js';
import type {
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './internal/topo-store-read.js';
import {
  getTopoStoreExport,
  getTopoStoreResource,
  getTopoStoreTrail,
  listTopoStorePins,
  listTopoStoreResources,
  listTopoStoreSaves,
  listTopoStoreTrails,
  queryTopoStore,
  resolveTopoStoreSave,
} from './internal/topo-store-read.js';
import {
  openReadTrailsDb,
  openWriteTrailsDb,
  resolveTrailsDbPath,
} from './internal/trails-db.js';
import type { TrailsDbLocationOptions } from './internal/trails-db.js';

interface MigratedDbIdentity {
  readonly mtimeMs: number;
  readonly size: number;
}

const migratedTopoDbPaths = new Map<string, MigratedDbIdentity>();

/**
 * Test-only instrumentation counters. Incremented by the read-path migration
 * check to let tests assert that a current-schema store does not escalate to
 * a write-mode open, and that cache invalidation re-runs the check when the
 * underlying file is replaced.
 *
 * @internal
 */
export const __topoStoreMigrationStats = {
  peekCalls: 0,
  writeEscalations: 0,
};

const peekTopoSchemaVersion = (
  options: TrailsDbLocationOptions | undefined
): number | undefined => {
  let db: ReturnType<typeof openReadTrailsDb> | undefined;
  try {
    db = openReadTrailsDb(options);
    const row = db
      .query<{ version: number }, [string]>(
        'SELECT version FROM meta_schema_versions WHERE subsystem = ?'
      )
      .get('topo');
    return row?.version ?? 0;
  } catch {
    // Table missing or unexpected shape: caller will escalate to a write-mode
    // open and run the migration, which rebuilds the schema.
    return undefined;
  } finally {
    db?.close();
  }
};

const statIdentity = (dbPath: string): MigratedDbIdentity | undefined => {
  try {
    const info = statSync(dbPath);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return undefined;
  }
};

const identitiesEqual = (
  a: MigratedDbIdentity,
  b: MigratedDbIdentity
): boolean => a.mtimeMs === b.mtimeMs && a.size === b.size;

const runTopoMigrationEscalation = (
  options: TrailsDbLocationOptions | undefined,
  dbPath: string,
  fallbackIdentity: MigratedDbIdentity
): void => {
  __topoStoreMigrationStats.writeEscalations += 1;
  const db = openWriteTrailsDb(options);
  try {
    ensureTopoHistorySchema(db);
  } finally {
    db.close();
  }
  // Re-stat after the migration so the cached identity matches the file we
  // just touched, avoiding a spurious second escalation on the next read.
  const postIdentity = statIdentity(dbPath) ?? fallbackIdentity;
  migratedTopoDbPaths.set(dbPath, postIdentity);
};

const resolveIdentityIfFresh = (
  dbPath: string
): MigratedDbIdentity | undefined => {
  if (!existsSync(dbPath)) {
    return undefined;
  }
  const identity = statIdentity(dbPath);
  if (identity === undefined) {
    return undefined;
  }
  const cached = migratedTopoDbPaths.get(dbPath);
  if (cached !== undefined && identitiesEqual(cached, identity)) {
    return undefined;
  }
  return identity;
};

/**
 * Ensure the topo history schema is at the current version before any
 * read-only access. Peeks the version through a read-only handle first and
 * only escalates to a write-mode open + migration when the store is stale.
 *
 * Memoized per resolved DB path keyed on file identity (mtime + size) so a
 * long-running process that deletes and recreates `trails.db` re-runs the
 * migration check against the fresh file.
 *
 * If the DB file does not yet exist, this is a no-op — the downstream read
 * path will surface its own NotFoundError.
 */
const ensureTopoMigratedIfExists = (
  options?: TrailsDbLocationOptions
): void => {
  const dbPath = resolveTrailsDbPath(options);
  const identity = resolveIdentityIfFresh(dbPath);
  if (identity === undefined) {
    return;
  }

  __topoStoreMigrationStats.peekCalls += 1;
  const version = peekTopoSchemaVersion(options);
  if (version !== undefined && version >= TOPO_SCHEMA_VERSION) {
    // Already current — record identity and skip the write-mode open entirely,
    // preserving the read-only contract for callers whose filesystem mounts
    // `trails.db` read-only.
    migratedTopoDbPaths.set(dbPath, identity);
    return;
  }

  runTopoMigrationEscalation(options, dbPath, identity);
};

export type {
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './internal/topo-store-read.js';

export interface ReadOnlyTopoStore {
  readonly exports: {
    get(ref?: TopoStoreRef): TopoStoreExportRecord | undefined;
  };
  readonly pins: {
    get(name: string): TopoPinRecord | undefined;
    list(): readonly TopoPinRecord[];
  };
  query<TRow extends Record<string, unknown>>(
    sql: string,
    bindings?: readonly SQLQueryBindings[]
  ): readonly TRow[];
  readonly resources: {
    get(
      id: string,
      options?: { readonly save?: TopoStoreRef }
    ): TopoStoreResourceRecord | undefined;
    list(options?: {
      readonly save?: TopoStoreRef;
    }): readonly TopoStoreResourceRecord[];
  };
  readonly saves: {
    get(ref?: TopoStoreRef): TopoSaveRecord | undefined;
    latest(): TopoSaveRecord | undefined;
    list(): readonly TopoSaveRecord[];
  };
  readonly trails: {
    get(
      id: string,
      options?: { readonly save?: TopoStoreRef }
    ): TopoStoreTrailDetailRecord | undefined;
    list(options?: {
      readonly intent?: TopoStoreTrailRecord['intent'];
      readonly save?: TopoStoreRef;
    }): readonly TopoStoreTrailRecord[];
  };
}

export interface MockTopoStoreSeed {
  readonly exports?: readonly TopoStoreExportRecord[];
  readonly pins?: readonly TopoPinRecord[];
  readonly resources?: readonly TopoStoreResourceRecord[];
  readonly saves?: readonly TopoSaveRecord[];
  readonly trails?: readonly TopoStoreTrailDetailRecord[];
}

const missingStoreMessage =
  'No saved topo state found. Populate trails.db first or run a topo-backed surface.';

const resolveStoreRootDir = (options?: TrailsDbLocationOptions): string =>
  options?.rootDir ?? process.cwd();

const requireReadDb = (
  options?: TrailsDbLocationOptions
): ReturnType<typeof openReadTrailsDb> => {
  const dbPath = resolveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    throw new NotFoundError(missingStoreMessage);
  }
  ensureTopoMigratedIfExists(options);
  return openReadTrailsDb(options);
};

const requireSavedTopoState = (
  db: ReturnType<typeof openReadTrailsDb>
): void => {
  if (resolveTopoStoreSave(db) === undefined) {
    throw new NotFoundError(missingStoreMessage);
  }
};

const withStoredTopoState = <T>(
  options: TrailsDbLocationOptions | undefined,
  run: (db: ReturnType<typeof openReadTrailsDb>) => T
): T => {
  const db = requireReadDb(options);
  try {
    requireSavedTopoState(db);
    return run(db);
  } finally {
    db.close();
  }
};

const createSeedResolver = (seed?: MockTopoStoreSeed) => {
  const saves = [...(seed?.saves ?? [])];
  const pins = [...(seed?.pins ?? [])];
  const trails = [...(seed?.trails ?? [])];
  const resources = [...(seed?.resources ?? [])];
  const exports = [...(seed?.exports ?? [])];

  const resolveSave = (ref?: TopoStoreRef): TopoSaveRecord | undefined => {
    if (ref?.saveId !== undefined) {
      return saves.find((save) => save.id === ref.saveId);
    }
    if (ref?.pin !== undefined) {
      const pin = pins.find((candidate) => candidate.name === ref.pin);
      return pin === undefined
        ? undefined
        : saves.find((save) => save.id === pin.saveId);
    }
    return saves[0];
  };

  return {
    exports,
    pins,
    resolveSave,
    resources,
    saves,
    trails,
  };
};

export const createMockTopoStore = (
  seed?: MockTopoStoreSeed
): ReadOnlyTopoStore => {
  const resolved = createSeedResolver(seed);

  return {
    exports: {
      get(ref?: TopoStoreRef) {
        const save = resolved.resolveSave(ref);
        return save === undefined
          ? undefined
          : resolved.exports.find((entry) => entry.save.id === save.id);
      },
    },
    pins: {
      get(name: string) {
        return resolved.pins.find((pin) => pin.name === name);
      },
      list() {
        return resolved.pins;
      },
    },
    query() {
      throw new NotFoundError(
        'Mock topoStore.query() is unsupported. Seed typed accessors instead.'
      );
    },
    resources: {
      get(id, options) {
        const save = resolved.resolveSave(options?.save);
        return resolved.resources.find(
          (item) =>
            item.id === id && (save === undefined || item.saveId === save.id)
        );
      },
      list(options) {
        const save = resolved.resolveSave(options?.save);
        return save === undefined
          ? []
          : resolved.resources.filter((item) => item.saveId === save.id);
      },
    },
    saves: {
      get(ref?: TopoStoreRef) {
        return resolved.resolveSave(ref);
      },
      latest() {
        return resolved.saves[0];
      },
      list() {
        return resolved.saves;
      },
    },
    trails: {
      get(id, options) {
        const save = resolved.resolveSave(options?.save);
        if (save === undefined) {
          return;
        }
        return resolved.trails.find(
          (trail) => trail.id === id && trail.saveId === save.id
        );
      },
      list(options) {
        const save = resolved.resolveSave(options?.save);
        if (save === undefined) {
          return [];
        }
        return resolved.trails.filter(
          (trail) =>
            trail.saveId === save.id &&
            (options?.intent === undefined || trail.intent === options.intent)
        );
      },
    },
  };
};

export const createTopoStore = (
  options?: TrailsDbLocationOptions
): ReadOnlyTopoStore => ({
  exports: {
    get(ref?: TopoStoreRef) {
      return withStoredTopoState(options, (db) => getTopoStoreExport(db, ref));
    },
  },
  pins: {
    get(name: string) {
      return withStoredTopoState(options, (db) => getTopoPin(db, name));
    },
    list() {
      return withStoredTopoState(options, (db) => listTopoStorePins(db));
    },
  },
  query<TRow extends Record<string, unknown>>(
    sql: string,
    bindings?: readonly SQLQueryBindings[]
  ) {
    return withStoredTopoState(options, (db) =>
      queryTopoStore<TRow>(db, sql, bindings)
    );
  },
  resources: {
    get(id, queryOptions) {
      return withStoredTopoState(options, (db) =>
        getTopoStoreResource(db, id, queryOptions)
      );
    },
    list(queryOptions) {
      return withStoredTopoState(options, (db) =>
        listTopoStoreResources(db, queryOptions)
      );
    },
  },
  saves: {
    get(ref?: TopoStoreRef) {
      return withStoredTopoState(options, (db) =>
        resolveTopoStoreSave(db, ref)
      );
    },
    latest() {
      return withStoredTopoState(options, (db) => resolveTopoStoreSave(db));
    },
    list() {
      return withStoredTopoState(options, (db) => listTopoStoreSaves(db));
    },
  },
  trails: {
    get(id, queryOptions) {
      return withStoredTopoState(options, (db) =>
        getTopoStoreTrail(db, id, queryOptions)
      );
    },
    list(queryOptions) {
      return withStoredTopoState(options, (db) =>
        listTopoStoreTrails(db, queryOptions)
      );
    },
  },
});

export const topoStore = resource('topo.store', {
  create: (svc) =>
    Result.ok(
      createTopoStore({
        rootDir: svc.workspaceRoot ?? svc.cwd ?? resolveStoreRootDir(),
      })
    ),
  description: 'Read-only query access to saved topo state in trails.db',
  mock: () => createMockTopoStore(),
});
