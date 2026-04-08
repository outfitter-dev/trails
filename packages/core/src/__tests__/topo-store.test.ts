import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { Result, resource, signal, topo, trail } from '../index.js';
import { __topoStoreMigrationStats, createTopoStore } from '../topo-store.js';
import {
  ensureTopoHistorySchema,
  pinTopoSave,
  pruneUnpinnedTopoSaves,
} from '../internal/topo-saves.js';
import {
  getStoredTopoExport,
  normalizeFiresRows,
  normalizeOnRows,
  persistEstablishedTopoSave,
} from '../internal/topo-store.js';
import { openWriteTrailsDb } from '../internal/trails-db.js';

const noop = () => Result.ok({ ok: true });

/** Unwrap a Result in tests, throwing on Err. */
const unwrap = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const countRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  tableName: string,
  saveId?: string
): number => {
  const row =
    saveId === undefined
      ? db
          .query<{ count: number }, []>(
            `SELECT COUNT(*) as count FROM ${tableName}`
          )
          .get()
      : db
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) as count FROM ${tableName} WHERE save_id = ?`
          )
          .get(saveId);
  return row?.count ?? 0;
};

const tableExists = (
  db: ReturnType<typeof openWriteTrailsDb>,
  tableName: string
): boolean => {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(tableName);
  return row?.name === tableName;
};

const exampleApp = () => {
  const dbMain = resource('db.main', {
    create: () => Result.ok({ source: 'factory' }),
    description: 'Primary database',
    health: () => Result.ok({ ok: true }),
    mock: () => ({ source: 'mock' }),
  });

  const searchIndex = resource('search.index', {
    create: () => Result.ok({ source: 'factory' }),
    mock: () => ({ source: 'mock' }),
  });

  const entityAdded = signal('entity.added', {
    description: 'An entity was added',
    from: ['entity.add'],
    payload: z.object({ id: z.string() }),
  });

  const entityAdd = trail('entity.add', {
    blaze: (input: { readonly name: string }) =>
      Result.ok({ id: input.name.toLowerCase(), ok: true }),
    description: 'Add a new entity',
    examples: [
      {
        expected: { id: 'ada', ok: true },
        input: { name: 'Ada' },
        name: 'Add Ada',
      },
      {
        error: 'ConflictError',
        input: { name: 'Existing' },
        name: 'Conflict on duplicate',
      },
    ],
    input: z.object({ name: z.string() }),
    meta: { owner: 'core', tags: ['write', 'entity'] },
    output: z.object({ id: z.string(), ok: z.boolean() }),
    resources: [dbMain, searchIndex],
  });

  const entityList = trail('entity.list', {
    blaze: () => Result.ok({ items: ['ada'] }),
    crosses: ['entity.add'],
    description: 'List entities',
    idempotent: true,
    input: z.object({}),
    intent: 'read',
    output: z.object({ items: z.array(z.string()) }),
    resources: [dbMain],
  });

  return topo('projection-app', {
    dbMain,
    entityAdd,
    entityAdded,
    entityList,
    searchIndex,
  });
};

const readTrailRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) =>
  db
    .query<
      {
        description: string | null;
        example_count: number;
        has_output: number;
        id: string;
        idempotent: number;
        intent: string;
        meta: string | null;
      },
      [string]
    >(
      `SELECT id, intent, idempotent, has_output, example_count, description, meta
       FROM topo_trails
       WHERE save_id = ?
       ORDER BY id ASC`
    )
    .all(saveId);

const readTrailSignalRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) =>
  db
    .query<{ signal_id: string; trail_id: string }, [string]>(
      `SELECT trail_id, signal_id
       FROM topo_trail_signals
       WHERE save_id = ?`
    )
    .all(saveId);

const readTrailheadRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) =>
  db
    .query<{ derived_name: string; trail_id: string }, [string]>(
      `SELECT trail_id, derived_name
       FROM topo_trailheads
       WHERE save_id = ?
       ORDER BY trail_id ASC`
    )
    .all(saveId);

const readExampleRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) =>
  db
    .query<
      {
        error: string | null;
        expected: string | null;
        input: string;
        name: string;
        ordinal: number;
      },
      [string]
    >(
      `SELECT ordinal, name, input, expected, error
       FROM topo_examples
       WHERE save_id = ?
       ORDER BY ordinal ASC`
    )
    .all(saveId);

const readProjectedTrailIds = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) =>
  db
    .query<{ id: string }, [string]>(
      'SELECT id FROM topo_trails WHERE save_id = ? ORDER BY id ASC'
    )
    .all(saveId)
    .map((row) => row.id);

const requireStoredExport = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
) => {
  const stored = getStoredTopoExport(db, saveId);
  if (stored === undefined) {
    throw new Error(`Expected stored topo export for save "${saveId}"`);
  }
  return stored;
};

const expectProjectionCounts = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
): void => {
  expect(countRows(db, 'topo_trails', saveId)).toBe(2);
  expect(countRows(db, 'topo_crossings', saveId)).toBe(1);
  expect(countRows(db, 'topo_trail_resources', saveId)).toBe(3);
  expect(countRows(db, 'topo_resources', saveId)).toBe(2);
  expect(countRows(db, 'topo_signals', saveId)).toBe(1);
  expect(countRows(db, 'topo_trail_signals', saveId)).toBe(1);
  expect(countRows(db, 'topo_trailheads', saveId)).toBe(2);
  expect(countRows(db, 'topo_examples', saveId)).toBe(2);
  expect(countRows(db, 'topo_schemas', saveId)).toBe(5);
  expect(countRows(db, 'topo_exports')).toBeGreaterThanOrEqual(1);
};

const expectProjectedFixtureRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string
): void => {
  expect(readTrailRows(db, saveId)).toEqual([
    {
      description: 'Add a new entity',
      example_count: 2,
      has_output: 1,
      id: 'entity.add',
      idempotent: 0,
      intent: 'write',
      meta: JSON.stringify({
        owner: 'core',
        tags: ['write', 'entity'],
      }),
    },
    {
      description: 'List entities',
      example_count: 0,
      has_output: 1,
      id: 'entity.list',
      idempotent: 1,
      intent: 'read',
      meta: null,
    },
  ]);
  expect(readTrailSignalRows(db, saveId)).toEqual([
    { signal_id: 'entity.added', trail_id: 'entity.add' },
  ]);
  expect(readTrailheadRows(db, saveId)).toEqual([
    { derived_name: 'entity add', trail_id: 'entity.add' },
    { derived_name: 'entity list', trail_id: 'entity.list' },
  ]);
  expect(readExampleRows(db, saveId)).toEqual([
    {
      error: null,
      expected: JSON.stringify({ id: 'ada', ok: true }),
      input: JSON.stringify({ name: 'Ada' }),
      name: 'Add Ada',
      ordinal: 0,
    },
    {
      error: 'ConflictError',
      expected: null,
      input: JSON.stringify({ name: 'Existing' }),
      name: 'Conflict on duplicate',
      ordinal: 1,
    },
  ]);
};

const simpleProjectionApp = (withList: boolean) =>
  topo('projection-app', {
    entityAdd: trail('entity.add', {
      blaze: noop,
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    }),
    ...(withList
      ? {
          entityList: trail('entity.list', {
            blaze: () => Result.ok({ items: ['one'] }),
            input: z.object({}),
            intent: 'read',
            output: z.object({ items: z.array(z.string()) }),
          }),
        }
      : {}),
  });

const expectDisposableSaveCascaded = (
  db: ReturnType<typeof openWriteTrailsDb>,
  disposableId: string
): void => {
  expect(countRows(db, 'topo_trails', disposableId)).toBe(0);
  expect(countRows(db, 'topo_crossings', disposableId)).toBe(0);
  expect(countRows(db, 'topo_examples', disposableId)).toBe(0);
  expect(countRows(db, 'topo_schemas', disposableId)).toBe(0);
  expect(countRows(db, 'topo_trail_fires', disposableId)).toBe(0);
  expect(countRows(db, 'topo_trail_on', disposableId)).toBe(0);
};

const expectSignalEdgeCounts = (
  db: ReturnType<typeof openWriteTrailsDb>,
  saveId: string,
  count: number
): void => {
  expect(countRows(db, 'topo_trail_fires', saveId)).toBe(count);
  expect(countRows(db, 'topo_trail_on', saveId)).toBe(count);
};

const buildSignalPruneApp = () => {
  const created = signal('entity.created', {
    from: ['entity.create'],
    payload: z.object({ id: z.string() }),
  });
  const createTrail = trail('entity.create', {
    blaze: () => Result.ok({ id: 'x' }),
    fires: ['entity.created'],
    input: z.object({}),
    output: z.object({ id: z.string() }),
  });
  const indexTrail = trail('entity.index', {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({}),
    on: ['entity.created'],
    output: z.object({ ok: z.boolean() }),
  });
  return topo('prune-signal-app', {
    createTrail,
    created,
    indexTrail,
  });
};

const seedLegacyProvisionSchema = (
  db: ReturnType<typeof openWriteTrailsDb>,
  legacyVersion = 4
): void => {
  db.run(
    `INSERT INTO meta_schema_versions (subsystem, version, updated_at)
     VALUES ('topo', ?, ?)`,
    [legacyVersion, '2026-04-03T10:00:00.000Z']
  );
  db.run(`CREATE TABLE topo_saves (
    id TEXT PRIMARY KEY,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL DEFAULT 0,
    trail_count INTEGER NOT NULL DEFAULT 0,
    signal_count INTEGER NOT NULL DEFAULT 0,
    provision_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE topo_provisions (
    id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (id, save_id)
  )`);
  db.run(`CREATE TABLE topo_trail_provisions (
    trail_id TEXT NOT NULL,
    provision_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, provision_id, save_id)
  )`);
};

const seedLegacyProvisionStoreWithRow = (rootDir: string): void => {
  const db = openWriteTrailsDb({ rootDir });
  try {
    seedLegacyProvisionSchema(db, 4);
    db.run(
      `INSERT INTO topo_saves (
        id, git_sha, git_dirty, trail_count, signal_count, provision_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['legacy-save', 'sha', 0, 0, 0, 0, '2026-04-03T11:00:00.000Z']
    );
  } finally {
    db.close();
  }
};

