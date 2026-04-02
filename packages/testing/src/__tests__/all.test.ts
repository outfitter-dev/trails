import { describe } from 'bun:test';

import { Result, service, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testAll } from '../all.js';

const mockDbService = service('db.mock.all', {
  create: () => Result.ok({ source: 'factory' }),
  mock: () => ({ source: 'mock' }),
});

const mockedTrail = trail('service.mocked.all', {
  blaze: (_input, ctx) => Result.ok({ source: mockDbService.from(ctx).source }),
  description: 'Trail that uses a mocked service through testAll',
  examples: [
    {
      expected: { source: 'mock' },
      input: {},
      name: 'Uses auto-resolved service mock',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  services: [mockDbService],
});

const overrideTrail = trail('service.override.all', {
  blaze: (_input, ctx) => Result.ok({ source: mockDbService.from(ctx).source }),
  description: 'Trail that prefers explicit overrides over mock factories',
  examples: [
    {
      expected: { source: 'override' },
      input: {},
      name: 'Explicit service override wins',
    },
  ],
  input: z.object({}),
  output: z.object({ source: z.string() }),
  services: [mockDbService],
});

describe('testAll service mocks', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-service-mock-app', {
      mockDbService,
      mockedTrail,
    } as Record<string, unknown>)
  );
});

describe('testAll explicit service overrides', () => {
  // eslint-disable-next-line jest/require-hook
  testAll(
    topo('test-all-service-override-app', {
      mockDbService,
      overrideTrail,
    } as Record<string, unknown>),
    {
      services: { 'db.mock.all': { source: 'override' } },
    }
  );
});
