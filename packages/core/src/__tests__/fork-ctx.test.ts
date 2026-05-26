import { describe, expect, test } from 'bun:test';

import { forkCtx } from '../internal/fork-ctx';
import type { ComposeFn, FireFn, TrailContext } from '../types';

// Sentinel values — the helper never invokes these, so their shapes are
// irrelevant. What matters is identity: a forked ctx must either clear
// them or preserve the exact reference.
const noopCompose = {} as unknown as ComposeFn;
const noopFire = {} as unknown as FireFn;
const noopResource = {} as unknown as TrailContext['resource'];

describe('forkCtx', () => {
  test('clears compose, fire, and resource by default', () => {
    const parent = {
      compose: noopCompose,
      env: { NODE_ENV: 'test' },
      extensions: { surface: 'cli' },
      fire: noopFire,
      logger: undefined,
      resource: noopResource,
    };

    const forked = forkCtx(parent, {});

    expect(forked.compose).toBeUndefined();
    expect(forked.fire).toBeUndefined();
    expect(forked.resource).toBeUndefined();
    // Non-reset keys are preserved.
    expect(forked.env).toEqual({ NODE_ENV: 'test' });
    expect(forked.extensions).toEqual({ surface: 'cli' });
  });

  test('applies overrides after reset so overrides win', () => {
    const parent = {
      compose: noopCompose,
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
    expect(forked.compose).toBeUndefined();
    expect(forked.fire).toBeUndefined();
    expect(forked.resource).toBeUndefined();
  });

  test('does not mutate the parent context', () => {
    const parent = {
      compose: noopCompose,
      fire: noopFire,
      resource: noopResource,
    };

    forkCtx(parent, {});

    expect(parent.compose).toBe(noopCompose);
    expect(parent.fire).toBe(noopFire);
    expect(parent.resource).toBe(noopResource);
  });

  test('honours a caller-supplied reset list', () => {
    const parent = {
      compose: noopCompose,
      fire: noopFire,
      resource: noopResource,
    };

    const forked = forkCtx(parent, {}, ['fire']);

    expect(forked.fire).toBeUndefined();
    // Only `fire` is reset when caller overrides the list.
    expect(forked.compose).toBe(noopCompose);
    expect(forked.resource).toBe(noopResource);
  });
});
