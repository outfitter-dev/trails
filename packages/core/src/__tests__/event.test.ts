import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { event } from '../event';

const payloadSchema = z.object({
  action: z.string(),
  userId: z.string(),
});

const userAction = event('user.action', {
  description: 'A user performed an action',
  from: ['auth.login', 'auth.signup'],
  markers: { domain: 'auth', priority: 1 },
  payload: payloadSchema,
});

describe('event() basics', () => {
  test("returns kind 'event'", () => {
    expect(userAction.kind).toBe('event');
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

describe('event() from and markers', () => {
  test('preserves from', () => {
    expect(userAction.from).toEqual(['auth.login', 'auth.signup']);
  });

  test('from array is frozen', () => {
    expect(Object.isFrozen(userAction.from)).toBe(true);
  });

  test('preserves markers', () => {
    expect(userAction.markers).toEqual({ domain: 'auth', priority: 1 });
  });

  test('optional fields default to undefined', () => {
    const minimal = event('minimal', {
      payload: z.string(),
    });
    expect(minimal.description).toBeUndefined();
    expect(minimal.from).toBeUndefined();
    expect(minimal.markers).toBeUndefined();
  });
});

describe('event() single-object overload', () => {
  test('accepts spec with id property', () => {
    const e = event({
      from: ['entity.add', 'entity.delete'],
      id: 'entity.updated',
      payload: z.object({ entityId: z.string() }),
    });
    expect(e.id).toBe('entity.updated');
    expect(e.kind).toBe('event');
    expect(e.from).toEqual(['entity.add', 'entity.delete']);
  });
});
