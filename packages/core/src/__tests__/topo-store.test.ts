import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { NotFoundError } from '../errors.js';
import { contour, Result, resource, signal, topo, trail } from '../index.js';
import { __topoStoreMigrationStats, createTopoStore } from '../topo-store.js';
import {
  ensureTopoSnapshotSchema,
  pinTopoSnapshot,
  pruneUnpinnedSnapshots,
} from '../internal/topo-snapshots.js';
import {
  createTopoSnapshot,
  getStoredTopoExport,
  normalizeFiresRows,
  normalizeOnRows,
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
  snapshotId?: string
): number => {
  const row =
    snapshotId === undefined
      ? db
          .query<{ count: number }, []>(
            `SELECT COUNT(*) as count FROM ${tableName}`
          )
          .get()
      : db
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) as count FROM ${tableName} WHERE snapshot_id = ?`
          )
          .get(snapshotId);
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
  const entityContour = contour(
    'entity',
    {
      id: z.string(),
      name: z.string(),
    },
    { identity: 'id' }
  );

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
    examples: [{ id: 'ada' }],
    from: ['entity.add'],
    payload: z.object({ id: z.string() }),
  });

  const entityAdd = trail('entity.add', {
    blaze: (input: { readonly name: string }) =>
      Result.ok({ id: input.name.toLowerCase(), ok: true }),
    contours: [entityContour],
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
    contours: [entityContour],
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
    entityContour,
    entityList,
    searchIndex,
  });
};

const readTrailRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
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
       WHERE snapshot_id = ?
       ORDER BY id ASC`
    )
    .all(snapshotId);

const readTrailSignalRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
) =>
  db
    .query<{ signal_id: string; trail_id: string }, [string]>(
      `SELECT trail_id, signal_id
       FROM topo_trail_signals
       WHERE snapshot_id = ?`
    )
    .all(snapshotId);

const readSurfaceRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
) =>
  db
    .query<{ derived_name: string; trail_id: string }, [string]>(
      `SELECT trail_id, derived_name
       FROM topo_surfaces
       WHERE snapshot_id = ?
       ORDER BY trail_id ASC`
    )
    .all(snapshotId);

const readExampleRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
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
       WHERE snapshot_id = ?
       ORDER BY ordinal ASC`
    )
    .all(snapshotId);

const readProjectedTrailIds = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
) =>
  db
    .query<{ id: string }, [string]>(
      'SELECT id FROM topo_trails WHERE snapshot_id = ? ORDER BY id ASC'
    )
    .all(snapshotId)
    .map((row) => row.id);

const requireStoredExport = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
) => {
  const stored = getStoredTopoExport(db, snapshotId);
  if (stored === undefined) {
    throw new Error(`Expected stored topo export for snapshot "${snapshotId}"`);
  }
  return stored;
};

const hasContourTrailheadEntry = (entry: unknown, id: string): boolean => {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const candidate = entry as { id?: string; kind?: string };
  return candidate.id === id && candidate.kind === 'contour';
};

const expectProjectionCounts = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
): void => {
  expect(countRows(db, 'topo_trails', snapshotId)).toBe(2);
  expect(countRows(db, 'topo_crossings', snapshotId)).toBe(1);
  expect(countRows(db, 'topo_trail_resources', snapshotId)).toBe(3);
  expect(countRows(db, 'topo_resources', snapshotId)).toBe(2);
  expect(countRows(db, 'topo_signals', snapshotId)).toBe(1);
  expect(countRows(db, 'topo_trail_signals', snapshotId)).toBe(1);
  expect(countRows(db, 'topo_surfaces', snapshotId)).toBe(2);
  expect(countRows(db, 'topo_examples', snapshotId)).toBe(2);
  expect(countRows(db, 'topo_schemas', snapshotId)).toBe(5);
  expect(countRows(db, 'topo_exports')).toBeGreaterThanOrEqual(1);
};

const expectProjectedFixtureRows = (
  db: ReturnType<typeof openWriteTrailsDb>,
  snapshotId: string
): void => {
  expect(readTrailRows(db, snapshotId)).toEqual([
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
  expect(readTrailSignalRows(db, snapshotId)).toEqual([
    { signal_id: 'entity.added', trail_id: 'entity.add' },
  ]);
  expect(readSurfaceRows(db, snapshotId)).toEqual([
    { derived_name: 'entity add', trail_id: 'entity.add' },
    { derived_name: 'entity list', trail_id: 'entity.list' },
  ]);
  expect(readExampleRows(db, snapshotId)).toEqual([
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
  snapshotId: string,
  count: number
): void => {
  expect(countRows(db, 'topo_trail_fires', snapshotId)).toBe(count);
  expect(countRows(db, 'topo_trail_on', snapshotId)).toBe(count);
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

const seedCurrentSchemaStore = (rootDir: string): void => {
  const db = openWriteTrailsDb({ rootDir });
  try {
    ensureTopoSnapshotSchema(db);
  } finally {
    db.close();
  }
};

const assertNoWriteEscalationOnReads = (rootDir: string): void => {
  const baselineEscalations = __topoStoreMigrationStats.writeEscalations;
  const baselinePeeks = __topoStoreMigrationStats.peekCalls;

  // First read: peek must happen, no write-mode escalation.
  const caught = captureReadError(() =>
    createTopoStore({ rootDir }).snapshots.latest()
  );
  expect(caught).toBeInstanceOf(NotFoundError);
  expect(__topoStoreMigrationStats.peekCalls).toBe(baselinePeeks + 1);
  expect(__topoStoreMigrationStats.writeEscalations).toBe(baselineEscalations);

  // Second read is served entirely from the memoized identity.
  captureReadError(() => createTopoStore({ rootDir }).snapshots.latest());
  expect(__topoStoreMigrationStats.peekCalls).toBe(baselinePeeks + 1);
  expect(__topoStoreMigrationStats.writeEscalations).toBe(baselineEscalations);
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

/**
 * Seed a pre-v7 projection store that still uses the `topo_trailheads`
 * table and the `save_id` foreign-key column. The fresh migration should
 * ignore this legacy state and create the snapshot-first schema alongside it.
 */
const seedLegacyProjectionStore = (
  db: ReturnType<typeof openWriteTrailsDb>
): void => {
  db.run(
    `INSERT INTO meta_schema_versions (subsystem, version, updated_at)
     VALUES ('topo', 6, ?)`,
    ['2026-04-03T11:00:00.000Z']
  );
  db.run(`CREATE TABLE IF NOT EXISTS topo_trailheads (
    trail_id TEXT NOT NULL,
    trailhead TEXT NOT NULL,
    derived_name TEXT NOT NULL,
    method TEXT,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, trailhead, save_id)
  )`);
  db.run(
    `INSERT INTO topo_trailheads (trail_id, trailhead, derived_name, save_id)
     VALUES (?, ?, ?, ?)`,
    ['entity.add', 'cli', 'entity add', 'legacy-save']
  );
};

const replaceStoreWithHistoryOnlyStore = async (
  rootDir: string
): Promise<void> => {
  // Ensure mtime/size differs so the cached identity is invalidated even on
  // filesystems with coarse mtime granularity.
  const dbPath = join(rootDir, '.trails', 'trails.db');
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  await Bun.sleep(10);
  const db = openWriteTrailsDb({ rootDir });
  try {
    seedHistoryOnlyTopoSchema(db);
  } finally {
    db.close();
  }
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

  test('projects a snapshot-scoped relational topo from the established app graph', () => {
    withProjectionDb((db) => {
      const snapshot = unwrap(
        createTopoSnapshot(db, exampleApp(), {
          createdAt: '2026-04-03T12:00:00.000Z',
          gitDirty: false,
          gitSha: 'abc123',
        })
      );
      expectProjectionCounts(db, snapshot.id);
      expectProjectedFixtureRows(db, snapshot.id);

      const stored = requireStoredExport(db, snapshot.id);
      const surfaceMap = JSON.parse(stored.surfaceMapJson);
      const { entries } = surfaceMap as { entries?: unknown[] };
      expect(surfaceMap).toMatchObject({
        entries: expect.any(Array),
        generatedAt: '2026-04-03T12:00:00.000Z',
        version: '1.0',
      });
      expect(Array.isArray(entries)).toBe(true);
      expect(
        entries?.some((entry) => hasContourTrailheadEntry(entry, 'entity'))
      ).toBe(true);

      expect(JSON.parse(stored.lockContent)).toMatchObject({
        apps: {
          'projection-app': {
            contours: {
              entity: expect.objectContaining({
                identity: 'id',
              }),
            },
            resources: expect.any(Object),
            signals: expect.any(Object),
            trails: expect.any(Object),
          },
        },
        generatedAt: '2026-04-03T12:00:00.000Z',
        hash: stored.surfaceHash,
        version: 1,
      });
    });
  });

  test('keeps projected rows isolated across successive snapshots', () => {
    withProjectionDb((db) => {
      const firstSnapshot = unwrap(
        createTopoSnapshot(db, simpleProjectionApp(false), {
          createdAt: '2026-04-03T12:00:00.000Z',
        })
      );
      const secondSnapshot = unwrap(
        createTopoSnapshot(db, simpleProjectionApp(true), {
          createdAt: '2026-04-03T12:05:00.000Z',
        })
      );

      expect(firstSnapshot.id).not.toBe(secondSnapshot.id);
      expect(countRows(db, 'topo_trails', firstSnapshot.id)).toBe(1);
      expect(countRows(db, 'topo_trails', secondSnapshot.id)).toBe(2);
      expect(readProjectedTrailIds(db, firstSnapshot.id)).toEqual([
        'entity.add',
      ]);
      expect(readProjectedTrailIds(db, secondSnapshot.id)).toEqual([
        'entity.add',
        'entity.list',
      ]);
      expect(requireStoredExport(db, firstSnapshot.id).surfaceHash).not.toBe(
        requireStoredExport(db, secondSnapshot.id).surfaceHash
      );
    });
  });

  test("pruning an unpinned snapshot removes only that snapshot's projected rows", () => {
    withProjectionDb((db) => {
      const pinned = unwrap(
        createTopoSnapshot(db, buildSignalPruneApp(), {
          createdAt: '2026-04-03T12:00:00.000Z',
        })
      );
      pinTopoSnapshot(db, { id: pinned.id, name: 'before-auth' });

      const disposable = unwrap(
        createTopoSnapshot(db, buildSignalPruneApp(), {
          createdAt: '2026-04-03T12:05:00.000Z',
        })
      );

      // Pre-prune: both snapshots have fires/on rows so the cascade is non-vacuous.
      expectSignalEdgeCounts(db, pinned.id, 1);
      expectSignalEdgeCounts(db, disposable.id, 1);

      expect(pruneUnpinnedSnapshots(db, { keep: 0 })).toBe(1);

      // Pinned snapshot retains its projected rows, including fires/on edges.
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

      const snapshot = unwrap(
        createTopoSnapshot(
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
           WHERE snapshot_id = ?
           ORDER BY trail_id ASC, signal_id ASC`
        )
        .all(snapshot.id);
      expect(fires).toEqual([
        { signal_id: 'entity.created', trail_id: 'entity.create' },
        { signal_id: 'entity.updated', trail_id: 'entity.create' },
      ]);

      const on = db
        .query<{ signal_id: string; trail_id: string }, [string]>(
          `SELECT trail_id, signal_id
           FROM topo_trail_on
           WHERE snapshot_id = ?
           ORDER BY trail_id ASC, signal_id ASC`
        )
        .all(snapshot.id);
      expect(on).toEqual([
        { signal_id: 'entity.created', trail_id: 'entity.audit' },
        { signal_id: 'entity.updated', trail_id: 'entity.audit' },
        { signal_id: 'entity.created', trail_id: 'entity.index' },
      ]);
    });
  });

  describe('snapshot schema migration guardrails', () => {
    test('createTopoStore skips write-mode escalation when schema is current', () => {
      const rootDir = makeRoot();
      seedCurrentSchemaStore(rootDir);
      assertNoWriteEscalationOnReads(rootDir);
    });

    test('createTopoStore ignores a legacy history-only store during cutover', () => {
      const rootDir = makeRoot();
      withWriteDb(rootDir, (db) => {
        seedHistoryOnlyTopoSchema(db);
      });

      const caught = captureReadError(() =>
        createTopoStore({ rootDir }).snapshots.latest()
      );
      expect(caught).toBeInstanceOf(NotFoundError);

      withWriteDb(rootDir, (db) => {
        expect(tableExists(db, 'topo_snapshots')).toBe(true);
        expect(tableExists(db, 'topo_trails')).toBe(true);
        expect(tableExists(db, 'topo_resources')).toBe(true);
        expect(tableExists(db, 'topo_surfaces')).toBe(true);
        expect(tableExists(db, 'topo_saves')).toBe(true);
        expect(tableExists(db, 'topo_pins')).toBe(true);
        expect(tableExists(db, 'topo_trailheads')).toBe(false);
        expect(
          db
            .query<{ version: number }, []>(
              "SELECT version FROM meta_schema_versions WHERE subsystem = 'topo'"
            )
            .get()?.version
        ).toBe(8);
        expect(countRows(db, 'topo_snapshots')).toBe(0);
      });
    });

    test('createTopoSnapshot succeeds alongside a legacy projection store', () => {
      withProjectionDb((db) => {
        seedLegacyProjectionStore(db);

        const snapshot = unwrap(
          createTopoSnapshot(db, exampleApp(), {
            createdAt: '2026-04-03T12:00:00.000Z',
          })
        );

        expect(tableExists(db, 'topo_trailheads')).toBe(true);
        expect(countRows(db, 'topo_snapshots')).toBe(1);
        expectProjectionCounts(db, snapshot.id);
      });
    });

    test('createTopoStore re-migrates after trails.db is replaced at the same path', async () => {
      const rootDir = makeRoot();

      // Round 1: seed a current-schema store and read through createTopoStore
      // to prime the migration cache.
      seedCurrentSchemaStore(rootDir);
      captureReadError(() => createTopoStore({ rootDir }).snapshots.latest());
      const baselineEscalations = __topoStoreMigrationStats.writeEscalations;

      await replaceStoreWithHistoryOnlyStore(rootDir);

      // Round 2: a fresh createTopoStore call must detect the file swap,
      // re-run the migration, and keep surfacing the empty-store NotFound.
      const caught = captureReadError(() =>
        createTopoStore({ rootDir }).snapshots.latest()
      );
      expect(caught).toBeInstanceOf(NotFoundError);
      expect(__topoStoreMigrationStats.writeEscalations).toBe(
        baselineEscalations + 1
      );
      withWriteDb(rootDir, (db) => {
        expect(tableExists(db, 'topo_snapshots')).toBe(true);
        expect(countRows(db, 'topo_snapshots')).toBe(0);
      });
    });
  });

  test('history-only topo stores are ignored instead of translated into snapshots', () => {
    withProjectionDb((db) => {
      seedHistoryOnlyTopoSchema(db);
      ensureTopoSnapshotSchema(db);
      expect(
        db
          .query<{ version: number }, []>(
            "SELECT version FROM meta_schema_versions WHERE subsystem = 'topo'"
          )
          .get()?.version
      ).toBe(8);
      for (const table of [
        'topo_snapshots',
        'topo_trails',
        'topo_crossings',
        'topo_examples',
        'topo_exports',
        'topo_schemas',
        'topo_surfaces',
        'topo_trail_fires',
        'topo_trail_on',
      ]) {
        expect(tableExists(db, table)).toBe(true);
      }
      expect(countRows(db, 'topo_snapshots')).toBe(0);
      // Legacy history tables are left untouched during the migration and are
      // simply ignored by the snapshot-first readers.
      expect(tableExists(db, 'topo_saves')).toBe(true);
      expect(tableExists(db, 'topo_pins')).toBe(true);
      expect(tableExists(db, 'topo_trailheads')).toBe(false);
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
    expect(normalizeFiresRows(trails, 'snap-1')).toEqual([
      { signalId: 's.a', snapshotId: 'snap-1', trailId: 't.one' },
      { signalId: 's.b', snapshotId: 'snap-1', trailId: 't.one' },
      { signalId: 's.a', snapshotId: 'snap-1', trailId: 't.two' },
    ]);
  });

  test('normalizeOnRows produces one row per (trail, signal) pair', () => {
    const trails = [
      makeTrail('t.one', { on: ['s.a', 's.b'] }),
      makeTrail('t.two', { on: ['s.b'] }),
    ];
    expect(normalizeOnRows(trails, 'snap-1')).toEqual([
      { signalId: 's.a', snapshotId: 'snap-1', trailId: 't.one' },
      { signalId: 's.b', snapshotId: 'snap-1', trailId: 't.one' },
      { signalId: 's.b', snapshotId: 'snap-1', trailId: 't.two' },
    ]);
  });

  test('trails without fires/on produce no rows', () => {
    const trails = [makeTrail('t.plain', {})];
    expect(normalizeFiresRows(trails, 'snap-1')).toEqual([]);
    expect(normalizeOnRows(trails, 'snap-1')).toEqual([]);
  });

  test('deduplicates and sorts signal ids', () => {
    const trails = [makeTrail('t.one', { fires: ['s.b', 's.a', 's.b'] })];
    expect(normalizeFiresRows(trails, 'snap-1')).toEqual([
      { signalId: 's.a', snapshotId: 'snap-1', trailId: 't.one' },
      { signalId: 's.b', snapshotId: 'snap-1', trailId: 't.one' },
    ]);
  });
});
