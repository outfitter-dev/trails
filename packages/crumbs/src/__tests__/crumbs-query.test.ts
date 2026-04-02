import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { Crumb } from '../record.js';
import type { CrumbsState } from '../registry.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import type { DevStore } from '../stores/dev.js';
import { createDevStore } from '../stores/dev.js';
import { crumbsQuery } from '../trails/crumbs-query.js';

/** Build a TrailContext with crumbsService resolved in extensions. */
const buildCtx = (state: CrumbsState): TrailContext => {
  const extensions = { crumbs: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    service: undefined as unknown as TrailContext['service'],
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    service: createServiceLookup(() => withLookup),
  };
  return withLookup;
};

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

/** Default state without a store. */
const noStoreState: CrumbsState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/** Create a temp DevStore and return with cleanup. */
const createTestStore = (): { cleanup: () => void; store: DevStore } => {
  const dir = mkdtempSync(join(tmpdir(), 'crumbs-query-'));
  const store = createDevStore({ path: join(dir, 'crumbs.db') });
  const cleanup = () => {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  };
  return { cleanup, store };
};

/** Build a CrumbsState with a real store. */
const stateWithStore = (store: DevStore): CrumbsState => ({
  active: true,
  sampling: DEFAULT_SAMPLING,
  store,
});

describe('crumbs.query', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(crumbsQuery.id).toBe('crumbs.query');
    });

    test('has read intent', () => {
      expect(crumbsQuery.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(crumbsQuery.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(crumbsQuery.examples).toBeDefined();
      expect(crumbsQuery.examples?.length).toBeGreaterThanOrEqual(3);
    });

    test('declares crumbsService in services', () => {
      expect(crumbsQuery.services).toBeDefined();
      expect(crumbsQuery.services?.length).toBe(1);
    });
  });

  describe('run', () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
      cleanup?.();
      cleanup = undefined;
    });

    test('returns empty records when state has no store', async () => {
      const ctx = buildCtx(noStoreState);
      const result = await crumbsQuery.run({}, ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.count).toBe(0);
      expect(value.records).toEqual([]);
    });

    test('returns records from store in state', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(
        makeRecord({
          id: 'rec-abc',
          intent: 'read',
          name: 'user.list',
          surface: 'cli',
          traceId: 'trace-abc',
          trailId: 'user.list',
        })
      );

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await crumbsQuery.run({}, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]).toMatchObject({
        id: 'rec-abc',
        intent: 'read',
        kind: 'trail',
        name: 'user.list',
        status: 'ok',
        surface: 'cli',
        traceId: 'trace-abc',
        trailId: 'user.list',
      });
    });

    test('filters by trailId', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(makeRecord({ id: 'a', trailId: 'user.create' }));
      testStore.store.write(makeRecord({ id: 'b', trailId: 'user.list' }));

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await crumbsQuery.run({ trailId: 'user.create' }, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]?.trailId).toBe('user.create');
    });

    test('filters errorsOnly', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(makeRecord({ id: 'ok-1', status: 'ok' }));
      testStore.store.write(makeRecord({ id: 'err-1', status: 'err' }));

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await crumbsQuery.run({ errorsOnly: true }, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]?.status).toBe('err');
    });
  });
});