const captureReadError = (run: () => unknown): unknown => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
};

const withWriteDb = (
  rootDir: string,
  run: (db: ReturnType<typeof openWriteTrailsDb>) => void
): void => {
  const db = openWriteTrailsDb({ rootDir });
  try {
    run(db);
  } finally {
    db.close();
  }
};

const seedOrphanLegacyProvisionTables = (
  db: ReturnType<typeof openWriteTrailsDb>
): void => {
  // Seed a v2 store with the new-style `resource_count` column but orphan
  // legacy `topo_provisions` / `topo_trail_provisions` tables hanging around.
  db.run(
    `INSERT INTO meta_schema_versions (subsystem, version, updated_at)
     VALUES ('topo', 2, ?)`,
    ['2026-04-03T10:00:00.000Z']
  );
  db.run(`CREATE TABLE topo_saves (
    id TEXT PRIMARY KEY,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL DEFAULT 0,
    trail_count INTEGER NOT NULL DEFAULT 0,
    signal_count INTEGER NOT NULL DEFAULT 0,
    resource_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE topo_provisions (
    id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (id, save_id)
  )`);
  db.run(`CREATE TABLE topo_trail_provisions (
    trail_id TEXT NOT NULL,
    provision_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, provision_id, save_id)
  )`);
};

