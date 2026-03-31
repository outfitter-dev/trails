import { describe, expect, test } from 'bun:test';
import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { TracksState } from '../registry.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import { tracksStatus } from '../trails/tracks-status.js';

/** Build a TrailContext with tracksService resolved in extensions. */
const buildCtx = (state: TracksState): TrailContext => {
  const extensions = { tracks: state };
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
const defaultState: TracksState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

describe('tracks.status', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(tracksStatus.id).toBe('tracks.status');
    });

    test('has read intent', () => {
      expect(tracksStatus.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(tracksStatus.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(tracksStatus.examples).toBeDefined();
      expect(tracksStatus.examples?.length).toBeGreaterThan(0);
    });

    test('declares tracksService in services', () => {
      expect(tracksStatus.services).toBeDefined();
      expect(tracksStatus.services?.length).toBe(1);
    });
  });

  describe('run', () => {
    test('returns active from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracksStatus.run({}, ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.active).toBe(true);
    });

    test('returns inactive when state says so', async () => {
      const ctx = buildCtx({ ...defaultState, active: false });
      const result = await tracksStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.active).toBe(false);
    });

    test('returns recordCount of 0 for v1', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracksStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.recordCount).toBe(0);
    });

    test('returns sampling config from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracksStatus.run({}, ctx);
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
      const result = await tracksStatus.run({}, ctx);
      const value = result.unwrap();
      expect(value.samplingConfig).toEqual(custom);
    });
  });
});
