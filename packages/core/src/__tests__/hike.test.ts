import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result';
import { hike } from '../hike';
import type { TrailContext } from '../types';

const stubCtx: TrailContext = {
  requestId: 'test-123',
  signal: AbortSignal.timeout(5000),
};

describe('hike()', () => {
  const inputSchema = z.object({ userId: z.string() });
  const outputSchema = z.object({ profile: z.string() });

  const fetchProfile = hike('fetch-profile', {
    description: 'Fetch a user profile',
    follows: ['authenticate', 'validate-session'],
    implementation: (input) =>
      Result.ok({ profile: `Profile for ${input.userId}` }),
    input: inputSchema,
    output: outputSchema,
  });

  describe('basics', () => {
    test("returns kind 'hike'", () => {
      expect(fetchProfile.kind).toBe('hike');
    });

    test('returns correct id', () => {
      expect(fetchProfile.id).toBe('fetch-profile');
    });

    test('preserves follows array', () => {
      expect(fetchProfile.follows).toEqual([
        'authenticate',
        'validate-session',
      ]);
    });

    test('follows array is frozen', () => {
      expect(Object.isFrozen(fetchProfile.follows)).toBe(true);
    });
  });

  describe('trail compatibility', () => {
    test('extends Trail — has input schema', () => {
      const parsed = fetchProfile.input.safeParse({ userId: 'u-1' });
      expect(parsed.success).toBe(true);
    });

    test('extends Trail — has output schema', () => {
      expect(fetchProfile.output).toBeDefined();
    });

    test('extends Trail — implementation is callable', async () => {
      const result = await fetchProfile.implementation(
        { userId: 'u-1' },
        stubCtx
      );
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ profile: 'Profile for u-1' });
    });

    test('preserves description', () => {
      expect(fetchProfile.description).toBe('Fetch a user profile');
    });

    test('result object is frozen', () => {
      expect(Object.isFrozen(fetchProfile)).toBe(true);
    });
  });

  test('markers are preserved', () => {
    const withMarkers = hike('tagged-hike', {
      follows: ['setup'],
      implementation: () => Result.ok(),
      input: z.object({}),
      markers: { domain: 'auth' },
    });
    expect(withMarkers.markers).toEqual({ domain: 'auth' });
  });

  describe('single-object overload', () => {
    test('accepts spec with id property', () => {
      const r = hike({
        follows: ['entity.add', 'entity.relate'],
        id: 'entity.onboard',
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(r.id).toBe('entity.onboard');
      expect(r.kind).toBe('hike');
      expect(r.follows).toEqual(['entity.add', 'entity.relate']);
    });

    test('sync implementations are normalized to an awaitable runtime function', async () => {
      const r = hike({
        follows: ['entity.add'],
        id: 'entity.check',
        implementation: (input: { userId: string }) =>
          Result.ok({ profile: input.userId }),
        input: inputSchema,
        output: outputSchema,
      });

      const promise = r.implementation({ userId: 'u-2' }, stubCtx);
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ profile: 'u-2' });
    });
  });
});
