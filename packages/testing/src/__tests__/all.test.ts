import { describe } from 'bun:test';

import { Result, provision, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testAll } from '../all.js';

const mockDbProvision = provision('db.mock.all', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const mockedTrail = trail('provision.mocked.all', {
  blaze: (_input, ctx) =>
    Result.ok({ source: mockDbProvision.from(ctx).source }),
  description: 'Trail that uses a mocked provision through testAll',
  examples: [
    {
      expected: { source: 'mock' },
      input: {},
      name: 'Uses auto-resolved provision mock',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  provisions: [mockDbProvision],
});

const overrideTrail = trail('provision.override.all', {
  blaze: (_input, ctx) =>
    Result.ok({ source: mockDbProvision.from(ctx).source }),
  description: 'Trail that prefers explicit overrides over mock factories',
  examples: [
    {
      expected: { source: 'override' },
      input: {},
      name: 'Explicit provision override wins',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  provisions: [mockDbProvision],
});

describe('testAll provision mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-provision-mock-app', {
      mockDbProvision,
      mockedTrail,
    } as Record<string, unknown>)
  );
});

describe('testAll explicit provision overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-provision-override-app', {
      mockDbProvision,
      overrideTrail,
    } as Record<string, unknown>),
    {
      provisions: { 'db.mock.all': { source: 'override' } },
    }
  );
});
