import { afterAll, describe, expect, mock, test } from 'bun:test';

import { contour, Result, resource, signal, trail, topo } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { testContracts } from '../contracts.js';

const requireContourExample = (
  contourDef: { examples?: readonly Record<string, unknown>[] },
  index: number
) => {
  const example = contourDef.examples?.[index];
  expect(example).toBeDefined();
  if (!example) {
    throw new Error(`Expected contour example at index ${index}`);
  }
  return example;
};

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

/** Trail whose implementation matches the output schema. */
const validTrail = trail('valid', {
  blaze: (input: { name: string }) => Result.ok({ id: 1, name: input.name }),
  examples: [
    {
      expected: { id: 1, name: 'Alpha' },
      input: { name: 'Alpha' },
      name: 'Valid output',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.number(), name: z.string() }),
});

/** Trail without output schema -- should be skipped. */
const noSchemaTrail = trail('noschema', {
  blaze: (input: { x: number }) => Result.ok(input.x * 2),
  examples: [{ expected: 10, input: { x: 5 }, name: 'No schema' }],
  input: z.object({ x: z.number() }),
});

/** Trail without examples -- should be skipped. */
const noExamplesTrail = trail('noexamples', {
  blaze: (input: { x: number }) => Result.ok({ value: input.x }),
  input: z.object({ x: z.number() }),
  output: z.object({ value: z.number() }),
});

// ---------------------------------------------------------------------------
// Composition trail
// ---------------------------------------------------------------------------

const compositionChildBlaze = mock((value: number) =>
  Result.ok({ total: value })
);

const compositionChildTrail = trail('composition.child', {
  blaze: (input: { value: number }) => compositionChildBlaze(input.value),
  input: z.object({ value: z.number() }),
  output: z.object({ total: z.number() }),
});

/** Composition trail whose implementation matches the output schema. */
const compositionTrail = trail('composition.valid', {
  blaze: async (input: { a: number; b: number }, ctx) => {
    const crossed = await ctx.cross?.(compositionChildTrail, {
      value: input.a + input.b,
    });
    if (crossed === undefined) {
      return Result.err(new Error('missing cross context'));
    }
    if (crossed.isErr()) {
      return Result.err(crossed.error);
    }
    return Result.ok({ total: crossed.value.total });
  },
  crosses: [compositionChildTrail],
  examples: [
    {
      expected: { total: 3 },
      input: { a: 1, b: 2 },
      name: 'Valid composition output',
    },
  ],
  input: z.object({ a: z.number(), b: z.number() }),
  output: z.object({ total: z.number() }),
});

const compositionContractSignal = signal('composition.contract.fired', {
  payload: z.object({ id: z.string() }),
});

const compositionWithFireTrail = trail('composition.withFire', {
  blaze: async (_input: Record<string, never>, ctx) => {
    const crossed = await ctx.cross?.(compositionChildTrail, { value: 3 });
    const fired = await ctx.fire?.(compositionContractSignal, {
      id: 'contract',
    });

    return Result.ok({
      crossed: crossed?.isOk() === true,
      fired: fired?.isOk() === true,
    });
  },
  crosses: [compositionChildTrail],
  examples: [
    {
      expected: { crossed: true, fired: true },
      input: {},
      name: 'Custom cross still keeps fire binding',
    },
  ],
  fires: [compositionContractSignal],
  input: z.object({}),
  output: z.object({ crossed: z.literal(true), fired: z.literal(true) }),
});

const transformedInputTrail = trail('contract.transformed', {
  blaze: (input: { value: number }) => Result.ok({ value: input.value }),
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
});

const undeclaredContractDbResource = resource('db.undeclared.contracts', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const undeclaredContractTrail = trail('resource.undeclared.contracts', {
  blaze: (_input, ctx) =>
    Result.ok({
      hasInjectedResource:
        ctx.extensions?.[undeclaredContractDbResource.id] !== undefined,
    }),
  examples: [
    {
      expected: { hasInjectedResource: false },
      input: {},
      name: 'Undeclared resources are not preloaded into contract contexts',
    },
  ],
  input: z.object({}),
  output: z.object({ hasInjectedResource: z.literal(false) }),
});

const ctxOverrideContractResource = resource('db.mock.contracts', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const ctxOverrideContractTrail = trail('resource.ctx.contracts', {
  blaze: (_input, ctx) =>
    Result.ok({ source: ctxOverrideContractResource.from(ctx).source }),
  examples: [
    {
      expected: { source: 'ctx' },
      input: {},
      name: 'Context extensions beat auto-resolved contract resource mocks',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.literal('ctx') }),
  resources: [ctxOverrideContractResource],
});

const derivedContractContour = contour(
  'contractFixture',
  {
    id: z.string().uuid(),
    name: z.string(),
  },
  {
    examples: [
      {
        id: '03a5873c-0ca6-43c4-9201-3cb3c07ca6bf',
        name: 'Contour contract fixture',
      },
    ],
    identity: 'id',
  }
);

const derivedContractBlaze = mock(() =>
  Result.ok(requireContourExample(derivedContractContour, 0))
);

const derivedContractTrail = trail('contract.derived', {
  blaze: () => derivedContractBlaze(),
  contours: [derivedContractContour],
  input: z.object({ id: derivedContractContour.shape.id }),
  output: derivedContractContour,
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

describe('testContracts: validates output schemas for trails with crossings', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('test-app', {
      compositionChildTrail,
      compositionTrail,
    } as Record<string, unknown>)
  );

  afterAll(() => {
    expect(compositionChildBlaze).toHaveBeenCalledTimes(1);
  });
});

describe('testContracts: preserves provided cross context', () => {
  const providedCross = mock(async () => Result.ok({ total: 3 }));

  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('custom-cross-contract-app', {
      compositionTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        cross: providedCross as TrailContext['cross'],
      },
    }
  );

  afterAll(() => {
    expect(providedCross).toHaveBeenCalledTimes(1);
  });
});

describe('testContracts: preserves custom cross without suppressing fire', () => {
  const providedCross = mock(async () => Result.ok({ total: 3 }));

  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('custom-cross-fire-contract-app', {
      compositionContractSignal,
      compositionWithFireTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        cross: providedCross as TrailContext['cross'],
      },
    }
  );

  afterAll(() => {
    expect(providedCross).toHaveBeenCalledTimes(1);
  });
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
      ctxOverrideContractResource,
      ctxOverrideContractTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        extensions: { 'db.mock.contracts': { source: 'ctx' } },
      },
    }
  );
});

describe('testContracts resource declarations', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('undeclared-contract-resource-app', {
      undeclaredContractDbResource,
      undeclaredContractTrail,
    } as Record<string, unknown>)
  );
});

describe('testContracts derives contour examples when trail examples are absent', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('derived-contract-app', {
      derivedContractContour,
      derivedContractTrail,
    } as Record<string, unknown>)
  );

  afterAll(() => {
    expect(derivedContractBlaze).toHaveBeenCalledTimes(1);
  });
});
