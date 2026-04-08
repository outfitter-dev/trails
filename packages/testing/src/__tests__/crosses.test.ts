import { describe } from 'bun:test';

import type { AnyTrail, TrailContext } from '@ontrails/core';
import { InternalError, Result, resource, trail } from '@ontrails/core';
import { z } from 'zod';

import { testCrosses } from '../crosses.js';

// ---------------------------------------------------------------------------
// Test trails (trails with crossings)
// ---------------------------------------------------------------------------

const addTrail = trail('entity.add', {
  blaze: (input: { name: string }) => Result.ok({ id: '1', name: input.name }),
  description: 'Add an entity',
  examples: [
    { input: { name: 'Alpha' }, name: 'success' },
    {
      description: 'duplicate name',
      error: 'AlreadyExistsError',
      input: { name: '' },
      name: 'duplicate',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const relateTrail = trail('entity.relate', {
  blaze: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
  description: 'Relate two entities',
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
});

// ---------------------------------------------------------------------------
// Composition trail
// ---------------------------------------------------------------------------

const onboardTrail = trail('entity.onboard', {
  blaze: async (
    input: { name: string; relatedTo: string },
    ctx: TrailContext
  ) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const addResult = await ctx.cross<{ id: string; name: string }>(
      'entity.add',
      { name: input.name }
    );
    if (addResult.isErr()) {
      return Result.err(addResult.error);
    }

    const relateResult = await ctx.cross<{ from: string; to: string }>(
      'entity.relate',
      { from: addResult.value.name, to: input.relatedTo }
    );
    if (relateResult.isErr()) {
      return Result.err(relateResult.error);
    }

    return Result.ok({
      name: addResult.value.name,
      relatedTo: relateResult.value.to,
    });
  },
  crosses: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), relatedTo: z.string() }),
  output: z.object({ name: z.string(), relatedTo: z.string() }),
});

