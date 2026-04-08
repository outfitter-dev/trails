import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TraceRecord } from '../trace-record.js';
import type { DevStore } from '../stores/dev.js';
import { createDevStore } from '../stores/dev.js';

/** Build a minimal TraceRecord for testing. */
const makeRecord = (overrides?: Partial<TraceRecord>): TraceRecord => ({
  attrs: {},
  endedAt: Date.now(),
  id: `rec-${crypto.randomUUID()}`,
  kind: 'trail',
  name: 'test-trail',
  rootId: 'root-1',
  startedAt: Date.now() - 100,
  status: 'ok',
  traceId: 'trace-1',
  trailId: 'test-trail',
  ...overrides,
});

const DAY_MS = 24 * 60 * 60 * 1000;

const LEGACY_CREATE_TABLE_SQL = (tableName: string): string =>
  `CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  trail_id TEXT,
  trailhead TEXT,
  intent TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  error_category TEXT,
  permit_id TEXT,
  permit_tenant_id TEXT,
  attrs TEXT
)`;

const LEGACY_UPSERT_SQL = (tableName: string): string =>
  `INSERT INTO ${tableName} (
  id, trace_id, root_id, parent_id,
  kind, name, trail_id, trailhead,
  intent, started_at, ended_at, status,
  error_category, permit_id, permit_tenant_id, attrs
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  trace_id = excluded.trace_id,
  root_id = excluded.root_id,
  parent_id = excluded.parent_id,
  kind = excluded.kind,
  name = excluded.name,
  trail_id = excluded.trail_id,
  trailhead = excluded.trailhead,
  intent = excluded.intent,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  status = excluded.status,
  error_category = excluded.error_category,
  permit_id = excluded.permit_id,
  permit_tenant_id = excluded.permit_tenant_id,
  attrs = excluded.attrs`;

interface LegacyStoreFixture {
  readonly fileName: string;
  readonly tableName: string;
}

const writeLegacyTrackerDb = (
  rootDir: string,
  fixture: LegacyStoreFixture,
  records: readonly TraceRecord[]
): void => {
  const path = join(rootDir, '.trails', 'dev', fixture.fileName);
  mkdirSync(join(rootDir, '.trails', 'dev'), { recursive: true });
  const db = new Database(path, { create: true });

  try {
    db.run(LEGACY_CREATE_TABLE_SQL(fixture.tableName));
    const stmt = db.prepare(LEGACY_UPSERT_SQL(fixture.tableName));
    for (const record of records) {
      stmt.run(
        record.id,
        record.traceId,
        record.rootId,
        record.parentId ?? null,
        record.kind,
        record.name,
        record.trailId ?? null,
        record.trailhead ?? null,
        record.intent ?? null,
        record.startedAt,
        record.endedAt ?? null,
        record.status,
        record.errorCategory ?? null,
        record.permit?.id ?? null,
        record.permit?.tenantId ?? null,
        Object.keys(record.attrs).length > 0
          ? JSON.stringify(record.attrs)
          : null
      );
    }
  } finally {
    db.close();
  }
};

const makeOrderedRecords = (): {
  readonly newer: TraceRecord;
  readonly older: TraceRecord;
} => {
  const now = Date.now();
  return {
    newer: makeRecord({
      id: 'rec-new',
      name: 'second',
      startedAt: now - 1000,
    }),
    older: makeRecord({
      id: 'rec-old',
      name: 'first',
      startedAt: now - 2000,
    }),
  };
};

const writeRecords = (
  store: DevStore,
  records: readonly TraceRecord[]
): void => {
  for (const record of records) {
    store.write(record);
  }
};

const queryIds = (store: DevStore): readonly string[] =>
  store.query().map((record) => record.id);

