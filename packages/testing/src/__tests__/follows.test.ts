import { describe } from 'bun:test';

import type { AnyTrail, TrailContext } from '@ontrails/core';
import { Result, trail } from '@ontrails/core';
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
