import { describe, expect, test } from 'bun:test';

import { entity, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { deriveTrailExamples } from '../effective-examples.js';

const requireEntityExample = (
  entityDef: { examples?: readonly Record<string, unknown>[] },
  index: number
) => {
  const example = entityDef.examples?.[index];
  expect(example).toBeDefined();
  if (!example) {
    throw new Error(`Expected entity example at index ${index}`);
  }
  return example;
};

const userEntity = entity(
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
      {
        email: 'grace@example.com',
        id: '0f31f6ba-6ff0-41ce-9f6b-8d132b6c4b81',
        name: 'Grace',
      },
    ],
    identity: 'id',
  }
);

const gistEntity = entity(
  'gist',
  {
    id: z.string().uuid(),
    ownerId: userEntity.id(),
    title: z.string(),
  },
  {
    examples: [
      {
        id: '8f7ef40d-8234-4f73-8de8-4bb8366cf5c0',
        ownerId: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Ada Gist',
      },
      {
        id: 'f104f457-b3fd-4643-87b9-d872c54b8a79',
        ownerId: '0f31f6ba-6ff0-41ce-9f6b-8d132b6c4b81',
        title: 'Grace Gist',
      },
    ],
    identity: 'id',
  }
);

describe('deriveTrailExamples', () => {
  test('prefers authored trail examples over entity-derived fixtures', () => {
    const authoredExample = {
      expected: { email: 'manual@example.com', name: 'Manual' },
      input: { email: 'manual@example.com', name: 'Manual' },
      name: 'Manual example',
    } as const;

    const trailDef = trail('user.manual', {
      entities: [userEntity],
      examples: [authoredExample],
      implementation: (input: { email: string; name: string }) =>
        Result.ok(input),
      input: z.object({ email: z.string().email(), name: z.string() }),
      output: z.object({ email: z.string().email(), name: z.string() }),
    });

    expect(deriveTrailExamples(trailDef)).toEqual([authoredExample]);
  });

  test('derives single-entity fixtures and preserves full entity output', () => {
    const firstUserExample = requireEntityExample(userEntity, 0);

    const trailDef = trail('user.create', {
      entities: [userEntity],
      implementation: () => Result.ok(firstUserExample),
      input: userEntity.pick({ email: true, name: true }),
      output: userEntity,
    });

    const examples = deriveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    const firstRecord = firstUserExample as Record<string, unknown>;
    expect(examples[0]).toEqual(
      expect.objectContaining({
        expected: firstUserExample,
        // Input is derived down to the keys `trail.input` declares, so
        // only `email` and `name` (from `.pick`) survive.
        input: {
          email: firstRecord.email,
          name: firstRecord.name,
        },
      })
    );
  });

  test('filters entity fixtures that do not satisfy the trail input schema', () => {
    const trailDef = trail('user.slug-only', {
      entities: [userEntity],
      implementation: () => Result.ok({ slug: 'unused' }),
      input: z.object({ slug: z.string() }),
      output: z.object({ slug: z.string() }),
    });

    expect(deriveTrailExamples(trailDef)).toEqual([]);
  });

  test('matches compose-entity references and exposes entity-prefixed aliases', () => {
    const trailDef = trail('gist.star', {
      entities: [userEntity, gistEntity],
      implementation: (input: { gistId: string; userId: string }) =>
        Result.ok(input),
      input: z.object({
        gistId: gistEntity.id(),
        userId: userEntity.id(),
      }),
      output: z.object({
        gistId: gistEntity.shape.id,
        userId: userEntity.shape.id,
      }),
    });

    const examples = deriveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    // No entity fixture parses as the output schema on its own (the
    // output expects `gistId` and `userId`, but the fixtures expose
    // `id`, `ownerId`, etc.), so derived examples are left without an
    // `expected` and fall back to schema-only validation at runtime.
    expect(examples).toEqual([
      {
        input: {
          gistId: '8f7ef40d-8234-4f73-8de8-4bb8366cf5c0',
          userId: '550e8400-e29b-41d4-a716-446655440000',
        },
        name: expect.stringContaining('Derived fixture 1'),
      },
      {
        input: {
          gistId: 'f104f457-b3fd-4643-87b9-d872c54b8a79',
          userId: '0f31f6ba-6ff0-41ce-9f6b-8d132b6c4b81',
        },
        name: expect.stringContaining('Derived fixture 2'),
      },
    ]);
  });

  test('derives fixtures for strict input schemas by deriving to known keys', () => {
    const firstUserExample = requireEntityExample(userEntity, 0);

    const trailDef = trail('user.strict-create', {
      entities: [userEntity],
      implementation: (input: { email: string; name: string }) =>
        Result.ok(input),
      input: z.object({ email: z.string().email(), name: z.string() }).strict(),
      output: z.object({ email: z.string().email(), name: z.string() }),
    });

    const examples = deriveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    expect(examples[0]?.input).toEqual({
      email: (firstUserExample as { email: string }).email,
      name: (firstUserExample as { name: string }).name,
    });
  });

  test('does not infer expected from merged input when no entity fixture matches the output', () => {
    // The output schema is a subset of the input shape, so the merged
    // derived input would parse as the output if we tried to infer from
    // it — but that inference is semantically wrong because input and
    // output have distinct meanings. Since no entity fixture matches
    // the output schema (userEntity fixtures carry id+email+name, and
    // the strict output only accepts email+name), `expected` must be
    // omitted entirely.
    const trailDef = trail('user.create-strict-output', {
      entities: [userEntity],
      implementation: (input: { email: string; name: string }) =>
        Result.ok(input),
      input: z.object({ email: z.string().email(), name: z.string() }),
      output: z
        .object({ email: z.string().email(), name: z.string() })
        .strict(),
    });

    const examples = deriveTrailExamples(trailDef);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.expected).toBeUndefined();
    }
  });
});
