import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { entity, getEntityIdMetadata, getEntityReferences } from '../entity.js';

const user = entity(
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

const gist = entity(
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
// @ts-expect-error distinct entity ids should not be assignable
const _mixedIds: UserId = {} as GistId;

describe('entity()', () => {
  describe('basics', () => {
    test("returns kind 'entity'", () => {
      expect(user.kind).toBe('entity');
    });

    test('preserves the entity name', () => {
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

    test('attaches entity metadata to branded identity schemas', () => {
      expect(getEntityIdMetadata(user.id())).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('preserves first-write metadata when identity schemas are shared', () => {
      const baseUser = entity(
        'user',
        { id: z.string().uuid(), name: z.string() },
        { identity: 'id' }
      );
      const admin = entity(
        'admin',
        { id: baseUser.shape.id, role: z.string() },
        { identity: 'id' }
      );

      // The first entity to brand the schema wins — user, not admin.
      expect(getEntityIdMetadata(baseUser.id())).toEqual({
        entity: 'user',
        identity: 'id',
      });
      // admin still has its own id() accessor
      expect(admin.id()).toBeDefined();

      // Neither entity should emit its own identity as a compose-entity reference
      expect(getEntityReferences(baseUser)).toEqual([]);
      expect(getEntityReferences(admin)).toEqual([]);
    });

    test('rejects identity keys that are not in the shape', () => {
      expect(() =>
        entity(
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

    test('validates examples against the entity schema', () => {
      expect(() =>
        entity(
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

    test('supports compose-entity references via .id()', () => {
      expect(
        gist.safeParse({
          id: '0f31f6ba-6ff0-41ce-9f6b-8d132b6c4b81',
          ownerId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Hello',
        }).success
      ).toBe(true);
      expect(getEntityIdMetadata(gist.shape.ownerId)).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('lists declared entity references', () => {
      expect(getEntityReferences(gist)).toEqual([
        {
          entity: 'user',
          field: 'ownerId',
          identity: 'id',
        },
      ]);
    });
  });

  describe('wrapper unwrapping', () => {
    test('resolves .optional() entity id metadata', () => {
      expect(getEntityIdMetadata(user.id().optional())).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('resolves .nullable() entity id metadata', () => {
      expect(getEntityIdMetadata(user.id().nullable())).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('resolves .nullish() entity id metadata (two-level wrapper)', () => {
      expect(getEntityIdMetadata(user.id().nullish())).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('resolves deeply nested wrappers', () => {
      expect(
        getEntityIdMetadata(user.id().nullable().optional().default(null))
      ).toEqual({
        entity: 'user',
        identity: 'id',
      });
    });

    test('detects references through .nullish() wrappers in entity shapes', () => {
      const comment = entity(
        'comment',
        {
          authorId: user.id().nullish(),
          id: z.string().uuid(),
          text: z.string(),
        },
        { identity: 'id' }
      );

      expect(getEntityReferences(comment)).toEqual([
        {
          entity: 'user',
          field: 'authorId',
          identity: 'id',
        },
      ]);
    });
  });
});
