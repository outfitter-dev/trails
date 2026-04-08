import { describe, expect, test } from 'bun:test';
import { createResourceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';

import type { TracingState } from '../tracing-state.js';
import { DEFAULT_SAMPLING } from '../sampling.js';
import { tracingStatus } from '../trails/tracing-status.js';

const passthroughTrace: TrailContext['trace'] = async (_label, fn) =>
  await fn();

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

/** Default test state. */
const defaultState: TracingState = {
  active: true,
  sampling: DEFAULT_SAMPLING,
  store: undefined,
};

describe('tracing.status', () => {
  describe('contract', () => {
    test('has correct id', () => {
      expect(tracingStatus.id).toBe('tracing.status');
    });

    test('has read intent', () => {
      expect(tracingStatus.intent).toBe('read');
    });

    test('has infrastructure meta', () => {
      expect(tracingStatus.meta).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(tracingStatus.examples).toBeDefined();
      expect(tracingStatus.examples?.length).toBeGreaterThan(0);
    });

    test('declares tracingResource in resources', () => {
      expect(tracingStatus.resources).toBeDefined();
      expect(tracingStatus.resources?.length).toBe(1);
    });
  });

  describe('run', () => {
    test('returns active from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracingStatus.blaze({}, ctx);
      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.active).toBe(true);
    });

    test('returns inactive when state says so', async () => {
      const ctx = buildCtx({ ...defaultState, active: false });
      const result = await tracingStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.active).toBe(false);
    });

    test('returns recordCount of 0 for v1', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracingStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.recordCount).toBe(0);
    });

    test('returns sampling config from state', async () => {
      const ctx = buildCtx(defaultState);
      const result = await tracingStatus.blaze({}, ctx);
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
      const result = await tracingStatus.blaze({}, ctx);
      const value = result.unwrap();
      expect(value.samplingConfig).toEqual(custom);
    });
  });
});
