import { describe, expect, test } from 'bun:test';
import { createProvisionLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { TrackerState } from '../tracker-state.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import { trackerStatus } from '../trails/tracker-status.js';

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

/** Default test state. */
const defaultState: TrackerState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

describe('tracker.status', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(trackerStatus.id).toBe('tracker.status');
    });

    test('has read intent', () => {
      expect(trackerStatus.intent).toBe('read');
    });

    test('has infrastructure meta', () => {
      expect(trackerStatus.meta).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(trackerStatus.examples).toBeDefined();
      expect(trackerStatus.examples?.length).toBeGreaterThan(0);
    });

    test('declares trackerProvision in provisions', () => {
      expect(trackerStatus.provisions).toBeDefined();
      expect(trackerStatus.provisions?.length).toBe(1);
    });
  });

  describe('run', () => {
    test('returns active from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await trackerStatus.blaze({}, ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.active).toBe(true);
    });

    test('returns inactive when state says so', async () => {
      const ctx = buildCtx({ ...defaultState, active: false });
      const result = await trackerStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.active).toBe(false);
    });

    test('returns recordCount of 0 for v1', async () => {
      const ctx = buildCtx(defaultState);
      const result = await trackerStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.recordCount).toBe(0);
    });

    test('returns sampling config from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await trackerStatus.blaze({}, ctx);
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
      const result = await trackerStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.samplingConfig).toEqual(custom);
    });
  });
});
