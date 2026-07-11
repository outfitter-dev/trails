import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { basePermitSchema } from '../permits';
import { Result } from '../result';
import { trail } from '../trail';
import type { PermitRequirement } from '../types';

describe('basePermitSchema', () => {
  test('parses the canonical BasePermit shape', () => {
    const parsed = basePermitSchema.parse({
      id: 'permit-user-1',
      scopes: ['user:read'],
    });
    expect(parsed).toEqual({ id: 'permit-user-1', scopes: ['user:read'] });
  });

  test('rejects malformed permit payloads', () => {
    const parsed = basePermitSchema.safeParse({
      id: 123,
      scopes: ['user:read'],
    });
    expect(parsed.success).toBe(false);
  });
});

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
      implementation: (input) => Result.ok({ deleted: input.id }),
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      permit: { scopes: ['user:write'] },
    });
    expect(t.permit).toEqual({ scopes: ['user:write'] });
  });

  test('accepts permit: public', () => {
    const t = trail('health.check', {
      implementation: () => Result.ok({ status: 'ok' }),
      input: z.object({}),
      intent: 'read',
      permit: 'public',
    });
    expect(t.permit).toBe('public');
  });

  test('permit is undefined when omitted (backward compatible)', () => {
    const t = trail('legacy.trail', {
      implementation: () => Result.ok(),
      input: z.object({}),
    });
    expect(t.permit).toBeUndefined();
  });

  test('preserves permit on the frozen Trail object', () => {
    const t = trail('user.list', {
      implementation: () => Result.ok([]),
      input: z.object({}),
      intent: 'read',
      permit: { scopes: ['user:read'] },
    });
    expect(Object.isFrozen(t)).toBe(true);
    expect(t.permit).toEqual({ scopes: ['user:read'] });
  });
});
