import { describe, expect, test } from 'bun:test';

import { forkCtx } from '../internal/fork-ctx';
import type { CrossFn, FireFn, TrailContext } from '../types';

// Sentinel values — the helper never invokes these, so their shapes are
// irrelevant. What matters is identity: a forked ctx must either clear
// them or preserve the exact reference.
const noopCross = {} as unknown as CrossFn;
const noopFire = {} as unknown as FireFn;
const noopResource = {} as unknown as TrailContext['resource'];

describe('forkCtx', () => {
  test('clears cross, fire, and resource by default', () => {
    const parent = {
      cross: noopCross,
      env: { NODE_ENV: 'test' },
      extensions: { trailhead: 'cli' },
      fire: noopFire,
      logger: undefined,
      resource: noopResource,
    };

    const forked = forkCtx(parent, {});

    expect(forked.cross).toBeUndefined();
    expect(forked.fire).toBeUndefined();
    expect(forked.resource).toBeUndefined();
    // Non-reset keys are preserved.
    expect(forked.env).toEqual({ NODE_ENV: 'test' });
    expect(forked.extensions).toEqual({ trailhead: 'cli' });
  });

  test('applies overrides after reset so overrides win', () => {
    const parent = {
      cross: noopCross,
      env: { NODE_ENV: 'test' },
      extensions: { a: 1 },
      fire: noopFire,
      resource: noopResource,
    };

    const forked = forkCtx(parent, {
      env: { NODE_ENV: 'prod' },
      extensions: { b: 2 },
    });

    expect(forked.env).toEqual({ NODE_ENV: 'prod' });
    expect(forked.extensions).toEqual({ b: 2 });
    expect(forked.cross).toBeUndefined();
    expect(forked.fire).toBeUndefined();
    expect(forked.resource).toBeUndefined();
  });

  test('does not mutate the parent context', () => {
    const parent = {
      cross: noopCross,
      fire: noopFire,
      resource: noopResource,
    };

    forkCtx(parent, {});

    expect(parent.cross).toBe(noopCross);
    expect(parent.fire).toBe(noopFire);
    expect(parent.resource).toBe(noopResource);
  });

  test('honours a caller-supplied reset list', () => {
    const parent = {
      cross: noopCross,
      fire: noopFire,
      resource: noopResource,
    };

    const forked = forkCtx(parent, {}, ['fire']);

    expect(forked.fire).toBeUndefined();
    // Only `fire` is reset when caller overrides the list.
    expect(forked.cross).toBe(noopCross);
    expect(forked.resource).toBe(noopResource);
  });
});
