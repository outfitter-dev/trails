import { afterAll, describe, expect, mock, test } from 'bun:test';

import {
  ConflictError,
  contour,
  DerivationError,
  NotFoundError,
  Result,
  RetryExhaustedError,
  resource,
  signal,
  trail,
  topo,
} from '@ontrails/core';
import { z } from 'zod';

import { createTestContext } from '../context.js';
import { runExample, testExamples } from '../examples.js';

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

const taxonomyErrorTrail = trail('taxonomy.errors', {
  blaze: (input: { type: 'derivation' | 'retry' }) => {
    if (input.type === 'derivation') {
      return Result.err(new DerivationError('could not derive projection'));
    }
    return Result.err(
      new RetryExhaustedError(new ConflictError('version mismatch'), {
        attempts: 3,
        detour: 'ConflictError',
      })
    );
  },
  examples: [
    {
      error: 'DerivationError',
      input: { type: 'derivation' },
      name: 'Derivation failure returns DerivationError',
    },
    {
      error: 'RetryExhaustedError',
      input: { type: 'retry' },
      name: 'Exhausted detour returns RetryExhaustedError',
    },
  ],
  input: z.object({ type: z.enum(['derivation', 'retry']) }),
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
const composeDbResource = resource('db.mock.examples.composes', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const composeLeafTrail = trail('resource.composes.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childSource: composeDbResource.from(ctx).source }),
  description: 'Leaf trail that resolves a resource inside a compose chain',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  resources: [composeDbResource],
});

const composeRootTrail = trail('resource.composes.root', {
  blaze: async (_input, ctx) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const childResult = await ctx.compose<{ childSource: string }>(
      'resource.composes.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }
    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: composeDbResource.from(ctx).source,
    });
  },
  composes: ['resource.composes.leaf'],
  description: 'Root trail that composes a child trail using resources',
  examples: [
    {
      expected: { childSource: 'mock', rootSource: 'mock' },
      input: {},
      name: 'Propagates resource mocks through compose execution',
    },
  ],
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  resources: [composeDbResource],
});

// ---------------------------------------------------------------------------
// Composition trails (for compose coverage)
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
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const addResult = await ctx.compose('entity.add', input);
    if (addResult.isErr()) {
      return addResult;
    }
    const relateResult = await ctx.compose('entity.relate', {
      from: 'root',
      to: (addResult.value as { id: string }).id,
    });
    if (relateResult.isErr()) {
      return relateResult;
    }
    return Result.ok({ id: '1', name: input.name });
  },
  composes: ['entity.add', 'entity.relate'],
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

const profileUpdated = signal('profile.updated', {
  payload: z.object({
    displayName: z.string(),
    id: z.string(),
    revision: z.number(),
  }),
});

const profileUpdateTrail = trail('profile.update', {
  blaze: async (input: { displayName: string; id: string }, ctx) => {
    await ctx.fire?.(profileUpdated, {
      displayName: input.displayName,
      id: input.id,
      revision: 2,
    });
    return Result.ok({ ok: true });
  },
  examples: [
    {
      expected: { ok: true },
      input: { displayName: 'Ada', id: 'u1' },
      name: 'Updates profile and fires a typed signal',
      signals: [
        {
          payloadMatch: { id: 'u1', revision: 2 },
          signal: profileUpdated,
        },
      ],
    },
  ],
  fires: [profileUpdated],
  input: z.object({ displayName: z.string(), id: z.string() }),
  output: z.object({ ok: z.boolean() }),
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
      taxonomyErrorTrail,
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

describe('testExamples composing coverage for trails with compositions', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('composition-app', {
      addTrail,
      onboardTrail,
      relateTrail,
    } as Record<string, unknown>)
  );
});

