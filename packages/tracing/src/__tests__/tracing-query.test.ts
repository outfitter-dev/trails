import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createResourceLookup, passthroughTrace } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { TraceRecord } from '../trace-record.js';
import type { TracingState } from '../tracing-state.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import type { DevStore } from '../stores/dev.js';
import { createDevStore } from '../stores/dev.js';
import { tracingQuery } from '../trails/tracing-query.js';

/** Build a TrailContext with tracingResource resolved in extensions. */
const buildCtx = (state: TracingState): TrailContext => {
  const extensions = { tracing: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    resource: undefined as unknown as TrailContext['resource'],
    trace: passthroughTrace,
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    resource: createResourceLookup(() => withLookup),
  };
  return withLookup;
};

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

/** Default state without a store. */
const noStoreState: TracingState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

/** Create a temp DevStore and return with cleanup. */
const createTestStore = (): { cleanup: () => void; store: DevStore } => {
  const dir = mkdtempSync(join(tmpdir(), 'tracing-query-'));
  const store = createDevStore({ path: join(dir, 'tracing.db') });
  const cleanup = () => {
    store.close();
    rmSync(dir, { force: true, recursive: true });
  };
  return { cleanup, store };
};

/** Build a TracingState with a real store. */
const stateWithStore = (store: DevStore): TracingState => ({
  active: true,
  sampling: DEFAULT_SAMPLING,
  store,
});

describe('tracing.query', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(tracingQuery.id).toBe('tracing.query');
    });

    test('has read intent', () => {
      expect(tracingQuery.intent).toBe('read');
    });

    test('has infrastructure meta', () => {
      expect(tracingQuery.meta).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(tracingQuery.examples).toBeDefined();
      expect(tracingQuery.examples?.length).toBeGreaterThanOrEqual(3);
    });

    test('declares tracingResource in resources', () => {
      expect(tracingQuery.resources).toBeDefined();
      expect(tracingQuery.resources?.length).toBe(1);
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
      const result = await tracingQuery.blaze({}, ctx);
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
          attrs: { 'trails.surface': 'cli' },
          id: 'rec-abc',
          intent: 'read',
          name: 'user.list',
          rootId: 'root-abc',
          traceId: 'trace-abc',
          trailId: 'user.list',
          trailhead: 'cli',
        })
      );

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await tracingQuery.blaze({}, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]).toMatchObject({
        id: 'rec-abc',
        intent: 'read',
        kind: 'trail',
        name: 'user.list',
        rootId: 'root-abc',
        status: 'ok',
        traceId: 'trace-abc',
        trailId: 'user.list',
        trailhead: 'cli',
      });
      expect(value.records[0]?.attrs).toEqual({ 'trails.surface': 'cli' });
    });

    test('returns signal trace records from store in state', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(
        makeRecord({
          attrs: {
            'trails.signal.error.name': 'ValidationError',
            'trails.signal.id': 'order.placed',
          },
          errorCategory: 'validation',
          id: 'signal-fired',
          kind: 'signal',
          name: 'signal.invalid',
          rootId: 'root-signal',
          status: 'err',
          trailId: undefined,
        })
      );

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await tracingQuery.blaze({}, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]).toMatchObject({
        attrs: {
          'trails.signal.error.name': 'ValidationError',
          'trails.signal.id': 'order.placed',
        },
        errorCategory: 'validation',
        id: 'signal-fired',
        kind: 'signal',
        name: 'signal.invalid',
        rootId: 'root-signal',
        status: 'err',
      });
      expect(value.records[0]?.trailId).toBeUndefined();
    });

    test('filters by trailId', async () => {
      const testStore = createTestStore();
      ({ cleanup } = testStore);
      testStore.store.write(makeRecord({ id: 'a', trailId: 'user.create' }));
      testStore.store.write(makeRecord({ id: 'b', trailId: 'user.list' }));

      const ctx = buildCtx(stateWithStore(testStore.store));
      const result = await tracingQuery.blaze({ trailId: 'user.create' }, ctx);
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
      const result = await tracingQuery.blaze({ errorsOnly: true }, ctx);
      const value = result.unwrap();

      expect(value.count).toBe(1);
      expect(value.records[0]?.status).toBe('err');
    });
  });
});