const trailsMap = new Map<string, AnyTrail>([
  ['entity.add', addTrail],
  ['entity.relate', relateTrail],
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const opts = { trails: trailsMap };

describe('testCrosses: expectOk', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    onboardTrail,
    [
      {
        description: 'basic onboard succeeds',
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testCrosses: expectCrossed', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    onboardTrail,
    [
      {
        description: 'crosses add then relate in order',
        expectCrossed: ['entity.add', 'entity.relate'],
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testCrosses: expectCrossedCount', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    onboardTrail,
    [
      {
        description: 'each trail crossed exactly once',
        expectCrossedCount: { 'entity.add': 1, 'entity.relate': 1 },
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testCrosses: injectFromExample', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    onboardTrail,
    [
      {
        description: 'inject duplicate error from add trail example',
        expectErr: Error,
        expectErrMessage: 'AlreadyExistsError',
        injectFromExample: { 'entity.add': 'duplicate' },
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testCrosses: expectValue', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    onboardTrail,
    [
      {
        description: 'exact value match',
        expectValue: { name: 'Alpha', relatedTo: 'Beta' },
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
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
  blaze: async (input: { value: string }, ctx: TrailContext) => {
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

const nestedRootTrail = trail('step.root', {
  blaze: async (input: { value: string }, ctx: TrailContext) => {
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
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
});

const nestedTrailsMap = new Map<string, AnyTrail>([
  ['step.leaf', leafTrail],
  ['step.middle', middleTrail],
]);

describe('testCrosses: nested cross chain (A → B → C)', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    nestedRootTrail,
    [
      {
        description: 'nested ctx.cross works through A → B → C',
        expectOk: true,
        expectValue: { root: 'hello' },
        input: { value: 'hello' },
      },
    ],
    { trails: nestedTrailsMap }
  );
});

const mockDbResource = resource('db.mock.crosses', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const provisionLeafTrail = trail('resource.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childSource: mockDbResource.from(ctx).source }),
  description: 'Leaf trail that reads from a resource',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  resources: [mockDbResource],
});

const provisionRootTrail = trail('resource.root', {
  blaze: async (_input, ctx: TrailContext) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }
    const childResult = await ctx.cross<{ childSource: string }>(
      'resource.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: mockDbResource.from(ctx).source,
    });
  },
  crosses: ['resource.leaf'],
  description:
    'Root trail that reads from a resource and crosses a child trail',
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  resources: [mockDbResource],
});

const provisionTrailsMap = new Map<string, AnyTrail>([
  ['resource.leaf', provisionLeafTrail],
]);

const statefulMockDbResource = resource('db.mock.crosses.stateful', {
  create: () => Result.ok({ count: 0 }),
  mock: () => ({ count: 0 }),
});

const statefulResourceLeafTrail = trail('resource.stateful.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childCount: statefulMockDbResource.from(ctx).count }),
  description: 'Leaf trail that observes the current mock resource state',
  input: z.object({}),
  output: z.object({ childCount: z.number() }),
  resources: [statefulMockDbResource],
});

const statefulResourceRootTrail = trail('resource.stateful.root', {
  blaze: async (_input, ctx: TrailContext) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }

    const statefulResource = statefulMockDbResource.from(ctx);
    statefulResource.count += 1;

    const childResult = await ctx.cross<{ childCount: number }>(
      'resource.stateful.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childCount: childResult.value.childCount,
      rootCount: statefulResource.count,
    });
  },
  crosses: ['resource.stateful.leaf'],
  description:
    'Root trail that mutates a mocked resource and crosses a child trail',
  input: z.object({}),
  output: z.object({ childCount: z.number(), rootCount: z.number() }),
  resources: [statefulMockDbResource],
});

const statefulResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.stateful.leaf', statefulResourceLeafTrail],
]);

const scenarioStateResource = resource('db.mock.scenarios', {
  create: () => Result.ok({ count: 0 }),
  mock: () => ({ count: 0 }),
});

const scenarioLeafTrail = trail('resource.scenario.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ count: scenarioStateResource.from(ctx).count }),
  description: 'Leaf trail that reads mutable scenario state',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  resources: [scenarioStateResource],
});

const scenarioRootTrail = trail('resource.scenario.root', {
  blaze: async (_input, ctx: TrailContext) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }

    const state = scenarioStateResource.from(ctx);
    state.count += 1;

    const leafResult = await ctx.cross<{ count: number }>(
      'resource.scenario.leaf',
      {}
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ count: leafResult.value.count });
  },
  crosses: ['resource.scenario.leaf'],
  description: 'Root trail that mutates scenario state and crosses a leaf',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  resources: [scenarioStateResource],
});

const scenarioResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.scenario.leaf', scenarioLeafTrail],
]);

const transformedCrossLeafTrail = trail('cross.transformed.leaf', {
  blaze: (input: { value: number }) => Result.ok({ value: input.value }),
  description: 'Leaf trail in a transformed cross chain',
  input: z.object({ value: z.number() }),
  output: z.object({ value: z.number() }),
});

const transformedCrossRootTrail = trail('cross.transformed.root', {
  blaze: async (input: { value: number }, ctx: TrailContext) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }

    const leafResult = await ctx.cross<{ value: number }>(
      'cross.transformed.leaf',
      { value: input.value }
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ root: leafResult.value.value });
  },
  crosses: ['cross.transformed.leaf'],
  description: 'Root trail that transforms input once before crossing',
  input: z
    .object({ value: z.string() })
    .transform(({ value }) => ({ value: Number(value) + 1 })),
  output: z.object({ root: z.number() }),
});

const transformedCrossTrailsMap = new Map<string, AnyTrail>([
  ['cross.transformed.leaf', transformedCrossLeafTrail],
]);

