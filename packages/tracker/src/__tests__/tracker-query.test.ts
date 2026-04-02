import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProvisionLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { Track } from '../track.js';
import type { TrackerState } from '../tracker-state.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import type { DevStore } from '../stores/dev.js';
import { createDevStore } from '../stores/dev.js';
import { trackerQuery } from '../trails/tracker-query.js';

/** Build a TrailContext with trackerProvision resolved in extensions. */
const buildCtx = (state: TrackerState): TrailContext => {
  const extensions = { tracker: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    provision: undefined as unknown as TrailContext['provision'],
    requestId: 'test',
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    provision: createProvisionLookup(() => withLookup),
  };
  return withLookup;
};

/** Build a minimal Track for testing. */
const makeRecord = (overrides?: Partial<Track>): Track => ({
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
const noStoreState: TrackerState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/** Create a temp DevStore and return with cleanup. */
const createTestStore = (): { cleanup: () => void; store: DevStore } => {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-query-'));
  const store = createDevStore({ path: join(dir, 'tracker.db') });
  const cleanup = () => {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  };
  return { cleanup, store };
};

/** Build a TrackerState with a real store. */
const stateWithStore = (store: DevStore): TrackerState => ({
  active: true,
  sampling: DEFAULT_SAMPLING,
  store,
});

describe('tracker.query', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(trackerQuery.id).toBe('tracker.query');
    });

    test('has read intent', () => {
      expect(trackerQuery.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(trackerQuery.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(trackerQuery.examples).toBeDefined();
      expect(trackerQuery.examples?.length).toBeGreaterThanOrEqual(3);
    });

    test('declares trackerProvision in provisions', () => {
      expect(trackerQuery.provisions).toBeDefined();
      expect(trackerQuery.provisions?.length).toBe(1);
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
      const result = await trackerQuery.blaze({}, ctx);
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
          traceId: 'trace-abc',
          trailId: 'user.list',
          trailhead: 'cli',
        })
      );

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await trackerQuery.blaze({}, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]).toMatchObject({
        id: 'rec-abc',
        intent: 'read',
        kind: 'trail',
        name: 'user.list',
        status: 'ok',
        traceId: 'trace-abc',
        trailId: 'user.list',
        trailhead: 'cli',
      });
    });

    test('filters by trailId', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(makeRecord({ id: 'a', trailId: 'user.create' }));
      testStore.store.write(makeRecord({ id: 'b', trailId: 'user.list' }));

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await trackerQuery.blaze({ trailId: 'user.create' }, ctx);
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
      const result = await trackerQuery.blaze({ errorsOnly: true }, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]?.status).toBe('err');
    });
  });
});
