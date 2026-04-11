import { describe, expect, test } from 'bun:test';

import { contour, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { resolveTrailExamples } from '../effective-examples.js';

const requireContourExample = (
  contourDef: { examples?: readonly Record<string, unknown>[] },
  index: number
) => {
  const example = contourDef.examples?.[index];
  expect(example).toBeDefined();
  if (!example) {
    throw new Error(`Expected contour example at index ${index}`);
  }
  return example;
};

const userContour = contour(
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

const gistContour = contour(
  'gist',
  {
    id: z.string().uuid(),
    ownerId: userContour.id(),
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

describe('resolveTrailExamples', () => {
  test('prefers authored trail examples over contour-derived fixtures', () => {
    const authoredExample = {
      expected: { email: 'manual@example.com', name: 'Manual' },
      input: { email: 'manual@example.com', name: 'Manual' },
      name: 'Manual example',
    } as const;

    const trailDef = trail('user.manual', {
      blaze: (input: { email: string; name: string }) => Result.ok(input),
      contours: [userContour],
      examples: [authoredExample],
      input: z.object({ email: z.string().email(), name: z.string() }),
      output: z.object({ email: z.string().email(), name: z.string() }),
    });

    expect(resolveTrailExamples(trailDef)).toEqual([authoredExample]);
  });

  test('derives single-contour fixtures and preserves full contour output', () => {
    const firstUserExample = requireContourExample(userContour, 0);

    const trailDef = trail('user.create', {
      blaze: () => Result.ok(firstUserExample),
      contours: [userContour],
      input: userContour.pick({ email: true, name: true }),
      output: userContour,
    });

    const examples = resolveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    const firstRecord = firstUserExample as Record<string, unknown>;
    expect(examples[0]).toEqual(
      expect.objectContaining({
        expected: firstUserExample,
        // Input is projected down to the keys `trail.input` declares, so
        // only `email` and `name` (from `.pick`) survive.
        input: {
          email: firstRecord.email,
          name: firstRecord.name,
        },
      })
    );
  });

  test('filters contour fixtures that do not satisfy the trail input schema', () => {
    const trailDef = trail('user.slug-only', {
      blaze: () => Result.ok({ slug: 'unused' }),
      contours: [userContour],
      input: z.object({ slug: z.string() }),
      output: z.object({ slug: z.string() }),
    });

    expect(resolveTrailExamples(trailDef)).toEqual([]);
  });

  test('matches cross-contour references and exposes contour-prefixed aliases', () => {
    const trailDef = trail('gist.star', {
      blaze: (input: { gistId: string; userId: string }) => Result.ok(input),
      contours: [userContour, gistContour],
      input: z.object({
        gistId: gistContour.id(),
        userId: userContour.id(),
      }),
      output: z.object({
        gistId: gistContour.shape.id,
        userId: userContour.shape.id,
      }),
    });

    const examples = resolveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    // No contour fixture parses as the output schema on its own (the
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

  test('derives fixtures for strict input schemas by projecting to known keys', () => {
    const firstUserExample = requireContourExample(userContour, 0);

    const trailDef = trail('user.strict-create', {
      blaze: (input: { email: string; name: string }) => Result.ok(input),
      contours: [userContour],
      input: z.object({ email: z.string().email(), name: z.string() }).strict(),
      output: z.object({ email: z.string().email(), name: z.string() }),
    });

    const examples = resolveTrailExamples(trailDef);
    expect(examples).toHaveLength(2);
    expect(examples[0]?.input).toEqual({
      email: (firstUserExample as { email: string }).email,
      name: (firstUserExample as { name: string }).name,
    });
  });

  test('does not infer expected from merged input when no contour fixture matches the output', () => {
    // The output schema is a subset of the input shape, so the merged
    // derived input would parse as the output if we tried to infer from
    // it — but that inference is semantically wrong because input and
    // output have distinct meanings. Since no contour fixture matches
    // the output schema (userContour fixtures carry id+email+name, and
    // the strict output only accepts email+name), `expected` must be
    // omitted entirely.
    const trailDef = trail('user.create-strict-output', {
      blaze: (input: { email: string; name: string }) => Result.ok(input),
      contours: [userContour],
      input: z.object({ email: z.string().email(), name: z.string() }),
      output: z
        .object({ email: z.string().email(), name: z.string() })
        .strict(),
    });

    const examples = resolveTrailExamples(trailDef);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example.expected).toBeUndefined();
    }
  });
});