const undeclaredCrossResource = resource('db.undeclared.crosses', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredResourceLeafTrail = trail('resource.undeclared.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childSource: undeclaredCrossResource.from(ctx).source }),
  description: 'Leaf trail that declares the shared resource',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  resources: [undeclaredCrossResource],
});

const undeclaredResourceRootTrail = trail('resource.undeclared.root', {
  blaze: async (_input, ctx: TrailContext) => {
    if (!ctx.cross) {
      return Result.err(new Error('cross not available'));
    }

    const childResult = await ctx.cross<{ childSource: string }>(
      'resource.undeclared.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: undeclaredCrossResource.from(ctx).source,
    });
  },
  crosses: ['resource.undeclared.leaf'],
  description: 'Root trail that uses a resource without declaring it',
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
});

const undeclaredResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.undeclared.leaf', undeclaredResourceLeafTrail],
]);

const unrelatedCrossResource = resource('db.unrelated.crosses', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => {
    throw new Error('unrelated mock should not be resolved');
  },
});

const unrelatedResourceTrail = trail('resource.unrelated', {
  blaze: (_input, ctx) =>
    Result.ok({ source: unrelatedCrossResource.from(ctx).source }),
  description: 'Trail that should not be traversed or mocked',
  input: z.object({}),
  output: z.object({ source: z.string() }),
  resources: [unrelatedCrossResource],
});

const unrelatedResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.unrelated', unrelatedResourceTrail],
]);

describe('testCrosses resource mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    provisionRootTrail,
    [
      {
        description: 'propagates auto-resolved resource mocks through cross',
        expectValue: { childSource: 'mock', rootSource: 'mock' },
        input: {},
      },
    ],
    { trails: provisionTrailsMap }
  );
});

describe('testCrosses resource mocks are fresh per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    scenarioRootTrail,
    [
      {
        description: 'first scenario sees a fresh mutable resource',
        expectValue: { count: 1 },
        input: {},
      },
      {
        description: 'second scenario also sees a fresh mutable resource',
        expectValue: { count: 1 },
        input: {},
      },
    ],
    { trails: scenarioResourceTrailsMap }
  );
});

describe('testCrosses explicit resource overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    provisionRootTrail,
    [
      {
        description: 'propagates explicit resource overrides through cross',
        expectValue: { childSource: 'override', rootSource: 'override' },
        input: {},
      },
    ],
    {
      resources: { 'db.mock.crosses': { source: 'override' } },
      trails: provisionTrailsMap,
    }
  );
});

describe('testCrosses raw transformed input', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    transformedCrossRootTrail,
    [
      {
        description: 'raw scenario input is only transformed once',
        expectValue: { root: 2 },
        input: { value: '1' },
      },
    ],
    { trails: transformedCrossTrailsMap }
  );
});

describe('testCrosses resource declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    undeclaredResourceRootTrail,
    [
      {
        description: 'fails when the root trail omits a required resource',
        expectErr: InternalError,
        expectErrMessage: undeclaredCrossResource.id,
        input: {},
      },
    ],
    { trails: undeclaredResourceTrailsMap }
  );
});

describe('testCrosses only resolves mocks for trails under test', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    provisionRootTrail,
    [
      {
        description: 'unrelated resource mocks are not resolved',
        expectValue: { childSource: 'mock', rootSource: 'mock' },
        input: {},
      },
    ],
    {
      trails: new Map<string, AnyTrail>([
        ...provisionTrailsMap.entries(),
        ...unrelatedResourceTrailsMap.entries(),
      ]),
    }
  );
});

describe('testCrosses fresh resource mocks per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testCrosses(
    statefulResourceRootTrail,
    [
      {
        description: 'first scenario gets a fresh resource mock',
        expectValue: { childCount: 1, rootCount: 1 },
        input: {},
      },
      {
        description: 'second scenario also gets a fresh resource mock',
        expectValue: { childCount: 1, rootCount: 1 },
        input: {},
      },
    ],
    { trails: statefulResourceTrailsMap }
  );
});
