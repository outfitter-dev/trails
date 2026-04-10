import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';

describe('contour()', () => {
  const user = contour(
    'user',
    {
      email: z.string().email(),
      id: z.string().uuid(),
      name: z.string(),
    },
    {
      examples: [
        {
          email: 'ada@example.com',
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Ada',
        },
      ],
      identity: 'id',
    }
  );

  describe('basics', () => {
    test("returns kind 'contour'", () => {
      expect(user.kind).toBe('contour');
    });

    test('preserves the contour name', () => {
      expect(user.name).toBe('user');
    });

    test('preserves schema behavior', () => {
      const parsed = user.safeParse({
        email: 'ada@example.com',
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Ada',
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe('identity', () => {
    test('stores the identity field name', () => {
      expect(user.identity).toBe('id');
    });

    test('exposes the identity field schema', () => {
      expect(user.identitySchema).toBe(user.shape.id);
    });

    test('rejects identity keys that are not in the shape', () => {
      expect(() =>
        contour(
          'broken',
          {
            id: z.string(),
          },
          { identity: 'missing' as 'id' }
        )
      ).toThrow('identity "missing" must match a declared field');
    });
  });

  describe('examples', () => {
    test('stores examples as a frozen array', () => {
      expect(user.examples).toHaveLength(1);
      expect(Object.isFrozen(user.examples)).toBe(true);
    });

    test('validates examples against the contour schema', () => {
      expect(() =>
        contour(
          'broken',
          {
            id: z.string().uuid(),
            name: z.string(),
          },
          {
            examples: [{ id: 'not-a-uuid', name: 42 as never }],
            identity: 'id',
          }
        )
      ).toThrow('example 0 is invalid');
    });
  });

  describe('zod forwarding', () => {
    test('supports .pick()', () => {
      const schema = user.pick({ name: true });
      expect(schema.safeParse({ name: 'Ada' }).success).toBe(true);
      expect(schema.safeParse({ email: 'ada@example.com' }).success).toBe(
        false
      );
    });

    test('supports .extend()', () => {
      const schema = user.extend({ active: z.boolean() });
      expect(
        schema.safeParse({
          active: true,
          email: 'ada@example.com',
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Ada',
        }).success
      ).toBe(true);
    });

    test('supports .array()', () => {
      const schema = user.array();
      expect(
        schema.safeParse([
          {
            email: 'ada@example.com',
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Ada',
          },
        ]).success
      ).toBe(true);
    });
  });
});
