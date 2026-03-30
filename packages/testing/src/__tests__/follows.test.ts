import { describe } from 'bun:test';

import type { AnyTrail, TrailContext } from '@ontrails/core';
import { InternalError, Result, service, trail } from '@ontrails/core';
import { z } from 'zod';

import { testFollows } from '../follows.js';

// ---------------------------------------------------------------------------
// Test trails (followed by composition trail)
// ---------------------------------------------------------------------------

const addTrail = trail('entity.add', {
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
  run: (input: { name: string }) => Result.ok({ id: '1', name: input.name }),
});

const relateTrail = trail('entity.relate', {
  description: 'Relate two entities',
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
  run: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
});

// ---------------------------------------------------------------------------
// Composition trail
// ---------------------------------------------------------------------------

const onboardTrail = trail('entity.onboard', {
  follow: ['entity.add', 'entity.relate'],
  input: z.object({ name: z.string(), relatedTo: z.string() }),
  output: z.object({ name: z.string(), relatedTo: z.string() }),
  run: async (
    input: { name: string; relatedTo: string },
    ctx: TrailContext
  ) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const addResult = await ctx.follow<{ id: string; name: string }>(
      'entity.add',
      { name: input.name }
    );
    if (addResult.isErr()) {
      return Result.err(addResult.error);
    }

    const relateResult = await ctx.follow<{ from: string; to: string }>(
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
});

const trailsMap = new Map<string, AnyTrail>([
  ['entity.add', addTrail],
  ['entity.relate', relateTrail],
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const opts = { trails: trailsMap };

describe('testFollows: expectOk', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
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

describe('testFollows: expectFollowed', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    onboardTrail,
    [
      {
        description: 'follows add then relate in order',
        expectFollowed: ['entity.add', 'entity.relate'],
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testFollows: expectFollowedCount', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    onboardTrail,
    [
      {
        description: 'each trail followed exactly once',
        expectFollowedCount: { 'entity.add': 1, 'entity.relate': 1 },
        expectOk: true,
        input: { name: 'Alpha', relatedTo: 'Beta' },
      },
    ],
    opts
  );
});

describe('testFollows: injectFromExample', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
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

describe('testFollows: expectValue', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
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
  run: async (input: { value: string }, ctx: TrailContext) => {
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

const nestedRootTrail = trail('step.root', {
  description: 'Root trail that follows the middle trail',
  follow: ['step.middle'],
  input: z.object({ value: z.string() }),
  output: z.object({ root: z.string() }),
  run: async (input: { value: string }, ctx: TrailContext) => {
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

const nestedTrailsMap = new Map<string, AnyTrail>([
  ['step.leaf', leafTrail],
  ['step.middle', middleTrail],
]);

describe('testFollows: nested follow chain (A → B → C)', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    nestedRootTrail,
    [
      {
        description: 'nested ctx.follow works through A → B → C',
        expectOk: true,
        expectValue: { root: 'hello' },
        input: { value: 'hello' },
      },
    ],
    { trails: nestedTrailsMap }
  );
});

const mockDbService = service('db.mock.follows', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const serviceLeafTrail = trail('service.leaf', {
  description: 'Leaf trail that reads from a service',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  run: (_input, ctx) =>
    Result.ok({ childSource: mockDbService.from(ctx).source }),
  services: [mockDbService],
});

const serviceRootTrail = trail('service.root', {
  description: 'Root trail that reads from a service and follows a child trail',
  follow: ['service.leaf'],
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  run: async (_input, ctx: TrailContext) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }
    const childResult = await ctx.follow<{ childSource: string }>(
      'service.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: mockDbService.from(ctx).source,
    });
  },
  services: [mockDbService],
});

const serviceTrailsMap = new Map<string, AnyTrail>([
  ['service.leaf', serviceLeafTrail],
]);

const statefulMockDbService = service('db.mock.follows.stateful', {
  create: () => Result.ok({ count: 0 }),
  mock: () => ({ count: 0 }),
});

const statefulServiceLeafTrail = trail('service.stateful.leaf', {
  description: 'Leaf trail that observes the current mock service state',
  input: z.object({}),
  output: z.object({ childCount: z.number() }),
  run: (_input, ctx) =>
    Result.ok({ childCount: statefulMockDbService.from(ctx).count }),
  services: [statefulMockDbService],
});

const statefulServiceRootTrail = trail('service.stateful.root', {
  description:
    'Root trail that mutates a mocked service and follows a child trail',
  follow: ['service.stateful.leaf'],
  input: z.object({}),
  output: z.object({ childCount: z.number(), rootCount: z.number() }),
  run: async (_input, ctx: TrailContext) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }

    const statefulService = statefulMockDbService.from(ctx);
    statefulService.count += 1;

    const childResult = await ctx.follow<{ childCount: number }>(
      'service.stateful.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childCount: childResult.value.childCount,
      rootCount: statefulService.count,
    });
  },
  services: [statefulMockDbService],
});

const statefulServiceTrailsMap = new Map<string, AnyTrail>([
  ['service.stateful.leaf', statefulServiceLeafTrail],
]);

const scenarioStateService = service('db.mock.scenarios', {
  create: () => Result.ok({ count: 0 }),
  mock: () => ({ count: 0 }),
});

const scenarioLeafTrail = trail('service.scenario.leaf', {
  description: 'Leaf trail that reads mutable scenario state',
  input: z.object({}),
  output: z.object({ count: z.number() }),
  run: (_input, ctx) =>
    Result.ok({ count: scenarioStateService.from(ctx).count }),
  services: [scenarioStateService],
});

const scenarioRootTrail = trail('service.scenario.root', {
  description: 'Root trail that mutates scenario state and follows a leaf',
  follow: ['service.scenario.leaf'],
  input: z.object({}),
  output: z.object({ count: z.number() }),
  run: async (_input, ctx: TrailContext) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }

    const state = scenarioStateService.from(ctx);
    state.count += 1;

    const leafResult = await ctx.follow<{ count: number }>(
      'service.scenario.leaf',
      {}
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ count: leafResult.value.count });
  },
  services: [scenarioStateService],
});

