import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result';
import { trail } from '../trail';
import type { PermitRequirement } from '../types';

describe('PermitRequirement type', () => {
  test('accepts a scopes object', () => {
    const req: PermitRequirement = { scopes: ['user:write', 'user:read'] };
    expect(req).toEqual({ scopes: ['user:write', 'user:read'] });
  });

  test('accepts public literal', () => {
    const req: PermitRequirement = 'public';
    expect(req).toBe('public');
  });
});

describe('trail() with permit field', () => {
  test('accepts permit with scopes', () => {
    const t = trail('user.delete', {
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      permit: { scopes: ['user:write'] },
      run: (input) => Result.ok({ deleted: input.id }),
    });
    expect(t.permit).toEqual({ scopes: ['user:write'] });
  });

  test('accepts permit: public', () => {
    const t = trail('health.check', {
      input: z.object({}),
      intent: 'read',
      permit: 'public',
      run: () => Result.ok({ status: 'ok' }),
    });
    expect(t.permit).toBe('public');
  });

  test('permit is undefined when omitted (backward compatible)', () => {
    const t = trail('legacy.trail', {
      input: z.object({}),
      run: () => Result.ok(),
    });
    expect(t.permit).toBeUndefined();
  });

  test('preserves permit on the frozen Trail object', () => {
    const t = trail('user.list', {
      input: z.object({}),
      intent: 'read',
      permit: { scopes: ['user:read'] },
      run: () => Result.ok([]),
    });
    expect(Object.isFrozen(t)).toBe(true);
    expect(t.permit).toEqual({ scopes: ['user:read'] });
  });
});
