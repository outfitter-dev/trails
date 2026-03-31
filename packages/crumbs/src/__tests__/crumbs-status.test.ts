import { describe, expect, test } from 'bun:test';
import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { CrumbsState } from '../registry.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import { crumbsStatus } from '../trails/crumbs-status.js';

/** Build a TrailContext with crumbsService resolved in extensions. */
const buildCtx = (state: CrumbsState): TrailContext => {
  const extensions = { crumbs: state };
  const ctx: TrailContext = {
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    service: undefined as unknown as TrailContext['service'],
    signal: AbortSignal.timeout(5000),
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    service: createServiceLookup(() => withLookup),
  };
  return withLookup;
};

/** Default test state. */
const defaultState: CrumbsState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

describe('crumbs.status', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(crumbsStatus.id).toBe('crumbs.status');
    });

    test('has read intent', () => {
      expect(crumbsStatus.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(crumbsStatus.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(crumbsStatus.examples).toBeDefined();
      expect(crumbsStatus.examples?.length).toBeGreaterThan(0);
    });

    test('declares crumbsService in services', () => {
      expect(crumbsStatus.services).toBeDefined();
      expect(crumbsStatus.services?.length).toBe(1);
    });
  });

  describe('run', () => {
    test('returns active from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await crumbsStatus.run({}, ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.active).toBe(true);
    });

    test('returns inactive when state says so', async () => {
      const ctx = buildCtx({ ...defaultState, active: false });
      const result = await crumbsStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.active).toBe(false);
    });

    test('returns recordCount of 0 for v1', async () => {
      const ctx = buildCtx(defaultState);
      const result = await crumbsStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.recordCount).toBe(0);
    });

    test('returns sampling config from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await crumbsStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.samplingConfig).toEqual({
        destroy: DEFAULT_SAMPLING.destroy,
        read: DEFAULT_SAMPLING.read,
        write: DEFAULT_SAMPLING.write,
      });
    });

    test('returns custom sampling when state overrides defaults', async () => {
      const custom = { destroy: 0.5, read: 0.1, write: 0.9 };
      const ctx = buildCtx({ ...defaultState, sampling: custom });
      const result = await crumbsStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.samplingConfig).toEqual(custom);
    });
  });
});
