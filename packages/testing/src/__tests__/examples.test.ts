import { describe, test } from 'bun:test';

import { NotFoundError, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testExamples } from '../examples.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const greetTrail = trail('greet', {
  description: 'Greet someone',
  examples: [
    {
      expected: { greeting: 'Hello, Alice' },
      input: { name: 'Alice' },
      name: 'Greet Alice',
    },
  ],
  implementation: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}` }),
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const searchTrail = trail('search', {
  description: 'Search for things',
  examples: [
    {
      input: { query: 'test' },
      name: 'Schema-only search',
    },
  ],
  implementation: (input: { query: string }) =>
    Result.ok({ results: [`result for ${input.query}`] }),
  input: z.object({ query: z.string() }),
  output: z.object({ results: z.array(z.string()) }),
});

const entityTrail = trail('entity.show', {
  description: 'Show entity',
  examples: [
    {
      expected: { id: 1, name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Show entity by name',
    },
    {
      error: 'NotFoundError',
      input: { name: 'missing' },
      name: 'Entity not found returns NotFoundError',
    },
  ],
  implementation: (input: { name: string }) => {
    if (input.name === 'missing') {
      return Result.err(new NotFoundError('Entity not found'));
    }
    return Result.ok({ id: 1, name: input.name });
  },
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
});

const noExamplesTrail = trail('noexamples', {
  implementation: (input: { x: number }) => Result.ok(input.x * 2),
  input: z.object({ x: z.number() }),
});

// ---------------------------------------------------------------------------
// Composition trails (for follow coverage)
// ---------------------------------------------------------------------------

const addTrail = trail('entity.add', {
  description: 'Add an entity',
  implementation: (input: { name: string }) =>
    Result.ok({ id: '1', name: input.name }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const relateTrail = trail('entity.relate', {
  description: 'Relate entities',
  implementation: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
});

const onboardTrail = trail('entity.onboard', {
  description: 'Onboard a new entity',
  examples: [
    {
      expected: { id: '1', name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Onboard Alpha',
    },
  ],
  follow: ['entity.add', 'entity.relate'],
  implementation: async (input: { name: string }, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const addResult = await ctx.follow('entity.add', input);
    if (addResult.isErr()) {
      return addResult;
    }
    const relateResult = await ctx.follow('entity.relate', {
      from: 'root',
      to: (addResult.value as { id: string }).id,
    });
    if (relateResult.isErr()) {
      return relateResult;
    }
    return Result.ok({ id: '1', name: input.name });
  },
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('testExamples', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('test-app', {
      entityTrail,
      greetTrail,
      noExamplesTrail,
      searchTrail,
    } as Record<string, unknown>)
  );

  // Also test with custom context (static form)
  describe('with custom context', () => {
    // eslint-disable-next-line jest/require-hook
    testExamples(topo('ctx-app', { greetTrail } as Record<string, unknown>), {
      requestId: 'custom-request',
    });
  });

  // Test with factory form (each test gets a fresh context)
  describe('with context factory', () => {
    // eslint-disable-next-line jest/require-hook
    testExamples(
      topo('factory-app', { greetTrail } as Record<string, unknown>),
      () => ({ requestId: `factory-${crypto.randomUUID()}` })
    );
  });
});

describe('testExamples skips trails with no examples', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('skip-app', {
      noExamplesTrail,
    } as Record<string, unknown>)
  );

  test('no-op marker', () => {
    // This test exists so the describe block is not empty
  });
});

describe('testExamples follow coverage for composition trails', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('composition-app', {
      addTrail,
      onboardTrail,
      relateTrail,
    } as Record<string, unknown>)
  );
});
