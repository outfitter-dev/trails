import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { Result, resource, signal, topo, trail } from '../index.js';
import {
  ensureTopoHistorySchema,
  pinTopoSave,
  pruneUnpinnedTopoSaves,
} from '../internal/topo-saves.js';
import {
  getStoredTopoExport,
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
  expect(countRows(db, 'topo_trail_provisions', saveId)).toBe(3);
  expect(countRows(db, 'topo_provisions', saveId)).toBe(2);
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
    provision_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS topo_pins (
    name TEXT PRIMARY KEY,
    save_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`);
  db.run(
    `INSERT INTO topo_saves (
      id, git_sha, git_dirty, trail_count, signal_count, provision_count, created_at
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
      const app = exampleApp();
      const pinned = unwrap(
        persistEstablishedTopoSave(db, app, {
          createdAt: '2026-04-03T12:00:00.000Z',
        })
      );
      pinTopoSave(db, { name: 'before-auth', saveId: pinned.id });

      const disposable = unwrap(
        persistEstablishedTopoSave(db, app, {
          createdAt: '2026-04-03T12:05:00.000Z',
        })
      );

      expect(pruneUnpinnedTopoSaves(db, { keep: 0 })).toBe(1);
      expectProjectionCounts(db, pinned.id);
      expect(countRows(db, 'topo_trails', disposable.id)).toBe(0);
      expect(countRows(db, 'topo_crossings', disposable.id)).toBe(0);
      expect(countRows(db, 'topo_examples', disposable.id)).toBe(0);
      expect(countRows(db, 'topo_schemas', disposable.id)).toBe(0);
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
      ).toBe(3);
      expect(tableExists(db, 'topo_trails')).toBe(true);
      expect(tableExists(db, 'topo_crossings')).toBe(true);
      expect(tableExists(db, 'topo_examples')).toBe(true);
      expect(tableExists(db, 'topo_exports')).toBe(true);
      expect(tableExists(db, 'topo_schemas')).toBe(true);
      expect(countRows(db, 'topo_saves')).toBe(1);
      expect(countRows(db, 'topo_pins')).toBe(1);
    });
  });
});
