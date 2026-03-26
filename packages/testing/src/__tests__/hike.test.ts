import { describe } from 'bun:test';

import type { AnyTrail, TrailContext } from '@ontrails/core';
import { Result, hike, trail } from '@ontrails/core';
import { z } from 'zod';

import { testHike } from '../hike.js';

// ---------------------------------------------------------------------------
// Test trails (followed by hikes)
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
  implementation: (input: { name: string }) =>
    Result.ok({ id: '1', name: input.name }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const relateTrail = trail('entity.relate', {
  description: 'Relate two entities',
  implementation: (input: { from: string; to: string }) =>
    Result.ok({ from: input.from, to: input.to }),
  input: z.object({ from: z.string(), to: z.string() }),
  output: z.object({ from: z.string(), to: z.string() }),
});

// ---------------------------------------------------------------------------
// Test hike
// ---------------------------------------------------------------------------

const onboardHike = hike('entity.onboard', {
  follows: ['entity.add', 'entity.relate'],
  implementation: async (
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

describe('testHike: expectOk', () => {
  // eslint-disable-next-line jest/require-hook
  testHike(
    onboardHike,
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

describe('testHike: expectFollowed', () => {
  // eslint-disable-next-line jest/require-hook
  testHike(
    onboardHike,
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

describe('testHike: expectFollowedCount', () => {
  // eslint-disable-next-line jest/require-hook
  testHike(
    onboardHike,
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

describe('testHike: injectFromExample', () => {
  // eslint-disable-next-line jest/require-hook
  testHike(
    onboardHike,
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

describe('testHike: expectValue', () => {
  // eslint-disable-next-line jest/require-hook
  testHike(
    onboardHike,
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
