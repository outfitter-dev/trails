import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { signal } from '../signal.js';

const payloadSchema = z.object({
  action: z.string(),
  userId: z.string(),
});

const userAction = signal('user.action', {
  description: 'A user performed an action',
  from: ['auth.login', 'auth.signup'],
  meta: { domain: 'auth', priority: 1 },
  payload: payloadSchema,
});

describe('signal() basics', () => {
  test("returns kind 'signal'", () => {
    expect(userAction.kind).toBe('signal');
  });

  test('returns correct id', () => {
    expect(userAction.id).toBe('user.action');
  });

  test('preserves payload schema', () => {
    const parsed = userAction.payload.safeParse({
      action: 'click',
      userId: 'u-1',
    });
    expect(parsed.success).toBe(true);

    const bad = userAction.payload.safeParse({ userId: 42 });
    expect(bad.success).toBe(false);
  });

  test('preserves description', () => {
    expect(userAction.description).toBe('A user performed an action');
  });

  test('result object is frozen', () => {
    expect(Object.isFrozen(userAction)).toBe(true);
  });
});

describe('signal() from and meta', () => {
  test('preserves from', () => {
    expect(userAction.from).toEqual(['auth.login', 'auth.signup']);
  });

  test('from array is frozen', () => {
    expect(Object.isFrozen(userAction.from)).toBe(true);
  });

  test('preserves meta', () => {
    expect(userAction.meta).toEqual({ domain: 'auth', priority: 1 });
  });

  test('optional fields default to undefined', () => {
    const minimal = signal('minimal', {
      payload: z.string(),
    });
    expect(minimal.description).toBeUndefined();
    expect(minimal.from).toBeUndefined();
    expect(minimal.meta).toBeUndefined();
  });
});

describe('signal() single-object overload', () => {
  test('accepts spec with id property', () => {
    const e = signal({
      from: ['entity.add', 'entity.delete'],
      id: 'entity.updated',
      payload: z.object({ entityId: z.string() }),
    });
    expect(e.id).toBe('entity.updated');
    expect(e.kind).toBe('signal');
    expect(e.from).toEqual(['entity.add', 'entity.delete']);
  });
});