describe('createDevStore', () => {
  let tmpDir: string;
  let store: DevStore | undefined;

  const makeTmpDir = (): string => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dev-store-'));
    return tmpDir;
  };

  afterEach(() => {
    store?.close();
    store = undefined;
    if (tmpDir) {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  describe('lifecycle', () => {
    test('defaults to the shared .trails/trails.db path under rootDir', () => {
      const dir = makeTmpDir();

      store = createDevStore({ rootDir: dir });
      store.write(makeRecord());

      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(true);
    });

    test('creates a database file at the specified path', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'tracing.db');

      store = createDevStore({ path: dbPath });

      expect(existsSync(dbPath)).toBe(true);
    });

    test('close() closes the database connection', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });
      store.write(makeRecord());

      store.close();

      // Querying after close should throw
      expect(() => store?.query()).toThrow();
      /* Prevent double-close in afterEach */
      store = undefined;
    });
  });

  describe('write()', () => {
    test('persists a TraceRecord', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });
      const record = makeRecord();

      store.write(record);
      const results = store.query();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(record.id);
      expect(results[0]?.name).toBe('test-trail');
    });

    test('persists attrs as JSON', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });
      const record = makeRecord({ attrs: { count: 42, key: 'value' } });

      store.write(record);
      const results = store.query();

      expect(results[0]?.attrs).toEqual({ count: 42, key: 'value' });
    });

    test('persists permit fields', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });
      const record = makeRecord({
        permit: { id: 'permit-1', tenantId: 'tenant-1' },
      });

      store.write(record);
      const results = store.query();

      expect(results[0]?.permit).toEqual({
        id: 'permit-1',
        tenantId: 'tenant-1',
      });
    });

    test('upserts duplicate record ids instead of throwing', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      store.write(makeRecord({ id: 'dup', name: 'first' }));
      store.write(makeRecord({ id: 'dup', name: 'updated' }));

      const results = store.query();
      expect(results).toHaveLength(1);
      expect(results[0]?.name).toBe('updated');
    });
  });

  describe('query()', () => {
    test('returns persisted records ordered by startedAt descending', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });
      const { newer, older } = makeOrderedRecords();

      writeRecords(store, [older, newer]);
      expect(queryIds(store)).toEqual(['rec-new', 'rec-old']);
    });

    test('filters by trailId', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      store.write(makeRecord({ id: 'a', trailId: 'users.list' }));
      store.write(makeRecord({ id: 'b', trailId: 'users.get' }));
      store.write(makeRecord({ id: 'c', trailId: 'users.list' }));

      const results = store.query({ trailId: 'users.list' });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.trailId === 'users.list')).toBe(true);
    });

    test('filters by traceId', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      store.write(makeRecord({ id: 'a', traceId: 'trace-abc' }));
      store.write(makeRecord({ id: 'b', traceId: 'trace-xyz' }));

      const results = store.query({ traceId: 'trace-abc' });

      expect(results).toHaveLength(1);
      expect(results[0]?.traceId).toBe('trace-abc');
    });

    test('filters by errorsOnly', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      store.write(makeRecord({ id: 'ok-1', status: 'ok' }));
      store.write(
        makeRecord({
          errorCategory: 'NotFoundError',
          id: 'err-1',
          status: 'err',
        })
      );
      store.write(makeRecord({ id: 'ok-2', status: 'ok' }));

      const results = store.query({ errorsOnly: true });

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('err');
    });

    test('limits results', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      for (let i = 0; i < 10; i += 1) {
        store.write(makeRecord({ id: `rec-${String(i)}` }));
      }

      const results = store.query({ limit: 5 });

      expect(results).toHaveLength(5);
    });
  });

  describe('retention', () => {
    test('defaults maxAge to seven days when not provided explicitly', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'tracing.db') });

      store.write(
        makeRecord({ id: 'old', startedAt: Date.now() - 8 * DAY_MS })
      );
      store.write(makeRecord({ id: 'fresh', startedAt: Date.now() }));

      const results = store.query();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('fresh');
    });

    test('enforces maxRecords by pruning oldest entries', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxRecords: 5,
        path: join(dir, 'tracing.db'),
      });

      const now = Date.now();
      for (let i = 0; i < 8; i += 1) {
        store.write(
          makeRecord({ id: `rec-${String(i)}`, startedAt: now - i * 1000 })
        );
      }

      const results = store.query();

      expect(results.length).toBe(5);
    });

    test('prunes records older than maxAge', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxAge: 1000,
        path: join(dir, 'tracing.db'),
      });

      store.write(makeRecord({ id: 'old', startedAt: Date.now() - 5000 }));
      store.write(makeRecord({ id: 'fresh', startedAt: Date.now() }));

      const results = store.query();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('fresh');
    });
  });

  describe('legacy migration', () => {
    test('migrates legacy .trails/dev/tracing.db records into shared trails.db', () => {
      const dir = makeTmpDir();
      const now = Date.now();
      const legacyRecords = [
        makeRecord({
          id: 'legacy-a',
          startedAt: now - 2000,
          trailId: 'user.create',
        }),
        makeRecord({
          id: 'legacy-b',
          startedAt: now - 1000,
          trailId: 'user.list',
        }),
      ];

      writeLegacyTrackerDb(
        dir,
        { fileName: 'tracing.db', tableName: 'tracing' },
        legacyRecords
      );

      store = createDevStore({ maxRecords: 10, rootDir: dir });

      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(true);
      expect(queryIds(store)).toEqual(['legacy-b', 'legacy-a']);
      expect(existsSync(join(dir, '.trails', 'dev', 'tracing.db'))).toBe(false);
    });

    test('migrates legacy .trails/dev/tracker.db records into shared trails.db', () => {
      const dir = makeTmpDir();
      const now = Date.now();
      const legacyRecords = [
        makeRecord({
          id: 'legacy-tracker-a',
          startedAt: now - 2000,
          trailId: 'user.create',
        }),
        makeRecord({
          id: 'legacy-tracker-b',
          startedAt: now - 1000,
          trailId: 'user.list',
        }),
      ];

      writeLegacyTrackerDb(
        dir,
        { fileName: 'tracker.db', tableName: 'tracker' },
        legacyRecords
      );

      store = createDevStore({ maxRecords: 10, rootDir: dir });

      expect(existsSync(join(dir, '.trails', 'trails.db'))).toBe(true);
      expect(queryIds(store)).toEqual(['legacy-tracker-b', 'legacy-tracker-a']);
      expect(existsSync(join(dir, '.trails', 'dev', 'tracker.db'))).toBe(false);
    });
  });

  describe('count()', () => {
    test('returns the number of retained records', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxRecords: 2,
        path: join(dir, 'tracing.db'),
      });
      const now = Date.now();

      store.write(makeRecord({ id: 'a', startedAt: now - 3000 }));
      store.write(makeRecord({ id: 'b', startedAt: now - 2000 }));
      store.write(makeRecord({ id: 'c', startedAt: now - 1000 }));

      expect(store.count()).toBe(2);
      expect(store.query()).toHaveLength(2);
    });
  });
});