const scenarioTrailsMap = new Map<string, AnyTrail>([
  ['service.scenario.leaf', scenarioLeafTrail],
]);

const transformedFollowLeafTrail = trail('follow.transformed.leaf', {
  description: 'Leaf trail in a transformed follow chain',
  input: z.object({ value: z.number() }),
  output: z.object({ value: z.number() }),
  run: (input: { value: number }) => Result.ok({ value: input.value }),
});

const transformedFollowRootTrail = trail('follow.transformed.root', {
  description: 'Root trail that transforms input once before following',
  follow: ['follow.transformed.leaf'],
  input: z
    .object({ value: z.string() })
    .transform(({ value }) => ({ value: Number(value) + 1 })),
  output: z.object({ root: z.number() }),
  run: async (input: { value: number }, ctx: TrailContext) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }

    const leafResult = await ctx.follow<{ value: number }>(
      'follow.transformed.leaf',
      { value: input.value }
    );
    if (leafResult.isErr()) {
      return leafResult;
    }

    return Result.ok({ root: leafResult.value.value });
  },
});

const transformedFollowTrailsMap = new Map<string, AnyTrail>([
  ['follow.transformed.leaf', transformedFollowLeafTrail],
]);

const undeclaredFollowService = service('db.undeclared.follows', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredServiceLeafTrail = trail('service.undeclared.leaf', {
  description: 'Leaf trail that declares the shared service',
  input: z.object({}),
  output: z.object({ childSource: z.string() }),
  run: (_input, ctx) =>
    Result.ok({ childSource: undeclaredFollowService.from(ctx).source }),
  services: [undeclaredFollowService],
});

const undeclaredServiceRootTrail = trail('service.undeclared.root', {
  description: 'Root trail that uses a service without declaring it',
  follow: ['service.undeclared.leaf'],
  input: z.object({}),
  output: z.object({ childSource: z.string(), rootSource: z.string() }),
  run: async (_input, ctx: TrailContext) => {
    if (!ctx.follow) {
      return Result.err(new Error('follow not available'));
    }

    const childResult = await ctx.follow<{ childSource: string }>(
      'service.undeclared.leaf',
      {}
    );
    if (childResult.isErr()) {
      return childResult;
    }

    return Result.ok({
      childSource: childResult.value.childSource,
      rootSource: undeclaredFollowService.from(ctx).source,
    });
  },
});

const undeclaredServiceTrailsMap = new Map<string, AnyTrail>([
  ['service.undeclared.leaf', undeclaredServiceLeafTrail],
]);

const unrelatedFollowService = service('db.unrelated.follows', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => {
    throw new Error('unrelated mock should not be resolved');
  },
});