const assertLegacyProvisionSchemaDropped = (
  db: ReturnType<typeof openWriteTrailsDb>
): void => {
  expect(tableExists(db, 'topo_provisions')).toBe(false);
  expect(tableExists(db, 'topo_trail_provisions')).toBe(false);
  expect(tableExists(db, 'topo_resources')).toBe(true);
  expect(tableExists(db, 'topo_trail_resources')).toBe(true);
  const columns = db
    .query<{ name: string }, []>('PRAGMA table_info(topo_saves)')
    .all();
  const columnNames = columns.map((column) => column.name);
  expect(columnNames).toContain('resource_count');
  expect(columnNames).not.toContain('provision_count');
};

const seedCurrentSchemaStore = (rootDir: string): void => {
  const db = openWriteTrailsDb({ rootDir });
  try {
    ensureTopoHistorySchema(db);
  } finally {
    db.close();
  }
};

const assertNoWriteEscalationOnReads = (rootDir: string): void => {
  const baselineEscalations = __topoStoreMigrationStats.writeEscalations;
  const baselinePeeks = __topoStoreMigrationStats.peekCalls;

  // First read: peek must happen, no write-mode escalation.
  const caught = captureReadError(() =>
    createTopoStore({ rootDir }).saves.latest()
  );
  expect(caught).toBeInstanceOf(NotFoundError);
  expect(__topoStoreMigrationStats.peekCalls).toBe(baselinePeeks + 1);
  expect(__topoStoreMigrationStats.writeEscalations).toBe(baselineEscalations);

  // Second read is served entirely from the memoized identity.
  captureReadError(() => createTopoStore({ rootDir }).saves.latest());
  expect(__topoStoreMigrationStats.peekCalls).toBe(baselinePeeks + 1);
  expect(__topoStoreMigrationStats.writeEscalations).toBe(baselineEscalations);
};

