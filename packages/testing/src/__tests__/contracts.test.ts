import { describe, test } from 'bun:test';

import { Result, service, trail, topo } from '@ontrails/core';
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
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
  run: (input: { name: string }) => Result.ok({ id: 1, name: input.name }),
});

/** Trail without output schema -- should be skipped. */
const noSchemaTrail = trail('noschema', {
  examples: [{ expected: 10, input: { x: 5 }, name: 'No schema' }],
  input: z.object({ x: z.number() }),
  run: (input: { x: number }) => Result.ok(input.x * 2),
});

/** Trail without examples -- should be skipped. */
const noExamplesTrail = trail('noexamples', {
  input: z.object({ x: z.number() }),
  output: z.object({ value: z.number() }),
  run: (input: { x: number }) => Result.ok({ value: input.x }),
});

// ---------------------------------------------------------------------------
// Composition trail
// ---------------------------------------------------------------------------

/** Composition trail whose implementation matches the output schema. */
const compositionTrail = trail('composition.valid', {
  examples: [
    {
      expected: { total: 3 },
      input: { a: 1, b: 2 },
      name: 'Valid composition output',
    },
  ],
  follow: ['valid'],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ total: z.number() }),
  run: (input: { a: number; b: number }) =>
    Result.ok({ total: input.a + input.b }),
});

const transformedInputTrail = trail('contract.transformed', {
  examples: [
    {
      expected: { value: 2 },
      input: { value: '1' },
      name: 'Raw contract input is only transformed once',
    },
  ],
  input: z
    .object({ value: z.string() })
    .transform(({ value }) => ({ value: Number(value) + 1 })),
  output: z.object({ value: z.number() }),
  run: (input: { value: number }) => Result.ok({ value: input.value }),
});

const undeclaredContractDbService = service('db.undeclared.contracts', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredContractTrail = trail('service.undeclared.contracts', {
  examples: [
    {
      expected: { hasInjectedService: false },
      input: {},
      name: 'Undeclared services are not preloaded into contract contexts',
    },
  ],
  input: z.object({}),
  output: z.object({ hasInjectedService: z.literal(false) }),
  run: (_input, ctx) =>
    Result.ok({
      hasInjectedService:
        ctx.extensions?.[undeclaredContractDbService.id] !== undefined,
    }),
});

const ctxOverrideContractService = service('db.mock.contracts', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const ctxOverrideContractTrail = trail('service.ctx.contracts', {
  examples: [
    {
      expected: { source: 'ctx' },
      input: {},
      name: 'Context extensions beat auto-resolved contract mocks',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.literal('ctx') }),
  run: (_input, ctx) =>
    Result.ok({ source: ctxOverrideContractService.from(ctx).source }),
  services: [ctxOverrideContractService],
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

describe('testContracts: validates composition trail output schemas', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('test-app', { compositionTrail } as Record<string, unknown>)
  );
});

describe('testContracts: raw transformed input', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('transformed-contract-app', {
      transformedInputTrail,
    } as Record<string, unknown>)
  );
});

describe('testContracts: context extension overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('ctx-contract-app', {
      ctxOverrideContractService,
      ctxOverrideContractTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        extensions: { 'db.mock.contracts': { source: 'ctx' } },
      },
    }
  );
});

describe('testContracts service declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('undeclared-contract-service-app', {
      undeclaredContractDbService,
      undeclaredContractTrail,
    } as Record<string, unknown>)
  );
});
