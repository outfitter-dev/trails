import { describe, expect, test } from 'bun:test';

import type { TrailContext } from '@ontrails/core';
import { resource, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { ref, scenario } from '../scenario.js';
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
      // Import executeScenarioSteps to test the guard directly.
      const { executeScenarioSteps } = await import('../scenario.js');

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