describe('testExamples signal assertions', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('signal-assertion-app', {
      profileUpdateTrail,
      profileUpdated,
    } as Record<string, unknown>)
  );

  test('asserts signals on expected input validation failures', async () => {
    let message = '';
    try {
      await runExample(
        profileUpdateTrail,
        {
          error: 'ValidationError',
          input: { displayName: 123, id: 'u1' },
          name: 'Invalid profile update still checks signal expectations',
          signals: [
            {
              payloadMatch: { id: 'u1' },
              signal: profileUpdated,
            },
          ],
        },
        profileUpdateTrail.output,
        createTestContext()
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(
      /^Example "Invalid profile update still checks signal expectations" expected signal signal=profile\.updated payloadMatchSummary=\{redacted=true shape=object digest=/
    );
    expect(message).toContain('topLevelEntryCount=1');
    expect(message).not.toContain('"u1"');
  });
});

describe('testExamples resource mocks through compose', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('resource-compose-app', {
      composeDbResource,
      composeLeafTrail,
      composeRootTrail,
    } as Record<string, unknown>)
  );
});

const versionExampleCurrentBlaze = mock((input: { name: string }) =>
  Result.ok({ message: `current:${input.name}` })
);
const versionExampleForkBlaze = mock((input: { code: string }) =>
  Result.ok({ message: `fork:${input.code}` })
);
const versionedExampleTrail = trail('version.examples', {
  blaze: (input: { name: string }) => versionExampleCurrentBlaze(input),
  examples: [
    {
      expected: { message: 'current:Ada' },
      input: { name: 'Ada' },
      name: 'Current example',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  version: 5,
  versions: {
    1: {
      examples: [
        {
          expected: { message: 'legacy:Ada' },
          input: { legacyName: 'Ada' },
          name: 'Revision example',
        },
      ],
      input: z.object({ legacyName: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => ({ name: input.legacyName }),
        output: ({ output }) => ({
          message: output.message.replace('current:', 'legacy:'),
        }),
      },
    },
    2: {
      blaze: (input: { code: string }) => versionExampleForkBlaze(input),
      examples: [
        {
          expected: { message: 'fork:beta' },
          input: { code: 'beta' },
          name: 'Deprecated fork example',
        },
      ],
      input: z.object({ code: z.string() }),
      output: z.object({ message: z.string() }),
      status: { note: 'Use the current version.', state: 'deprecated' },
    },
    4: {
      examples: [
        {
          expected: { message: 'archived should not run' },
          input: { archived: true },
          name: 'Archived example',
        },
      ],
      input: z.object({ archived: z.boolean() }),
      output: z.object({ message: z.string() }),
      status: { state: 'archived' },
      transpose: {
        input: () => ({ name: 'archived' }),
        output: ({ output }) => output,
      },
    },
  },
});

describe('testExamples runs current plus live version-entry examples', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(topo('version-examples-app', { versionedExampleTrail }));

  afterAll(() => {
    expect(versionExampleCurrentBlaze).toHaveBeenCalledTimes(2);
    expect(versionExampleForkBlaze).toHaveBeenCalledTimes(1);
  });
});

const batchVersionChildBlaze = mock((input: { name: string }) =>
  Result.ok({ message: `batch:${input.name}` })
);
const batchVersionChildTrail = trail('version.examples.batch.child', {
  blaze: (input: { name: string }) => batchVersionChildBlaze(input),
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  version: 2,
  versions: {
    1: {
      input: z.object({ legacyName: z.string() }),
      output: z.object({ message: z.string() }),
      transpose: {
        input: ({ input }) => ({ name: input.legacyName }),
        output: ({ output }) => output,
      },
    },
  },
});
const batchVersionParentTrail = trail('version.examples.batch.parent', {
  blaze: async (_input, ctx) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const [child] = await ctx.compose([
      ['version.examples.batch.child@1', { legacyName: 'Ada' }],
    ]);
    if (child === undefined) {
      return Result.err(new Error('batch compose returned no result'));
    }
    if (child.isErr()) {
      return child;
    }
    return Result.ok(child.value as { message: string });
  },
  composes: [batchVersionChildTrail],
  examples: [
    {
      expected: { message: 'batch:Ada' },
      input: {},
      name: 'Batch compose resolves inline version reference',
    },
  ],
  input: z.object({}),
  output: z.object({ message: z.string() }),
});

describe('testExamples resolves inline version references through batch compose', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('version-examples-batch-compose-app', {
      batchVersionChildTrail,
      batchVersionParentTrail,
    })
  );

  afterAll(() => {
    expect(batchVersionChildBlaze).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Nested compose chain: A → B → C
// ---------------------------------------------------------------------------

const leafTrail = trail('step.leaf', {
  blaze: (input: { value: string }) => Result.ok({ leaf: input.value }),
  description: 'Leaf trail in a nested chain',
  input: z.object({ value: z.string() }),
  output: z.object({ leaf: z.string() }),
});

const middleTrail = trail('step.middle', {
  blaze: async (input: { value: string }, ctx) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const leafResult = await ctx.compose<{ leaf: string }>('step.leaf', input);
    if (leafResult.isErr()) {
      return leafResult;
    }
    return Result.ok({ middle: leafResult.value.leaf });
  },
  composes: ['step.leaf'],
  description: 'Middle trail that composes the leaf',
  input: z.object({ value: z.string() }),
  output: z.object({ middle: z.string() }),
});

const rootTrail = trail('step.root', {
  blaze: async (input: { value: string }, ctx) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const midResult = await ctx.compose<{ middle: string }>(
      'step.middle',
      input
    );
    if (midResult.isErr()) {
      return midResult;
    }
    return Result.ok({ root: midResult.value.middle });
  },
  composes: ['step.middle'],
  description: 'Root trail that composes the middle trail',
  examples: [
    {
      expected: { root: 'hello' },
      input: { value: 'hello' },
      name: 'Nested compose chain A→B→C',
    },
  ],
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
});

describe('testExamples nested compose chain (A → B → C)', () => {
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
      description: 'Trail that requires an explicit permit under strictPermits',
      examples: [
        {
          error: 'PermitError',
          input: {},
          name: 'Fails without an explicit permit when strictPermits is true',
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

// ---------------------------------------------------------------------------
// Derived-fixture composing coverage regression
// ---------------------------------------------------------------------------
//
// A composition trail whose only examples come from contour-derived
// fixtures must not fail composing-coverage — derived inputs are not
// guaranteed to exercise every declared compose.

const itemContour = contour(
  'item',
  {
    id: z.string(),
    name: z.string(),
  },
  {
    examples: [{ id: 'abc', name: 'Widget' }],
    identity: 'id',
  }
);

const helperTrail = trail('derived.helper', {
  blaze: (input: { id: string }) => Result.ok({ id: input.id, ok: true }),
  description: 'Helper referenced by a conditional compose',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string(), ok: z.boolean() }),
});

const conditionalComposeTrail = trail('derived.conditional', {
  blaze: async (input: { id: string; name: string }, ctx) => {
    // The conditional compose is never taken for derived fixtures because
    // `shouldCompose` is always false in the synthesized input. This is
    // exactly the case the provenance gate exists to protect: if we
    // asserted composing coverage against derived examples, this trail
    // would fail even though its declaration is accurate for authored
    // use.
    const { shouldCompose } = input as { shouldCompose?: boolean };
    if (shouldCompose && ctx.compose) {
      const result = await ctx.compose<{ id: string; ok: boolean }>(
        'derived.helper',
        { id: input.id }
      );
      if (result.isErr()) {
        return result;
      }
    }
    return Result.ok({ id: input.id, name: input.name });
  },
  composes: ['derived.helper'],
  contours: [itemContour],
  description: 'Composition trail with a compose that derived fixtures skip',
  input: z.object({ id: z.string(), name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

describe('testExamples derived-fixture composing coverage is gated', () => {
  // eslint-disable-next-line jest/require-hook
  testExamples(
    topo('derived-coverage-app', {
      conditionalComposeTrail,
      helperTrail,
    } as Record<string, unknown>)
  );
});