const unrelatedServiceTrail = trail('service.unrelated', {
  description: 'Trail that should not be traversed or mocked',
  input: z.object({}),
  output: z.object({ source: z.string() }),
  run: (_input, ctx) =>
    Result.ok({ source: unrelatedFollowService.from(ctx).source }),
  services: [unrelatedFollowService],
});

const unrelatedServiceTrailsMap = new Map<string, AnyTrail>([
  ['service.unrelated', unrelatedServiceTrail],
]);

describe('testFollows service mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    serviceRootTrail,
    [
      {
        description: 'propagates auto-resolved service mocks through follow',
        expectValue: { childSource: 'mock', rootSource: 'mock' },
        input: {},
      },
    ],
    { trails: serviceTrailsMap }
  );
});

describe('testFollows service mocks are fresh per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    scenarioRootTrail,
    [
      {
        description: 'first scenario sees a fresh mutable service',
        expectValue: { count: 1 },
        input: {},
      },
      {
        description: 'second scenario also sees a fresh mutable service',
        expectValue: { count: 1 },
        input: {},
      },
    ],
    { trails: scenarioTrailsMap }
  );
});

describe('testFollows explicit service overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    serviceRootTrail,
    [
      {
        description: 'propagates explicit service overrides through follow',
        expectValue: { childSource: 'override', rootSource: 'override' },
        input: {},
      },
    ],
    {
      services: { 'db.mock.follows': { source: 'override' } },
      trails: serviceTrailsMap,
    }
  );
});

describe('testFollows raw transformed input', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    transformedFollowRootTrail,
    [
      {
        description: 'raw scenario input is only transformed once',
        expectValue: { root: 2 },
        input: { value: '1' },
      },
    ],
    { trails: transformedFollowTrailsMap }
  );
});

describe('testFollows service declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    undeclaredServiceRootTrail,
    [
      {
        description: 'fails when the root trail omits a required service',
        expectErr: InternalError,
        expectErrMessage: undeclaredFollowService.id,
        input: {},
      },
    ],
    { trails: undeclaredServiceTrailsMap }
  );
});

describe('testFollows only resolves mocks for trails under test', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    serviceRootTrail,
    [
      {
        description: 'unrelated service mocks are not resolved',
        expectValue: { childSource: 'mock', rootSource: 'mock' },
        input: {},
      },
    ],
    {
      trails: new Map<string, AnyTrail>([
        ...serviceTrailsMap.entries(),
        ...unrelatedServiceTrailsMap.entries(),
      ]),
    }
  );
});

describe('testFollows fresh service mocks per scenario', () => {
  // eslint-disable-next-line jest/require-hook
  testFollows(
    statefulServiceRootTrail,
    [
      {
        description: 'first scenario gets a fresh service mock',
        expectValue: { childCount: 1, rootCount: 1 },
        input: {},
      },
      {
        description: 'second scenario also gets a fresh service mock',
        expectValue: { childCount: 1, rootCount: 1 },
        input: {},
      },
    ],
    { trails: statefulServiceTrailsMap }
  );
});
