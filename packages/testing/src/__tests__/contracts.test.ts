import { describe, test } from 'bun:test';

import { Result, hike, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testContracts } from '../contracts.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

/** Trail whose implementation matches the output schema. */
const validTrail = trail('valid', {
  examples: [
    {
      expected: { id: 1, name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Valid output',
    },
  ],
  implementation: (input: { name: string }) =>
    Result.ok({ id: 1, name: input.name }),
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
});

/** Trail without output schema -- should be skipped. */
const noSchemaTrail = trail('noschema', {
  examples: [{ expected: 10, input: { x: 5 }, name: 'No schema' }],
  implementation: (input: { x: number }) => Result.ok(input.x * 2),
  input: z.object({ x: z.number() }),
});

/** Trail without examples -- should be skipped. */
const noExamplesTrail = trail('noexamples', {
  implementation: (input: { x: number }) => Result.ok({ value: input.x }),
  input: z.object({ x: z.number() }),
  output: z.object({ value: z.number() }),
});

// ---------------------------------------------------------------------------
// Test hikes
// ---------------------------------------------------------------------------

/** Hike whose implementation matches the output schema. */
const validHike = hike('hike.valid', {
  examples: [
    {
      expected: { total: 3 },
      input: { a: 1, b: 2 },
      name: 'Valid hike output',
    },
  ],
  follows: ['valid'],
  implementation: (input: { a: number; b: number }) =>
    Result.ok({ total: input.a + input.b }),
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ total: z.number() }),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('testContracts: valid output matches schema', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(topo('test-app', { validTrail } as Record<string, unknown>));
});

describe('testContracts: skips trails without output schemas', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(topo('test-app', { noSchemaTrail } as Record<string, unknown>));

  test('no-op marker', () => {
    // Trail without output schema is skipped -- no contract tests generated
  });
});

describe('testContracts: skips trails without examples', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('test-app', { noExamplesTrail } as Record<string, unknown>)
  );

  test('no-op marker', () => {
    // Trail without examples is skipped -- no contract tests generated
  });
});

describe('testContracts: validates hike output schemas', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(topo('test-app', { validHike } as Record<string, unknown>));
});
