import { describe, test } from 'bun:test';

import { NotFoundError, Result, service, trail, topo } from '@ontrails/core';
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
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  run: (input: { name: string }) =>
    Result.ok({ greeting: `Hello, ${input.name}` }),
});

const searchTrail = trail('search', {
  description: 'Search for things',
  examples: [
    {
      input: { query: 'test' },
      name: 'Schema-only search',
    },
  ],
  input: z.object({ query: z.string() }),
  output: z.object({ results: z.array(z.string()) }),
  run: (input: { query: string }) =>
    Result.ok({ results: [`result for ${input.query}`] }),
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
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
  run: (input: { name: string }) => {
    if (input.name === 'missing') {
      return Result.err(new NotFoundError('Entity not found'));
    }
    return Result.ok({ id: 1, name: input.name });
  },
});

const noExamplesTrail = trail('noexamples', {
  input: z.object({ x: z.number() }),
  run: (input: { x: number }) => Result.ok(input.x * 2),
});

const mockDbService = service('db.mock.examples', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const mockServiceTrail = trail('service.mocked', {
  description: 'Trail that reads from a mocked service',
  examples: [
    {
      expected: { source: 'mock' },
      input: {},
      name: 'Uses auto-resolved service mock',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  run: (_input, ctx) => Result.ok({ source: mockDbService.from(ctx).source }),
  services: [mockDbService],
});

const explicitOverrideTrail = trail('service.override', {
  description: 'Trail whose service mock can be overridden explicitly',
  examples: [
    {
      expected: { source: 'override' },
      input: {},
      name: 'Explicit service override wins over mock factory',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  run: (_input, ctx) => Result.ok({ source: mockDbService.from(ctx).source }),
  services: [mockDbService],
});

const transformedInputTrail = trail('example.transformed', {
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
  run: (input: { value: number }) => Result.ok({ value: input.value }),
});

const ctxOverrideTrail = trail('service.ctx-override', {
  description: 'Trail whose service mock can be overridden by ctx.extensions',
  examples: [
    {
      expected: { source: 'ctx' },
      input: {},
      name: 'Context extensions beat auto-resolved mock services',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  run: (_input, ctx) => Result.ok({ source: mockDbService.from(ctx).source }),
  services: [mockDbService],
});

const undeclaredDbService = service('db.undeclared.examples', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredServiceTrail = trail('service.undeclared.examples', {
  description: 'Trail that uses a service without declaring it',
  examples: [
    {
      error: 'InternalError',
      input: {},
      name: 'Undeclared services stay unavailable during example execution',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  run: (_input, ctx) =>
    Result.ok({ source: undeclaredDbService.from(ctx).source }),
});
const followedDbService = service('db.mock.examples.follow', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const followedLeafTrail = trail('service.follow.leaf', {
  description: 'Leaf trail that resolves a service inside a follow chain',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  run: (_input, ctx) =>
    Result.ok({ childSource: followedDbService.from(ctx).source }),
  services: [followedDbService],
});

const followedRootTrail = trail('service.follow.root', {
  description: 'Root trail that follows a child trail using services',
  examples: [
    {
      expected: { childSource: 'mock', rootSource: 'mock' },
      input: {},
      name: 'Propagates service mocks through follow execution',
    },
  ],
  follow: ['service.follow.leaf'],
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  run: async (_input, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const childResult = await ctx.follow<{ childSource: string }>(
      'service.follow.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }
    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: followedDbService.from(ctx).source,
    });
  },
  services: [followedDbService],
});

// ---------------------------------------------------------------------------
// Composition trails (for follow coverage)
// ---------------------------------------------------------------------------

const addTrail = trail('entity.add', {
  description: 'Add an entity',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  run: (input: { name: string }) => Result.ok({ id: '1', name: input.name }),
});

const relateTrail = trail('entity.relate', {
  description: 'Relate entities',
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
  run: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
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
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  run: async (input: { name: string }, ctx) => {
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

describe('testExamples service mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('service-mock-app', {
      mockDbService,
      mockServiceTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples explicit service overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('service-override-app', {
      explicitOverrideTrail,
      mockDbService,
    } as Record<string, unknown>),
    {
      services: { 'db.mock.examples': { source: 'override' } },
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
      mockDbService,
    } as Record<string, unknown>),
    {
      ctx: {
        extensions: { 'db.mock.examples': { source: 'ctx' } },
      },
    }
  );
});

describe('testExamples service declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('undeclared-service-app', {
      undeclaredDbService,
      undeclaredServiceTrail,
    } as Record<string, unknown>)
  );
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

describe('testExamples service mocks through follow', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('service-follow-app', {
      followedDbService,
      followedLeafTrail,
      followedRootTrail,
    } as Record<string, unknown>)
  );
});

// ---------------------------------------------------------------------------
// Nested follow chain: A → B → C
// ---------------------------------------------------------------------------

const leafTrail = trail('step.leaf', {
  description: 'Leaf trail in a nested chain',
  input: z.object({ value: z.string() }),
  output: z.object({ leaf: z.string() }),
  run: (input: { value: string }) => Result.ok({ leaf: input.value }),
});

const middleTrail = trail('step.middle', {
  description: 'Middle trail that follows the leaf',
  follow: ['step.leaf'],
  input: z.object({ value: z.string() }),
  output: z.object({ middle: z.string() }),
  run: async (input: { value: string }, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const leafResult = await ctx.follow<{ leaf: string }>('step.leaf', input);
    if (leafResult.isErr()) {
      return leafResult;
    }
    return Result.ok({ middle: leafResult.value.leaf });
  },
});

const rootTrail = trail('step.root', {
  description: 'Root trail that follows the middle trail',
  examples: [
    {
      expected: { root: 'hello' },
      input: { value: 'hello' },
      name: 'Nested follow chain A→B→C',
    },
  ],
  follow: ['step.middle'],
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
  run: async (input: { value: string }, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const midResult = await ctx.follow<{ middle: string }>(
      'step.middle',
      input
    );
    if (midResult.isErr()) {
      return midResult;
    }
    return Result.ok({ root: midResult.value.middle });
  },
});

describe('testExamples nested follow chain (A → B → C)', () => {
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
  run: (_input, ctx) => {
    // Verify the permit was auto-minted with declared scopes
    const permit = ctx.permit as
      | { id: string; scopes: readonly string[] }
      | undefined;
    if (!permit || !permit.scopes.includes('admin')) {
      return Result.err(new Error('Missing permit or scopes'));
    }
    return Result.ok({ ok: true });
  },
});

const publicTrail = trail('public.trail', {
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
  run: (_input, ctx) => {
    // Public trail should NOT get a permit
    if (ctx.permit !== undefined) {
      return Result.err(new Error('Unexpected permit on public trail'));
    }
    return Result.ok({ ok: true });
  },
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
      run: (_input, ctx) => Result.ok({ hasPermit: ctx.permit !== undefined }),
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
