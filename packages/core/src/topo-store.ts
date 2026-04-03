import type { SQLQueryBindings } from 'bun:sqlite';
import { existsSync } from 'node:fs';

import { NotFoundError } from './errors.js';
import { provision } from './provision.js';
import { Result } from './result.js';
import type { TopoPinRecord, TopoSaveRecord } from './internal/topo-saves.js';
import { getTopoPin } from './internal/topo-saves.js';
import type {
  TopoStoreExportRecord,
  TopoStoreProvisionRecord,
  TopoStoreRef,
  TopoStoreTrailDetailRecord,
  TopoStoreTrailRecord,
} from './internal/topo-store-read.js';
import {
  getTopoStoreExport,
  getTopoStoreProvision,
  getTopoStoreTrail,
  listTopoStorePins,
  listTopoStoreProvisions,
  listTopoStoreSaves,
  listTopoStoreTrails,
  queryTopoStore,
  resolveTopoStoreSave,
} from './internal/topo-store-read.js';
import { openReadTrailsDb, resolveTrailsDbPath } from './internal/trails-db.js';
import type { TrailsDbLocationOptions } from './internal/trails-db.js';

export type {
  TopoStoreExportRecord,
  TopoStoreProvisionRecord,
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
  readonly provisions: {
    get(
      id: string,
      options?: { readonly save?: TopoStoreRef }
    ): TopoStoreProvisionRecord | undefined;
    list(options?: {
      readonly save?: TopoStoreRef;
    }): readonly TopoStoreProvisionRecord[];
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
  readonly provisions?: readonly TopoStoreProvisionRecord[];
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
  const provisions = [...(seed?.provisions ?? [])];
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
    provisions,
    resolveSave,
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
    provisions: {
      get(id, options) {
        const save = resolved.resolveSave(options?.save);
        return resolved.provisions.find(
          (item) =>
            item.id === id && (save === undefined || item.saveId === save.id)
        );
      },
      list(options) {
        const save = resolved.resolveSave(options?.save);
        return save === undefined
          ? []
          : resolved.provisions.filter((item) => item.saveId === save.id);
      },
    },
    query() {
      throw new NotFoundError(
        'Mock topoStore.query() is unsupported. Seed typed accessors instead.'
      );
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
  provisions: {
    get(id, queryOptions) {
      return withStoredTopoState(options, (db) =>
        getTopoStoreProvision(db, id, queryOptions)
      );
    },
    list(queryOptions) {
      return withStoredTopoState(options, (db) =>
        listTopoStoreProvisions(db, queryOptions)
      );
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

export const topoStore = provision('topo.store', {
  create: (svc) =>
    Result.ok(
      createTopoStore({
        rootDir: svc.workspaceRoot ?? svc.cwd ?? resolveStoreRootDir(),
      })
    ),
  description: 'Read-only query access to saved topo state in trails.db',
  mock: () => createMockTopoStore(),
});
