import { describe, test } from 'bun:test';

import { NotFoundError, Result, resource, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testExamples } from '../examples.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const greetTrail = trail('greet', {
  blaze: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}` }),
  description: 'Greet someone',
  examples: [
    {
      expected: { greeting: 'Hello, Alice' },
      input: { name: 'Alice' },
      name: 'Greet Alice',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const searchTrail = trail('search', {
  blaze: (input: { query: string }) =>
    Result.ok({ results: [`result for ${input.query}`] }),
  description: 'Search for things',
  examples: [
    {
      input: { query: 'test' },
      name: 'Schema-only search',
    },
  ],
  input: z.object({ query: z.string() }),
  output: z.object({ results: z.array(z.string()) }),
});

const entityTrail = trail('entity.show', {
  blaze: (input: { name: string }) => {
    if (input.name === 'missing') {
      return Result.err(new NotFoundError('Entity not found'));
    }
    return Result.ok({ id: 1, name: input.name });
  },
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
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
});

const noExamplesTrail = trail('noexamples', {
  blaze: (input: { x: number }) => Result.ok(input.x * 2),
  input: z.object({ x: z.number() }),
});

const mockDbResource = resource('db.mock.examples', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const mockResourceTrail = trail('resource.mocked', {
  blaze: (_input, ctx) =>
    Result.ok({ source: mockDbResource.from(ctx).source }),
  description: 'Trail that reads from a mocked resource',
  examples: [
    {
      expected: { source: 'mock' },
      input: {},
      name: 'Uses auto-resolved resource mock',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  resources: [mockDbResource],
});

const explicitOverrideTrail = trail('resource.override', {
  blaze: (_input, ctx) =>
    Result.ok({ source: mockDbResource.from(ctx).source }),
  description: 'Trail whose resource mock can be overridden explicitly',
  examples: [
    {
      expected: { source: 'override' },
      input: {},
      name: 'Explicit resource override wins over mock factory',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  resources: [mockDbResource],
});

const transformedInputTrail = trail('example.transformed', {
  blaze: (input: { value: number }) => Result.ok({ value: input.value }),
  description: 'Trail whose input schema transforms once',
  examples: [
    {
      expected: { value: 2 },
      input: { value: '1' },
      name: 'Raw example input is only transformed once',
    },
  ],
  input: z
    .object({ value: z.string() })
    .transform(({ value }) => ({ value: Number(value) + 1 })),
  output: z.object({ value: z.number() }),
});

const ctxOverrideTrail = trail('resource.ctx-override', {
  blaze: (_input, ctx) =>
    Result.ok({ source: mockDbResource.from(ctx).source }),
  description: 'Trail whose resource mock can be overridden by ctx.extensions',
  examples: [
    {
      expected: { source: 'ctx' },
      input: {},
      name: 'Context extensions beat auto-resolved mock resources',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  resources: [mockDbResource],
});

const undeclaredDbResource = resource('db.undeclared.examples', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredResourceTrail = trail('resource.undeclared.examples', {
  blaze: (_input, ctx) =>
    Result.ok({ source: undeclaredDbResource.from(ctx).source }),
  description: 'Trail that uses a resource without declaring it',
  examples: [
    {
      error: 'InternalError',
      input: {},
      name: 'Undeclared resources stay unavailable during example execution',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
});
const crossDbResource = resource('db.mock.examples.crosses', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const crossLeafTrail = trail('resource.crosses.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childSource: crossDbResource.from(ctx).source }),
  description: 'Leaf trail that resolves a resource inside a cross chain',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  resources: [crossDbResource],
});

const crossRootTrail = trail('resource.crosses.root', {
  blaze: async (_input, ctx) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const childResult = await ctx.cross<{ childSource: string }>(
      'resource.crosses.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }
    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: crossDbResource.from(ctx).source,
    });
  },
  crosses: ['resource.crosses.leaf'],
  description: 'Root trail that crosses a child trail using resources',
  examples: [
    {
      expected: { childSource: 'mock', rootSource: 'mock' },
      input: {},
      name: 'Propagates resource mocks through cross execution',
    },
  ],
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  resources: [crossDbResource],
});

// ---------------------------------------------------------------------------
// Composition trails (for cross coverage)
// ---------------------------------------------------------------------------

const addTrail = trail('entity.add', {
  blaze: (input: { name: string }) => Result.ok({ id: '1', name: input.name }),
  description: 'Add an entity',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const relateTrail = trail('entity.relate', {
  blaze: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
  description: 'Relate entities',
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
});

const onboardTrail = trail('entity.onboard', {
  blaze: async (input: { name: string }, ctx) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const addResult = await ctx.cross('entity.add', input);
    if (addResult.isErr()) {
      return addResult;
    }
    const relateResult = await ctx.cross('entity.relate', {
      from: 'root',
      to: (addResult.value as { id: string }).id,
    });
    if (relateResult.isErr()) {
      return relateResult;
    }
    return Result.ok({ id: '1', name: input.name });
  },
  crosses: ['entity.add', 'entity.relate'],
  description: 'Onboard a new entity',
  examples: [
    {
      expected: { id: '1', name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Onboard Alpha',
    },
  ],
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

describe('testExamples resource mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('resource-mock-app', {
      mockDbResource,
      mockResourceTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples explicit resource overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('resource-override-app', {
      explicitOverrideTrail,
      mockDbResource,
    } as Record<string, unknown>),
    {
      resources: { 'db.mock.examples': { source: 'override' } },
    }
  );
});

describe('testExamples raw transformed input', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('transformed-input-app', {
      transformedInputTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples context extension overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('ctx-override-app', {
      ctxOverrideTrail,
      mockDbResource,
    } as Record<string, unknown>),
    {
      ctx: {
        extensions: { 'db.mock.examples': { source: 'ctx' } },
      },
    }
  );
});

describe('testExamples resource declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('undeclared-resource-app', {
      undeclaredDbResource,
      undeclaredResourceTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples crossing coverage for trails with crossings', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('composition-app', {
      addTrail,
      onboardTrail,
      relateTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples resource mocks through cross', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('resource-cross-app', {
      crossDbResource,
      crossLeafTrail,
      crossRootTrail,
    } as Record<string, unknown>)
  );
});

// ---------------------------------------------------------------------------
// Nested cross chain: A → B → C
// ---------------------------------------------------------------------------

const leafTrail = trail('step.leaf', {
  blaze: (input: { value: string }) => Result.ok({ leaf: input.value }),
  description: 'Leaf trail in a nested chain',
  input: z.object({ value: z.string() }),
  output: z.object({ leaf: z.string() }),
});

const middleTrail = trail('step.middle', {
  blaze: async (input: { value: string }, ctx) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const leafResult = await ctx.cross<{ leaf: string }>('step.leaf', input);
    if (leafResult.isErr()) {
      return leafResult;
    }
    return Result.ok({ middle: leafResult.value.leaf });
  },
  crosses: ['step.leaf'],
  description: 'Middle trail that crosses the leaf',
  input: z.object({ value: z.string() }),
  output: z.object({ middle: z.string() }),
});

const rootTrail = trail('step.root', {
  blaze: async (input: { value: string }, ctx) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const midResult = await ctx.cross<{ middle: string }>('step.middle', input);
    if (midResult.isErr()) {
      return midResult;
    }
    return Result.ok({ root: midResult.value.middle });
  },
  crosses: ['step.middle'],
  description: 'Root trail that crosses the middle trail',
  examples: [
    {
      expected: { root: 'hello' },
      input: { value: 'hello' },
      name: 'Nested cross chain A→B→C',
    },
  ],
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
});

describe('testExamples nested cross chain (A → B → C)', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('nested-chain-app', {
      leafTrail,
      middleTrail,
      rootTrail,
    } as Record<string, unknown>)
  );
});

// ---------------------------------------------------------------------------
// Auto-minting permit tests (B3)
// ---------------------------------------------------------------------------

const scopedTrail = trail('scoped.trail', {
  blaze: (_input, ctx) => {
    // Verify the permit was auto-minted with declared scopes
    const permit = ctx.permit as
      | { id: string; scopes: readonly string[] }
      | undefined;
    if (!permit || !permit.scopes.includes('admin')) {
      return Result.err(new Error('Missing permit or scopes'));
    }
    return Result.ok({ ok: true });
  },
  description: 'Trail requiring admin scope',
  examples: [
    {
      expected: { ok: true },
      input: {},
      name: 'Runs with auto-minted permit',
    },
  ],
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['admin'] },
});

const publicTrail = trail('public.trail', {
  blaze: (_input, ctx) => {
    // Public trail should NOT get a permit
    if (ctx.permit !== undefined) {
      return Result.err(new Error('Unexpected permit on public trail'));
    }
    return Result.ok({ ok: true });
  },
  description: 'Public trail — no permit needed',
  examples: [
    {
      expected: { ok: true },
      input: {},
      name: 'Runs without a permit',
    },
  ],
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  permit: 'public',
});

describe('testExamples auto-minting permits', () => {
  describe('scoped trail gets auto-minted permit', () => {
    // eslint-disable-next-line jest/require-hook
    testExamples(
      topo('mint-scoped-app', {
        scopedTrail,
      } as Record<string, unknown>)
    );
  });

  describe('public trail does NOT get a permit', () => {
    // eslint-disable-next-line jest/require-hook
    testExamples(
      topo('mint-public-app', {
        publicTrail,
      } as Record<string, unknown>)
    );
  });

  describe('strictPermits skips auto-minting', () => {
    const strictScopedTrail = trail('strict.scoped', {
      blaze: (_input, ctx) =>
        Result.ok({ hasPermit: ctx.permit !== undefined }),
      description: 'Trail that expects no permit under strictPermits',
      examples: [
        {
          expected: { hasPermit: false },
          input: {},
          name: 'No auto-minted permit when strictPermits is true',
        },
      ],
      input: z.object({}),
      output: z.object({ hasPermit: z.boolean() }),
      permit: { scopes: ['admin'] },
    });

    // eslint-disable-next-line jest/require-hook
    testExamples(
      topo('strict-app', {
        strictScopedTrail,
      } as Record<string, unknown>),
      { strictPermits: true }
    );
  });
});
