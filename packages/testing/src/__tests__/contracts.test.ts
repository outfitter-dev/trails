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
    const composed = await ctx.compose?.(compositionChildTrail, {
      value: input.a + input.b,
    });
    if (composed === undefined) {
      return Result.err(new Error('missing compose context'));
    }
    if (composed.isErr()) {
      return Result.err(composed.error);
    }
    return Result.ok({ total: composed.value.total });
  },
  composes: [compositionChildTrail],
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
    const composed = await ctx.compose?.(compositionChildTrail, { value: 3 });
    let fired = false;
    await ctx.fire?.(compositionContractSignal, {
      id: 'contract',
    });
    fired = true;

    return Result.ok({
      composed: composed?.isOk() === true,
      fired,
    });
  },
  composes: [compositionChildTrail],
  examples: [
    {
      expected: { composed: true, fired: true },
      input: {},
      name: 'Custom compose still keeps fire binding',
    },
  ],
  fires: [compositionContractSignal],
  input: z.object({}),
  output: z.object({ composed: z.literal(true), fired: z.literal(true) }),
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

const versionContractCurrentBlaze = mock((input: { name: string }) =>
  Result.ok({ message: `current:${input.name}` })
);
const versionContractForkBlaze = mock((input: { code: string }) =>
  Result.ok({ message: `fork:${input.code}` })
);
const versionedContractTrail = trail('contract.versioned', {
  blaze: (input: { name: string }) => versionContractCurrentBlaze(input),
  examples: [
    {
      expected: { message: 'current:Ada' },
      input: { name: 'Ada' },
      name: 'Current contract example',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  version: 5,
  versions: {
    1: {
      examples: [
        {
          expected: { legacyMessage: 'legacy:Ada' },
          input: { legacyName: 'Ada' },
          name: 'Revision contract example',
        },
      ],
      input: z.object({ legacyName: z.string() }),
      output: z.object({ legacyMessage: z.string() }),
      transpose: {
        input: ({ input }) => ({ name: input.legacyName }),
        output: ({ output }) => ({
          legacyMessage: output.message.replace('current:', 'legacy:'),
        }),
      },
    },
    2: {
      blaze: (input: { code: string }) => versionContractForkBlaze(input),
      examples: [
        {
          expected: { message: 'fork:beta' },
          input: { code: 'beta' },
          name: 'Fork contract example',
        },
      ],
      input: z.object({ code: z.string() }),
      output: z.object({ message: z.string() }),
      status: { note: 'Use the current version.', state: 'deprecated' },
    },
    4: {
      examples: [
        {
          expected: { archivedMessage: 'skip' },
          input: {},
          name: 'Archived contract example',
        },
      ],
      input: z.object({}),
      output: z.object({ archivedMessage: z.string() }),
      status: { state: 'archived' },
      transpose: {
        input: () => ({ name: 'archived' }),
        output: () => ({ archivedMessage: 'skip' }),
      },
    },
  },
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

describe('testContracts: validates output schemas for trails with compositions', () => {
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

describe('testContracts: preserves provided compose context', () => {
  const providedCompose = mock(async () => Result.ok({ total: 3 }));

  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('custom-compose-contract-app', {
      compositionTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        compose: providedCompose as TrailContext['compose'],
      },
    }
  );

  afterAll(() => {
    expect(providedCompose).toHaveBeenCalledTimes(1);
  });
});

describe('testContracts: preserves custom compose without suppressing fire', () => {
  const providedCompose = mock(async () => Result.ok({ total: 3 }));

  // eslint-disable-next-line jest/require-hook
  testContracts(
    topo('custom-compose-fire-contract-app', {
      compositionContractSignal,
      compositionWithFireTrail,
    } as Record<string, unknown>),
    {
      ctx: {
        compose: providedCompose as TrailContext['compose'],
      },
    }
  );

  afterAll(() => {
    expect(providedCompose).toHaveBeenCalledTimes(1);
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

describe('testContracts validates live version-entry outputs', () => {
  // eslint-disable-next-line jest/require-hook
  testContracts(topo('version-contract-app', { versionedContractTrail }));

  afterAll(() => {
    expect(versionContractCurrentBlaze).toHaveBeenCalledTimes(2);
    expect(versionContractForkBlaze).toHaveBeenCalledTimes(1);
  });
});
