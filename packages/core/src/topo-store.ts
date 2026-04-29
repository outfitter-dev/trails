import type { SQLQueryBindings } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';

import { NotFoundError } from './errors.js';
import type { Topo } from './topo.js';
import { resource } from './resource.js';
import { Result } from './result.js';
import {
  TOPO_SCHEMA_VERSION,
  ensureTopoSnapshotSchema,
  listTopoSnapshots as listStoredTopoSnapshots,
  pinTopoSnapshot as pinStoredTopoSnapshot,
  unpinTopoSnapshot as unpinStoredTopoSnapshot,
} from './internal/topo-snapshots.js';
import type {
  CreateTopoSnapshotInput,
  ListTopoSnapshotsOptions,
  TopoSnapshot,
} from './internal/topo-snapshots.js';
import type {
  TopoStoreExportRecord,
  TopoStoreResourceRecord,
  TopoStoreRef,
  TopoStoreSignalDetailRecord,
  TopoStoreSignalRecord,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './internal/topo-store-read.js';
import {
  getTopoStoreExport,
  getTopoStoreResource,
  getTopoStoreSignal,
  getTopoStoreTrail,
  listTopoStoreResources,
  listTopoStoreSignals,
  listTopoStoreSnapshots,
  listTopoStoreTrails,
  queryTopoStore,
  readTopoStoreSnapshot,
} from './internal/topo-store-read.js';
import { createTopoSnapshot as storeTopoSnapshot } from './internal/topo-store.js';
import {
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
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
    ensureTopoSnapshotSchema(db);
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
 * Ensure the topo snapshot schema is at the current version before any
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
  const dbPath = deriveTrailsDbPath(options);
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
  TopoStoreSignalDetailRecord,
  TopoStoreSignalRecord,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './internal/topo-store-read.js';
export type {
  CreateTopoSnapshotInput,
  ListTopoSnapshotsOptions,
  TopoSnapshot,
} from './internal/topo-snapshots.js';

export interface ReadOnlyTopoStore {
  readonly exports: {
    get(ref?: TopoStoreRef): TopoStoreExportRecord | undefined;
  };
  query<TRow extends Record<string, unknown>>(
    sql: string,
    bindings?: readonly SQLQueryBindings[]
  ): readonly TRow[];
  readonly resources: {
    get(
      id: string,
      options?: { readonly snapshot?: TopoStoreRef }
    ): TopoStoreResourceRecord | undefined;
    list(options?: {
      readonly snapshot?: TopoStoreRef;
    }): readonly TopoStoreResourceRecord[];
  };
  readonly signals: {
    get(
      id: string,
      options?: { readonly snapshot?: TopoStoreRef }
    ): TopoStoreSignalDetailRecord | undefined;
    list(options?: {
      readonly snapshot?: TopoStoreRef;
    }): readonly TopoStoreSignalRecord[];
  };
  readonly snapshots: {
    get(ref?: TopoStoreRef): TopoSnapshot | undefined;
    latest(): TopoSnapshot | undefined;
    list(options?: ListTopoSnapshotsOptions): readonly TopoSnapshot[];
  };
  readonly trails: {
    get(
      id: string,
      options?: { readonly snapshot?: TopoStoreRef }
    ): TopoStoreTrailDetailRecord | undefined;
    list(options?: {
      readonly intent?: TopoStoreTrailRecord['intent'];
      readonly snapshot?: TopoStoreRef;
    }): readonly TopoStoreTrailRecord[];
  };
}

export interface MockTopoStoreSeed {
  readonly exports?: readonly TopoStoreExportRecord[];
  readonly resources?: readonly TopoStoreResourceRecord[];
  readonly signals?: readonly TopoStoreSignalDetailRecord[];
  readonly snapshots?: readonly TopoSnapshot[];
  readonly trails?: readonly TopoStoreTrailDetailRecord[];
}

const missingStoreMessage =
  'No saved topo state found. Populate trails.db first or run a topo-backed surface.';

const resolveStoreRootDir = (options?: TrailsDbLocationOptions): string =>
  options?.rootDir ?? process.cwd();

const requireReadDb = (
  options?: TrailsDbLocationOptions
): ReturnType<typeof openReadTrailsDb> => {
  const dbPath = deriveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    throw new NotFoundError(missingStoreMessage);
  }
  ensureTopoMigratedIfExists(options);
  return openReadTrailsDb(options);
};

const requireSavedTopoState = (
  db: ReturnType<typeof openReadTrailsDb>
): void => {
  if (readTopoStoreSnapshot(db) === undefined) {
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
  const snapshots = [...(seed?.snapshots ?? [])];
  const trails = [...(seed?.trails ?? [])];
  const resources = [...(seed?.resources ?? [])];
  const signals = [...(seed?.signals ?? [])];
  const exports = [...(seed?.exports ?? [])];

  const resolveSnapshot = (ref?: TopoStoreRef): TopoSnapshot | undefined => {
    if (ref?.snapshotId !== undefined) {
      return snapshots.find((snapshot) => snapshot.id === ref.snapshotId);
    }
    if (ref?.pin !== undefined) {
      return snapshots.find((snapshot) => snapshot.pinnedAs === ref.pin);
    }
    return snapshots[0];
  };

  return {
    exports,
    resolveSnapshot,
    resources,
    signals,
    snapshots,
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
        const snapshot = resolved.resolveSnapshot(ref);
        return snapshot === undefined
          ? undefined
          : resolved.exports.find((entry) => entry.snapshot.id === snapshot.id);
      },
    },
    query() {
      throw new NotFoundError(
        'Mock topoStore.query() is unsupported. Seed typed accessors instead.'
      );
    },
    resources: {
      get(id, options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        return resolved.resources.find(
          (item) =>
            item.id === id &&
            (snapshot === undefined || item.snapshotId === snapshot.id)
        );
      },
      list(options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        return snapshot === undefined
          ? []
          : resolved.resources.filter(
              (item) => item.snapshotId === snapshot.id
            );
      },
    },
    signals: {
      get(id, options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        if (snapshot === undefined) {
          return;
        }
        return resolved.signals.find(
          (signal) => signal.id === id && signal.snapshotId === snapshot.id
        );
      },
      list(options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        if (snapshot === undefined) {
          return [];
        }
        return resolved.signals.filter(
          (signal) => signal.snapshotId === snapshot.id
        );
      },
    },
    snapshots: {
      get(ref?: TopoStoreRef) {
        return resolved.resolveSnapshot(ref);
      },
      latest() {
        return resolved.snapshots[0];
      },
      list(options) {
        let snapshots =
          options?.pinned === undefined
            ? resolved.snapshots
            : resolved.snapshots.filter((snapshot) =>
                options.pinned
                  ? snapshot.pinnedAs !== undefined
                  : snapshot.pinnedAs === undefined
              );
        if (options?.before !== undefined) {
          const target = snapshots.find((s) => s.id === options.before);
          if (target !== undefined) {
            snapshots = snapshots.filter(
              (s) =>
                s.createdAt < target.createdAt ||
                (s.createdAt === target.createdAt && s.id < target.id)
            );
          }
        }
        if (options?.limit !== undefined) {
          snapshots = snapshots.slice(0, options.limit);
        }
        return snapshots;
      },
    },
    trails: {
      get(id, options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        if (snapshot === undefined) {
          return;
        }
        return resolved.trails.find(
          (trail) => trail.id === id && trail.snapshotId === snapshot.id
        );
      },
      list(options) {
        const snapshot = resolved.resolveSnapshot(options?.snapshot);
        if (snapshot === undefined) {
          return [];
        }
        return resolved.trails.filter(
          (trail) =>
            trail.snapshotId === snapshot.id &&
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
  signals: {
    get(id, queryOptions) {
      return withStoredTopoState(options, (db) =>
        getTopoStoreSignal(db, id, queryOptions)
      );
    },
    list(queryOptions) {
      return withStoredTopoState(options, (db) =>
        listTopoStoreSignals(db, queryOptions)
      );
    },
  },
  snapshots: {
    get(ref?: TopoStoreRef) {
      return withStoredTopoState(options, (db) =>
        readTopoStoreSnapshot(db, ref)
      );
    },
    latest() {
      return withStoredTopoState(options, (db) => readTopoStoreSnapshot(db));
    },
    list(snapshotOptions) {
      return withStoredTopoState(options, (db) =>
        listTopoStoreSnapshots(db, snapshotOptions)
      );
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

export const createTopoSnapshot = (
  topo: Topo,
  options?: TrailsDbLocationOptions & CreateTopoSnapshotInput
): Result<TopoSnapshot, Error> => {
  const db = openWriteTrailsDb(options);
  try {
    return storeTopoSnapshot(db, topo, options);
  } finally {
    db.close();
  }
};

export const listTopoSnapshots = (
  options?: TrailsDbLocationOptions & ListTopoSnapshotsOptions
): readonly TopoSnapshot[] => {
  const dbPath = deriveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    return [];
  }

  ensureTopoMigratedIfExists(options);
  const db = openReadTrailsDb(options);
  try {
    return listStoredTopoSnapshots(db, options);
  } finally {
    db.close();
  }
};

export const pinTopoSnapshot = (
  id: string,
  name: string,
  options?: TrailsDbLocationOptions
): TopoSnapshot | undefined => {
  const dbPath = deriveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    return undefined;
  }

  const db = openWriteTrailsDb(options);
  try {
    return pinStoredTopoSnapshot(db, { id, name });
  } finally {
    db.close();
  }
};

export const unpinTopoSnapshot = (
  nameOrId: string,
  options?: TrailsDbLocationOptions
): TopoSnapshot | undefined => {
  const dbPath = deriveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    return undefined;
  }

  const db = openWriteTrailsDb(options);
  try {
    return unpinStoredTopoSnapshot(db, nameOrId);
  } finally {
    db.close();
  }
};

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
