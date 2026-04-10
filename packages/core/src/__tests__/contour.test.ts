import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  contour,
  getContourIdMetadata,
  getContourReferences,
} from '../contour.js';

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

const gist = contour(
  'gist',
  {
    id: z.string().uuid(),
    ownerId: user.id(),
    title: z.string(),
  },
  { identity: 'id' }
);

type UserId = z.infer<ReturnType<typeof user.id>>;
type GistId = z.infer<ReturnType<typeof gist.id>>;

const _ownerId: z.infer<typeof gist.shape.ownerId> = {} as UserId;
// @ts-expect-error distinct contour ids should not be assignable
const _mixedIds: UserId = {} as GistId;

describe('contour()', () => {
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

    test('returns a branded identity schema', () => {
      const schema = user.id();
      expect(
        schema.safeParse('550e8400-e29b-41d4-a716-446655440000').success
      ).toBe(true);
      expect(schema).toBe(user.id());
    });

    test('attaches contour metadata to branded identity schemas', () => {
      expect(getContourIdMetadata(user.id())).toEqual({
        contour: 'user',
        identity: 'id',
      });
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

    test('supports cross-contour references via .id()', () => {
      expect(
        gist.safeParse({
          id: '0f31f6ba-6ff0-41ce-9f6b-8d132b6c4b81',
          ownerId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Hello',
        }).success
      ).toBe(true);
      expect(getContourIdMetadata(gist.shape.ownerId)).toEqual({
        contour: 'user',
        identity: 'id',
      });
    });

    test('lists declared contour references', () => {
      expect(getContourReferences(gist)).toEqual([
        {
          contour: 'user',
          field: 'ownerId',
          identity: 'id',
        },
      ]);
    });
  });
});
