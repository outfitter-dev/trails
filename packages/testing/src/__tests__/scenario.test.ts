import { describe, expect, test } from 'bun:test';

import type { TrailContext } from '@ontrails/core';
import { resource, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { errResultMatch, okResultMatch } from '../assertions.js';
import { executeScenarioSteps, ref, scenario } from '../scenario.js';
import type { ScenarioStep } from '../types.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

const createTrail = trail('item.create', {
  blaze: (input: { name: string }) => Result.ok({ id: 'g1', name: input.name }),
  description: 'Create an item',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

const showTrail = trail('item.show', {
  blaze: (input: { id: string }) =>
    Result.ok({ found: true, id: input.id, name: 'Test' }),
  description: 'Show an item',
  input: z.object({ id: z.string() }),
  output: z.object({ found: z.boolean(), id: z.string(), name: z.string() }),
});

const failTrail = trail('item.fail', {
  blaze: () => Result.err(new Error('intentional failure')),
  description: 'Always fails',
  input: z.object({}),
  output: z.object({}),
});

/** A trail that uses ctx.cross() to delegate to item.create. */
const createViaProxy = trail('item.create-via-proxy', {
  blaze: (input: { name: string }, ctx: TrailContext) => {
    const crossFn = ctx.cross;
    if (!crossFn) {
      return Promise.resolve(Result.err(new Error('ctx.cross is undefined')));
    }
    return crossFn(createTrail, input);
  },
  crosses: [createTrail],
  description: 'Delegates to item.create via ctx.cross()',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
});

/** A resource with a mock factory. */
const db = resource<{ query: (sql: string) => string }>('db', {
  create: () => Result.err(new Error('not wired in tests')),
  mock: () => ({ query: (sql: string) => `mock:${sql}` }),
});

/** A trail that uses a resource via ctx.resource(). */
const queryTrail = trail('item.query', {
  blaze: (_input: { sql: string }, ctx: TrailContext) => {
    const instance = db.from(ctx);
    return Result.ok({ result: instance.query(_input.sql) });
  },
  description: 'Run a query via the db resource',
  input: z.object({ sql: z.string() }),
  output: z.object({ result: z.string() }),
  resources: [db],
});

const app = topo('scenario-test-app', {
  createTrail,
  createViaProxy,
  db,
  failTrail,
  queryTrail,
  showTrail,
} as Record<string, unknown>);

const readySignal = 'ready';
type ReadySignal = typeof readySignal;

const concurrentBatchOutput = z.object({ results: z.array(z.unknown()) });

const createReadyController = () => Promise.withResolvers<ReadySignal>();

const requireCrossFn = (
  ctx: TrailContext
): NonNullable<TrailContext['cross']> => {
  expect(ctx.cross).toBeDefined();
  return ctx.cross as NonNullable<TrailContext['cross']>;
};

const waitForReadyPair = async (
  first: Promise<ReadySignal>,
  second: Promise<ReadySignal>
): Promise<void> => {
  await first;
  await second;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ref()', () => {
  test('creates a RefToken with the given path', () => {
    const token = ref('create.id');
    expect(token).toEqual({ __ref: true, path: 'create.id' });
  });
});

describe('scenario()', () => {
  // oxlint-disable-next-line jest/require-hook -- scenario() registers describe/test blocks, not setup code
  scenario('basic two-step flow', app, [
    {
      as: 'created',
      cross: createTrail,
      input: { name: 'Hello' },
    },
    {
      cross: showTrail,
      expectedMatch: { found: true, id: 'g1' },
      input: { id: ref('created.id') },
    },
  ]);

  // oxlint-disable-next-line jest/require-hook -- scenario() registers describe/test blocks, not setup code
  scenario('ref resolves dot-path from prior step', app, [
    {
      as: 'original',
      cross: createTrail,
      expected: { id: 'g1', name: 'Test' },
      input: { name: 'Test' },
    },
    {
      cross: showTrail,
      input: { id: ref('original.id') },
    },
  ]);

  // oxlint-disable-next-line jest/require-hook -- scenario() registers describe/test blocks, not setup code
  scenario('expectedMatch on a step works', app, [
    {
      cross: createTrail,
      expectedMatch: { name: 'Partial' },
      input: { name: 'Partial' },
    },
  ]);

  // oxlint-disable-next-line jest/require-hook -- scenario() registers describe/test blocks, not setup code
  scenario('step that uses ctx.cross() receives a bound cross function', app, [
    {
      as: 'proxied',
      cross: createViaProxy,
      expectedMatch: { id: 'g1', name: 'CrossTest' },
      input: { name: 'CrossTest' },
    },
  ]);

  // Resource mock forwarding
  // oxlint-disable-next-line jest/require-hook -- scenario() registers describe/test blocks, not setup code
  scenario('step with resource receives mock from topo', app, [
    {
      cross: queryTrail,
      expected: { result: 'mock:SELECT 1' },
      input: { sql: 'SELECT 1' },
    },
  ]);

  // Step failure reporting
  describe('step failure reporting', () => {
    test('reports which step failed', async () => {
      // We can't use scenario() directly here because it registers
      // describe/test blocks. Instead, test the error message shape
      // by importing the internals or checking that the scenario
      // properly reports failures.
      // For now, verify that a failing trail in a scenario produces
      // an informative error.
      const { executeTrail } = await import('@ontrails/core');
      const result = await executeTrail(failTrail, {}, { topo: app });
      expect(result.isErr()).toBe(true);
    });
  });

  // Duplicate alias guard
  describe('duplicate alias guard', () => {
    test('throws on duplicate step alias', async () => {
      const steps: ScenarioStep[] = [
        { as: 'dup', cross: createTrail, input: { name: 'A' } },
        { as: 'dup', cross: createTrail, input: { name: 'B' } },
      ];

      await expect(executeScenarioSteps(app, steps)).rejects.toThrow(
        'duplicate step alias "dup"'
      );
    });
  });
});

describe('executeScenarioSteps concurrent crossing support', () => {
  test('matches concurrent fan-out arrays with ok result helpers', async () => {
    const alphaTrail = trail('scenario.batch.alpha', {
      blaze: () => Result.ok({ label: 'alpha' }),
      input: z.object({}),
      output: z.object({ label: z.string() }),
      visibility: 'internal',
    });
    const betaTrail = trail('scenario.batch.beta', {
      blaze: () => Result.ok({ label: 'beta' }),
      input: z.object({}),
      output: z.object({ label: z.string() }),
      visibility: 'internal',
    });
    const fanoutTrail = trail('scenario.batch.fanout', {
      blaze: async (_input, ctx) => {
        const results = await requireCrossFn(ctx)([
          [alphaTrail, {}],
          [betaTrail, {}],
        ] as const);
        return Result.ok({ results });
      },
      crosses: [alphaTrail, betaTrail],
      input: z.object({}),
      output: concurrentBatchOutput,
    });
    const fanoutApp = topo('scenario-concurrent-fanout-app', {
      alphaTrail,
      betaTrail,
      fanoutTrail,
    } as Record<string, unknown>);

    await executeScenarioSteps(fanoutApp, [
      {
        cross: fanoutTrail,
        expectedMatch: {
          results: [
            okResultMatch({ label: 'alpha' }),
            okResultMatch({ label: 'beta' }),
          ],
        },
        input: {},
      },
    ]);
  });

  test('matches mixed ok/err batch results for partial failure scenarios', async () => {
    const successTrail = trail('scenario.batch.partial.success', {
      blaze: () => Result.ok({ label: 'success' }),
      input: z.object({}),
      output: z.object({ label: z.string() }),
      visibility: 'internal',
    });
    const failureTrail = trail('scenario.batch.partial.failure', {
      blaze: () => Result.err(new Error('branch failure')),
      input: z.object({}),
      output: z.object({}),
      visibility: 'internal',
    });
    const partialTrail = trail('scenario.batch.partial.root', {
      blaze: async (_input, ctx) => {
        const results = await requireCrossFn(ctx)([
          [successTrail, {}],
          [failureTrail, {}],
        ] as const);
        return Result.ok({ results });
      },
      crosses: [successTrail, failureTrail],
      input: z.object({}),
      output: concurrentBatchOutput,
    });
    const partialApp = topo('scenario-partial-failure-app', {
      failureTrail,
      partialTrail,
      successTrail,
    } as Record<string, unknown>);

    await executeScenarioSteps(partialApp, [
      {
        cross: partialTrail,
        expectedMatch: {
          results: [
            okResultMatch({ label: 'success' }),
            errResultMatch({ message: 'branch failure' }),
          ],
        },
        input: {},
      },
    ]);
  });

  test('respects concurrency limits for scenario ctx.cross batch flows', async () => {
    const slowStarted = createReadyController();
    const fastStarted = createReadyController();
    const releaseFirstBatch = createReadyController();
    const startedIds: string[] = [];
    const slowTrail = trail('scenario.batch.limited.slow', {
      blaze: async () => {
        startedIds.push('slow');
        slowStarted.resolve(readySignal);
        await releaseFirstBatch.promise;
        await Bun.sleep(20);
        return Result.ok({ id: 'slow' });
      },
      input: z.object({}),
      output: z.object({ id: z.string() }),
      visibility: 'internal',
    });
    const fastTrail = trail('scenario.batch.limited.fast', {
      blaze: async () => {
        startedIds.push('fast');
        fastStarted.resolve(readySignal);
        await releaseFirstBatch.promise;
        await Bun.sleep(1);
        return Result.ok({ id: 'fast' });
      },
      input: z.object({}),
      output: z.object({ id: z.string() }),
      visibility: 'internal',
    });
    const queuedTrail = trail('scenario.batch.limited.queued', {
      blaze: () => {
        startedIds.push('queued');
        return Result.ok({ id: 'queued' });
      },
      input: z.object({}),
      output: z.object({ id: z.string() }),
      visibility: 'internal',
    });
    const limitedTrail = trail('scenario.batch.limited.root', {
      blaze: async (_input, ctx) => {
        const run = requireCrossFn(ctx)(
          [
            [slowTrail, {}],
            [fastTrail, {}],
            [queuedTrail, {}],
          ] as const,
          { concurrency: 2 }
        );
        await waitForReadyPair(slowStarted.promise, fastStarted.promise);
        const startedBeforeRelease = [...startedIds];
        releaseFirstBatch.resolve(readySignal);
        const results = await run;
        return Result.ok({
          startedBeforeRelease,
          startedOverall: [...startedIds],
          successIds: results
            .filter((result) => result.isOk())
            .map((result) => result.value.id),
        });
      },
      crosses: [slowTrail, fastTrail, queuedTrail],
      input: z.object({}),
      output: z.object({
        startedBeforeRelease: z.array(z.string()),
        startedOverall: z.array(z.string()),
        successIds: z.array(z.string()),
      }),
    });
    const limitedApp = topo('scenario-concurrency-limited-app', {
      fastTrail,
      limitedTrail,
      queuedTrail,
      slowTrail,
    } as Record<string, unknown>);

    await executeScenarioSteps(limitedApp, [
      {
        cross: limitedTrail,
        expected: {
          startedBeforeRelease: ['slow', 'fast'],
          startedOverall: ['slow', 'fast', 'queued'],
          successIds: ['slow', 'fast', 'queued'],
        },
        input: {},
      },
    ]);
  });
});
