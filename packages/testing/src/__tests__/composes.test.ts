import { describe } from 'bun:test';

import type { AnyTrail, TrailContext } from '@ontrails/core';
import { InternalError, Result, resource, trail } from '@ontrails/core';
import { z } from 'zod';

import { testComposes } from '../composes.js';

// ---------------------------------------------------------------------------
// Test trails (trails with compositions)
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
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const addResult = await ctx.compose<{ id: string; name: string }>(
      'entity.add',
      { name: input.name }
    );
    if (addResult.isErr()) {
      return Result.err(addResult.error);
    }

    const relateResult = await ctx.compose<{ from: string; to: string }>(
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
  composes: ['entity.add', 'entity.relate'],
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

describe('testComposes: expectOk', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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

describe('testComposes: expectComposed', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    onboardTrail,
    [
      {
        description: 'composes add then relate in order',
        expectComposed: ['entity.add', 'entity.relate'],
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testComposes: expectComposedCount', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    onboardTrail,
    [
      {
        description: 'each trail composed exactly once',
        expectComposedCount: { 'entity.add': 1, 'entity.relate': 1 },
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testComposes: injectFromExample', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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

describe('testComposes: expectValue', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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
// Nested compose chain: A → B → C
// ---------------------------------------------------------------------------

const leafTrail = trail('step.leaf', {
  blaze: (input: { value: string }) => Result.ok({ leaf: input.value }),
  description: 'Leaf trail in a nested chain',
  input: z.object({ value: z.string() }),
  output: z.object({ leaf: z.string() }),
});

const middleTrail = trail('step.middle', {
  blaze: async (input: { value: string }, ctx: TrailContext) => {
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

const nestedRootTrail = trail('step.root', {
  blaze: async (input: { value: string }, ctx: TrailContext) => {
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
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
});

const nestedTrailsMap = new Map<string, AnyTrail>([
  ['step.leaf', leafTrail],
  ['step.middle', middleTrail],
]);

describe('testComposes: nested compose chain (A → B → C)', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    nestedRootTrail,
    [
      {
        description: 'nested ctx.compose works through A → B → C',
        expectOk: true,
        expectValue: { root: 'hello' },
        input: { value: 'hello' },
      },
    ],
    { trails: nestedTrailsMap }
  );
});

const mockDbResource = resource('db.mock.composes', {
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
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }
    const childResult = await ctx.compose<{ childSource: string }>(
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
  composes: ['resource.leaf'],
  description:
    'Root trail that reads from a resource and composes a child trail',
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  resources: [mockDbResource],
});

const provisionTrailsMap = new Map<string, AnyTrail>([
  ['resource.leaf', provisionLeafTrail],
]);

const statefulMockDbResource = resource('db.mock.composes.stateful', {
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
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }

    const statefulResource = statefulMockDbResource.from(ctx);
    statefulResource.count += 1;

    const childResult = await ctx.compose<{ childCount: number }>(
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
  composes: ['resource.stateful.leaf'],
  description:
    'Root trail that mutates a mocked resource and composes a child trail',
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
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }

    const state = scenarioStateResource.from(ctx);
    state.count += 1;

    const leafResult = await ctx.compose<{ count: number }>(
      'resource.scenario.leaf',
      {}
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ count: leafResult.value.count });
  },
  composes: ['resource.scenario.leaf'],
  description: 'Root trail that mutates scenario state and composes a leaf',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  resources: [scenarioStateResource],
});

const scenarioResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.scenario.leaf', scenarioLeafTrail],
]);

const transformedComposeLeafTrail = trail('compose.transformed.leaf', {
  blaze: (input: { value: number }) => Result.ok({ value: input.value }),
  description: 'Leaf trail in a transformed compose chain',
  input: z.object({ value: z.number() }),
  output: z.object({ value: z.number() }),
});

const transformedComposeRootTrail = trail('compose.transformed.root', {
  blaze: async (input: { value: number }, ctx: TrailContext) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }

    const leafResult = await ctx.compose<{ value: number }>(
      'compose.transformed.leaf',
      { value: input.value }
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ root: leafResult.value.value });
  },
  composes: ['compose.transformed.leaf'],
  description: 'Root trail that transforms input once before composing',
  input: z
    .object({ value: z.string() })
    .transform(({ value }) => ({ value: Number(value) + 1 })),
  output: z.object({ root: z.number() }),
});

const transformedComposeTrailsMap = new Map<string, AnyTrail>([
  ['compose.transformed.leaf', transformedComposeLeafTrail],
]);

const undeclaredComposeResource = resource('db.undeclared.composes', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredResourceLeafTrail = trail('resource.undeclared.leaf', {
  blaze: (_input, ctx) =>
    Result.ok({ childSource: undeclaredComposeResource.from(ctx).source }),
  description: 'Leaf trail that declares the shared resource',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  resources: [undeclaredComposeResource],
});

const undeclaredResourceRootTrail = trail('resource.undeclared.root', {
  blaze: async (_input, ctx: TrailContext) => {
    if (!ctx.compose) {
      return Result.err(new Error('compose not available'));
    }

    const childResult = await ctx.compose<{ childSource: string }>(
      'resource.undeclared.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: undeclaredComposeResource.from(ctx).source,
    });
  },
  composes: ['resource.undeclared.leaf'],
  description: 'Root trail that uses a resource without declaring it',
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
});

const undeclaredResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.undeclared.leaf', undeclaredResourceLeafTrail],
]);

const unrelatedComposeResource = resource('db.unrelated.composes', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => {
    throw new Error('unrelated mock should not be resolved');
  },
});

const unrelatedResourceTrail = trail('resource.unrelated', {
  blaze: (_input, ctx) =>
    Result.ok({ source: unrelatedComposeResource.from(ctx).source }),
  description: 'Trail that should not be traversed or mocked',
  input: z.object({}),
  output: z.object({ source: z.string() }),
  resources: [unrelatedComposeResource],
});

const unrelatedResourceTrailsMap = new Map<string, AnyTrail>([
  ['resource.unrelated', unrelatedResourceTrail],
]);

describe('testComposes resource mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    provisionRootTrail,
    [
      {
        description: 'propagates auto-resolved resource mocks through compose',
        expectValue: { childSource: 'mock', rootSource: 'mock' },
        input: {},
      },
    ],
    { trails: provisionTrailsMap }
  );
});

describe('testComposes resource mocks are fresh per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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

describe('testComposes explicit resource overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    provisionRootTrail,
    [
      {
        description: 'propagates explicit resource overrides through compose',
        expectValue: { childSource: 'override', rootSource: 'override' },
        input: {},
      },
    ],
    {
      resources: { 'db.mock.composes': { source: 'override' } },
      trails: provisionTrailsMap,
    }
  );
});

describe('testComposes raw transformed input', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    transformedComposeRootTrail,
    [
      {
        description: 'raw scenario input is only transformed once',
        expectValue: { root: 2 },
        input: { value: '1' },
      },
    ],
    { trails: transformedComposeTrailsMap }
  );
});

describe('testComposes resource declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
    undeclaredResourceRootTrail,
    [
      {
        description: 'fails when the root trail omits a required resource',
        expectErr: InternalError,
        expectErrMessage: undeclaredComposeResource.id,
        input: {},
      },
    ],
    { trails: undeclaredResourceTrailsMap }
  );
});

describe('testComposes only resolves mocks for trails under test', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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

describe('testComposes fresh resource mocks per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testComposes(
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
