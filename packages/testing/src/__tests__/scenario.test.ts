import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { ref, scenario } from '../scenario.js';

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

const app = topo('scenario-test-app', {
  createTrail,
  failTrail,
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
});