const replaceStoreWithLegacyProvisionStore = async (
  rootDir: string
): Promise<void> => {
  // Ensure mtime/size differs so the cached identity is invalidated even on
  // filesystems with coarse mtime granularity.
  const dbPath = join(rootDir, '.trails', 'trails.db');
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  await Bun.sleep(10);
  seedLegacyProvisionStoreWithRow(rootDir);
};

const seedHistoryOnlyTopoSchema = (
  db: ReturnType<typeof openWriteTrailsDb>
): void => {
  db.run(
    `INSERT INTO meta_schema_versions (subsystem, version, updated_at)
     VALUES ('topo', 1, ?)`,
    ['2026-04-03T11:00:00.000Z']
  );
  db.run(`CREATE TABLE IF NOT EXISTS topo_saves (
    id TEXT PRIMARY KEY,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL DEFAULT 0,
    trail_count INTEGER NOT NULL DEFAULT 0,
    signal_count INTEGER NOT NULL DEFAULT 0,
    resource_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS topo_pins (
    name TEXT PRIMARY KEY,
    save_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);
  db.run(
    `INSERT INTO topo_saves (
      id, git_sha, git_dirty, trail_count, signal_count, resource_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['seed-save', 'seed123', 0, 1, 0, 0, '2026-04-03T11:00:00.000Z']
  );
  db.run('INSERT INTO topo_pins (name, save_id, created_at) VALUES (?, ?, ?)', [
    'seed-pin',
    'seed-save',
    '2026-04-03T11:01:00.000Z',
  ]);
};

describe('topo store projection', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'topo-store-'));
    return tmpRoot;
  };

  const withProjectionDb = (
    run: (db: ReturnType<typeof openWriteTrailsDb>) => void
  ): void => {
    const db = openWriteTrailsDb({ rootDir: makeRoot() });
    try {
      run(db);
    } finally {
      db.close();
    }
  };

  test('projects a save-scoped relational topo from the established app graph', () => {
    withProjectionDb((db) => {
      const save = unwrap(
        persistEstablishedTopoSave(db, exampleApp(), {
          createdAt: '2026-04-03T12:00:00.000Z',
          gitDirty: false,
          gitSha: 'abc123',
        })
      );
      expectProjectionCounts(db, save.id);
      expectProjectedFixtureRows(db, save.id);

      const stored = requireStoredExport(db, save.id);
      expect(JSON.parse(stored.trailheadMapJson)).toMatchObject({
        entries: expect.any(Array),
        generatedAt: '2026-04-03T12:00:00.000Z',
        version: '1.0',
      });
      expect(JSON.parse(stored.lockContent)).toMatchObject({
        apps: {
          'projection-app': {
            resources: expect.any(Object),
            signals: expect.any(Object),
            trails: expect.any(Object),
          },
        },
        generatedAt: '2026-04-03T12:00:00.000Z',
        hash: stored.trailheadHash,
        version: 1,
      });
    });
  });

  test('keeps projected rows isolated across successive saves', () => {
    withProjectionDb((db) => {
      const firstSave = unwrap(
        persistEstablishedTopoSave(db, simpleProjectionApp(false), {
          createdAt: '2026-04-03T12:00:00.000Z',
        })
      );
      const secondSave = unwrap(
        persistEstablishedTopoSave(db, simpleProjectionApp(true), {
          createdAt: '2026-04-03T12:05:00.000Z',
        })
      );

      expect(firstSave.id).not.toBe(secondSave.id);
      expect(countRows(db, 'topo_trails', firstSave.id)).toBe(1);
      expect(countRows(db, 'topo_trails', secondSave.id)).toBe(2);
      expect(readProjectedTrailIds(db, firstSave.id)).toEqual(['entity.add']);
      expect(readProjectedTrailIds(db, secondSave.id)).toEqual([
        'entity.add',
        'entity.list',
      ]);
      expect(requireStoredExport(db, firstSave.id).trailheadHash).not.toBe(
        requireStoredExport(db, secondSave.id).trailheadHash
      );
    });
  });

  test("pruning an unpinned save removes only that save's projected rows", () => {
    withProjectionDb((db) => {
      const pinned = unwrap(
        persistEstablishedTopoSave(db, buildSignalPruneApp(), {
          createdAt: '2026-04-03T12:00:00.000Z',
        })
      );
      pinTopoSave(db, { name: 'before-auth', saveId: pinned.id });

      const disposable = unwrap(
        persistEstablishedTopoSave(db, buildSignalPruneApp(), {
          createdAt: '2026-04-03T12:05:00.000Z',
        })
      );

      // Pre-prune: both saves have fires/on rows so the cascade is non-vacuous.
      expectSignalEdgeCounts(db, pinned.id, 1);
      expectSignalEdgeCounts(db, disposable.id, 1);

      expect(pruneUnpinnedTopoSaves(db, { keep: 0 })).toBe(1);

      // Pinned save retains its projected rows, including fires/on edges.
      expect(countRows(db, 'topo_trails', pinned.id)).toBe(2);
      expectSignalEdgeCounts(db, pinned.id, 1);

      expectDisposableSaveCascaded(db, disposable.id);
    });
  });

  test('persists fires and on edges for signal-declaring trails', () => {
    withProjectionDb((db) => {
      const created = signal('entity.created', {
        from: ['entity.create'],
        payload: z.object({ id: z.string() }),
      });
      const updated = signal('entity.updated', {
        from: ['entity.create'],
        payload: z.object({ id: z.string() }),
      });

      const createTrail = trail('entity.create', {
        blaze: () => Result.ok({ id: 'x' }),
        fires: ['entity.created', 'entity.updated'],
        input: z.object({}),
        output: z.object({ id: z.string() }),
      });
      const indexTrail = trail('entity.index', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
        on: ['entity.created'],
        output: z.object({ ok: z.boolean() }),
      });
      const auditTrail = trail('entity.audit', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
        on: ['entity.created', 'entity.updated'],
        output: z.object({ ok: z.boolean() }),
      });

      const save = unwrap(
        persistEstablishedTopoSave(
          db,
          topo('signal-edges-app', {
            auditTrail,
            createTrail,
            created,
            indexTrail,
            updated,
          })
        )
      );

      const fires = db
        .query<{ signal_id: string; trail_id: string }, [string]>(
          `SELECT trail_id, signal_id
           FROM topo_trail_fires
           WHERE save_id = ?
           ORDER BY trail_id ASC, signal_id ASC`
        )
        .all(save.id);
      expect(fires).toEqual([
        { signal_id: 'entity.created', trail_id: 'entity.create' },
        { signal_id: 'entity.updated', trail_id: 'entity.create' },
      ]);

      const on = db
        .query<{ signal_id: string; trail_id: string }, [string]>(
          `SELECT trail_id, signal_id
           FROM topo_trail_on
           WHERE save_id = ?
           ORDER BY trail_id ASC, signal_id ASC`
        )
        .all(save.id);
      expect(on).toEqual([
        { signal_id: 'entity.created', trail_id: 'entity.audit' },
        { signal_id: 'entity.updated', trail_id: 'entity.audit' },
        { signal_id: 'entity.created', trail_id: 'entity.index' },
      ]);
    });
  });

  describe('ADR-0023 legacy provision schema drop', () => {
    test('drops legacy provision schema per ADR-0023 on first open', () => {
      withProjectionDb((db) => {
        seedLegacyProvisionSchema(db);
        ensureTopoHistorySchema(db);
        assertLegacyProvisionSchemaDropped(db);
      });
    });

    // Regression: if dropLegacyProvisionSchema wipes every topo table because
    // of a legacy provision_count column, the version-delta migration must
    // not skip the base tables. A v2 or v3 store with provision_count would
    // otherwise end up with no topo_saves / topo_resources / topo_trail_resources.
    test('createTopoStore migrates a legacy v4 provision_count store on first read', () => {
      const rootDir = makeRoot();
      seedLegacyProvisionStoreWithRow(rootDir);

      // Pre-fix: this throws SQLiteError "no such column: resource_count"
      // because the read-only path SELECTs resource_count before any
      // migration runs. Post-fix: the migration runs first, drops the
      // legacy provision schema (per ADR-0023), and the empty post-migration
      // store surfaces a NotFoundError instead of a SQLite error.
      const caught = captureReadError(() =>
        createTopoStore({ rootDir }).saves.latest()
      );
      expect(caught).toBeInstanceOf(NotFoundError);

      withWriteDb(rootDir, (db) => {
        assertLegacyProvisionSchemaDropped(db);
      });
    });

    test('createTopoStore skips write-mode escalation when schema is current', () => {
      const rootDir = makeRoot();
      seedCurrentSchemaStore(rootDir);
      assertNoWriteEscalationOnReads(rootDir);
    });

    test('createTopoStore re-migrates after trails.db is replaced at the same path', async () => {
      const rootDir = makeRoot();

      // Round 1: seed a current-schema store and read through createTopoStore
      // to prime the migration cache.
      seedCurrentSchemaStore(rootDir);
      captureReadError(() => createTopoStore({ rootDir }).saves.latest());
      const baselineEscalations = __topoStoreMigrationStats.writeEscalations;

      await replaceStoreWithLegacyProvisionStore(rootDir);

      // Round 2: a fresh createTopoStore call must detect the file swap,
      // re-run the migration, and not surface a SQLiteError.
      const caught = captureReadError(() =>
        createTopoStore({ rootDir }).saves.latest()
      );
      expect(caught).toBeInstanceOf(NotFoundError);
      expect(__topoStoreMigrationStats.writeEscalations).toBe(
        baselineEscalations + 1
      );
      withWriteDb(rootDir, (db) => {
        assertLegacyProvisionSchemaDropped(db);
      });
    });

    test.each([2, 3] as const)(
      'rebuilds all tables when legacy schema drop happens from v%i',
      (legacyVersion) => {
        withProjectionDb((db) => {
          seedLegacyProvisionSchema(db, legacyVersion);
          ensureTopoHistorySchema(db);
          assertLegacyProvisionSchemaDropped(db);
          expect(tableExists(db, 'topo_trails')).toBe(true);
          expect(tableExists(db, 'topo_crossings')).toBe(true);
          expect(tableExists(db, 'topo_pins')).toBe(true);
        });
      }
    );

    // Regression: if the store already has `resource_count` on `topo_saves`
    // (e.g. from a partial manual migration) but orphan `topo_provisions` /
    // `topo_trail_provisions` tables remain, dropLegacyProvisionSchema must
    // still trigger a full rebuild. Previously this path fell through to the
    // version-delta migration, which for v2/v3 only created incremental
    // tables and left the store permanently missing topo_resources /
    // topo_trail_resources.
    test('rebuilds all tables when orphan legacy tables exist without legacy column', () => {
      withProjectionDb((db) => {
        seedOrphanLegacyProvisionTables(db);
        ensureTopoHistorySchema(db);
        assertLegacyProvisionSchemaDropped(db);
        expect(tableExists(db, 'topo_trails')).toBe(true);
        expect(tableExists(db, 'topo_crossings')).toBe(true);
        expect(tableExists(db, 'topo_pins')).toBe(true);
      });
    });
  });

  test('upgrades a history-only topo schema to the projected topo schema', () => {
    withProjectionDb((db) => {
      seedHistoryOnlyTopoSchema(db);
      ensureTopoHistorySchema(db);
      expect(
        db
          .query<{ version: number }, []>(
            "SELECT version FROM meta_schema_versions WHERE subsystem = 'topo'"
          )
          .get()?.version
      ).toBe(5);
      for (const table of [
        'topo_trails',
        'topo_crossings',
        'topo_examples',
        'topo_exports',
        'topo_schemas',
        'topo_trail_fires',
        'topo_trail_on',
      ]) {
        expect(tableExists(db, table)).toBe(true);
      }
      expect(countRows(db, 'topo_saves')).toBe(1);
      expect(countRows(db, 'topo_pins')).toBe(1);
    });
  });
});

