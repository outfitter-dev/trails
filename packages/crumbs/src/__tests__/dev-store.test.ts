import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Crumb } from '../record.js';
import type { DevStore } from '../stores/dev.js';
import { createDevStore } from '../stores/dev.js';

/** Build a minimal Crumb for testing. */
const makeRecord = (overrides?: Partial<Crumb>): Crumb => ({
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
    test('creates a database file at the specified path', () => {
      const dir = makeTmpDir();
      const dbPath = join(dir, 'crumbs.db');

      store = createDevStore({ path: dbPath });

      expect(existsSync(dbPath)).toBe(true);
    });

    test('close() closes the database connection', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });
      store.write(makeRecord());

      store.close();

      // Querying after close should throw
      expect(() => store?.query()).toThrow();
      /* Prevent double-close in afterEach */
      store = undefined;
    });
  });

  describe('write()', () => {
    test('persists a Crumb', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });
      const record = makeRecord();

      store.write(record);
      const results = store.query();

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(record.id);
      expect(results[0]?.name).toBe('test-trail');
    });

    test('persists attrs as JSON', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });
      const record = makeRecord({ attrs: { count: 42, key: 'value' } });

      store.write(record);
      const results = store.query();

      expect(results[0]?.attrs).toEqual({ count: 42, key: 'value' });
    });

    test('persists permit fields', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });
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
      store = createDevStore({ path: join(dir, 'crumbs.db') });

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
      store = createDevStore({ path: join(dir, 'crumbs.db') });

      const older = makeRecord({
        id: 'rec-old',
        name: 'first',
        startedAt: 1000,
      });
      const newer = makeRecord({
        id: 'rec-new',
        name: 'second',
        startedAt: 2000,
      });

      store.write(older);
      store.write(newer);
      const results = store.query();

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe('rec-new');
      expect(results[1]?.id).toBe('rec-old');
    });

    test('filters by trailId', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });

      store.write(makeRecord({ id: 'a', trailId: 'users.list' }));
      store.write(makeRecord({ id: 'b', trailId: 'users.get' }));
      store.write(makeRecord({ id: 'c', trailId: 'users.list' }));

      const results = store.query({ trailId: 'users.list' });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.trailId === 'users.list')).toBe(true);
    });

    test('filters by traceId', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });

      store.write(makeRecord({ id: 'a', traceId: 'trace-abc' }));
      store.write(makeRecord({ id: 'b', traceId: 'trace-xyz' }));

      const results = store.query({ traceId: 'trace-abc' });

      expect(results).toHaveLength(1);
      expect(results[0]?.traceId).toBe('trace-abc');
    });

    test('filters by errorsOnly', () => {
      const dir = makeTmpDir();
      store = createDevStore({ path: join(dir, 'crumbs.db') });

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
      store = createDevStore({ path: join(dir, 'crumbs.db') });

      for (let i = 0; i < 10; i += 1) {
        store.write(makeRecord({ id: `rec-${String(i)}` }));
      }

      const results = store.query({ limit: 5 });

      expect(results).toHaveLength(5);
    });
  });

  describe('retention', () => {
    test('enforces maxRecords by pruning oldest entries', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxRecords: 5,
        path: join(dir, 'crumbs.db'),
      });

      for (let i = 0; i < 8; i += 1) {
        store.write(
          makeRecord({ id: `rec-${String(i)}`, startedAt: 1000 + i })
        );
      }

      const results = store.query();

      expect(results.length).toBeLessThanOrEqual(5);
    });

    test('prunes records older than maxAge', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxAge: 1000,
        path: join(dir, 'crumbs.db'),
      });

      store.write(makeRecord({ id: 'old', startedAt: Date.now() - 5000 }));
      store.write(makeRecord({ id: 'fresh', startedAt: Date.now() }));

      const results = store.query();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('fresh');
    });
  });

  describe('count()', () => {
    test('returns the number of retained records', () => {
      const dir = makeTmpDir();
      store = createDevStore({
        maxRecords: 2,
        path: join(dir, 'crumbs.db'),
      });

      store.write(makeRecord({ id: 'a', startedAt: 1000 }));
      store.write(makeRecord({ id: 'b', startedAt: 2000 }));
      store.write(makeRecord({ id: 'c', startedAt: 3000 }));

      expect(store.count()).toBe(2);
      expect(store.query()).toHaveLength(2);
    });
  });
});
