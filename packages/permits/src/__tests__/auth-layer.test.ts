/* oxlint-disable require-await -- layer wrappers satisfy async interfaces without awaiting */
import { describe, expect, test } from 'bun:test';

import { Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { authLayer } from '../auth-layer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCtx = (permit?: {
  id: string;
  scopes: readonly string[];
}): TrailContext => ({
  abortSignal: AbortSignal.timeout(5000),
  permit,
  requestId: 'test-auth',
});

const okImpl = async () => Result.ok({ done: true });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authLayer', () => {
  test('has correct name and description', () => {
    expect(authLayer.name).toBe('auth');
    expect(authLayer.description).toBeDefined();
  });

  describe('pass-through cases', () => {
    test('passes through when trail has no permit field', async () => {
      const t = trail('test.nopermit', {
        blaze: okImpl,
        input: z.object({}),
        output: z.object({ done: z.boolean() }),
      });

      const wrapped = authLayer.wrap(t, okImpl);
      const result = await wrapped({}, makeCtx());

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });

    test('passes through when trail permit is public', async () => {
      const t = trail('test.public', {
        blaze: okImpl,
        input: z.object({}),
        output: z.object({ done: z.boolean() }),
        permit: 'public',
      });

      const wrapped = authLayer.wrap(t, okImpl);
      const result = await wrapped({}, makeCtx());

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });
  });

  describe('compatibility pass-through', () => {
    const scopedTrail = trail('test.scoped', {
      blaze: okImpl,
      input: z.object({}),
      output: z.object({ done: z.boolean() }),
      permit: { scopes: ['user:read'] },
    });

    test('passes when ctx.permit has matching scopes', async () => {
      const wrapped = authLayer.wrap(scopedTrail, okImpl);
      const result = await wrapped(
        {},
        makeCtx({ id: 'usr-1', scopes: ['user:read'] })
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });

    test('does not enforce missing permits directly', async () => {
      const wrapped = authLayer.wrap(scopedTrail, okImpl);
      const result = await wrapped({}, makeCtx());

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });

    test('does not enforce missing scopes directly', async () => {
      const multiScopeTrail = trail('test.multi', {
        blaze: okImpl,
        input: z.object({}),
        output: z.object({ done: z.boolean() }),
        permit: { scopes: ['user:read', 'user:write'] },
      });

      const wrapped = authLayer.wrap(multiScopeTrail, okImpl);
      const result = await wrapped(
        {},
        makeCtx({ id: 'usr-1', scopes: ['user:read'] })
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });

    test('passes when permit has superset of required scopes', async () => {
      const wrapped = authLayer.wrap(scopedTrail, okImpl);
      const result = await wrapped(
        {},
        makeCtx({
          id: 'usr-1',
          scopes: ['user:read', 'user:write', 'admin'],
        })
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ done: true });
    });
  });
});