describe('signal edge normalizers', () => {
  const makeTrail = (
    id: string,
    opts: {
      readonly fires?: readonly string[];
      readonly on?: readonly string[];
    }
  ) =>
    trail(id, {
      blaze: () => Result.ok({ ok: true }),
      ...(opts.fires ? { fires: opts.fires } : {}),
      input: z.object({}),
      ...(opts.on ? { on: opts.on } : {}),
      output: z.object({ ok: z.boolean() }),
    });

  test('normalizeFiresRows produces one row per (trail, signal) pair', () => {
    const trails = [
      makeTrail('t.one', { fires: ['s.a', 's.b'] }),
      makeTrail('t.two', { fires: ['s.a'] }),
    ];
    expect(normalizeFiresRows(trails, 'save-1')).toEqual([
      { saveId: 'save-1', signalId: 's.a', trailId: 't.one' },
      { saveId: 'save-1', signalId: 's.b', trailId: 't.one' },
      { saveId: 'save-1', signalId: 's.a', trailId: 't.two' },
    ]);
  });

  test('normalizeOnRows produces one row per (trail, signal) pair', () => {
    const trails = [
      makeTrail('t.one', { on: ['s.a', 's.b'] }),
      makeTrail('t.two', { on: ['s.b'] }),
    ];
    expect(normalizeOnRows(trails, 'save-1')).toEqual([
      { saveId: 'save-1', signalId: 's.a', trailId: 't.one' },
      { saveId: 'save-1', signalId: 's.b', trailId: 't.one' },
      { saveId: 'save-1', signalId: 's.b', trailId: 't.two' },
    ]);
  });

  test('trails without fires/on produce no rows', () => {
    const trails = [makeTrail('t.plain', {})];
    expect(normalizeFiresRows(trails, 'save-1')).toEqual([]);
    expect(normalizeOnRows(trails, 'save-1')).toEqual([]);
  });

  test('deduplicates and sorts signal ids', () => {
    const trails = [makeTrail('t.one', { fires: ['s.b', 's.a', 's.b'] })];
    expect(normalizeFiresRows(trails, 'save-1')).toEqual([
      { saveId: 'save-1', signalId: 's.a', trailId: 't.one' },
      { saveId: 'save-1', signalId: 's.b', trailId: 't.one' },
    ]);
  });
});
