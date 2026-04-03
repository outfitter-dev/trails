import { describe } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { testAll } from '../all.js';
import { store as defineStore } from '@ontrails/store';
import { connectDrizzle } from '@ontrails/store/drizzle';

const dbDefinition = defineStore({
  entities: {
    fixtures: [
      {
        id: 'seed-1',
        name: 'Alpha',
        source: 'mock',
      },
    ],
    generated: ['id'],
    primaryKey: 'id',
    schema: z.object({
      id: z.string(),
      name: z.string(),
      source: z.string(),
    }),
  },
});

const createDbProvision = (
  seed?: readonly {
    readonly id: string;
    readonly name: string;
    readonly source: string;
  }[]
) =>
  connectDrizzle(dbDefinition, {
    id: 'db.mock.all',
    ...(seed === undefined ? {} : { mockSeed: { entities: seed } }),
    url: ':memory:',
  });

const createOverrideStore = () => {
  const { mock } = createDbProvision([
    {
      id: 'seed-1',
      name: 'Override',
      source: 'override',
    },
  ]);

  if (mock === undefined) {
    throw new Error('Expected drizzle test store to expose a mock factory');
  }

  const created = mock();
  if (created instanceof Promise) {
    throw new TypeError(
      'Expected drizzle test store mock to resolve synchronously'
    );
  }

  return created;
};

const mockDbProvision = createDbProvision();

const mockedTrail = trail('provision.mocked.all', {
  blaze: async (_input, ctx) => {
    const entity = await mockDbProvision.from(ctx).entities.get('seed-1');
    if (entity === null) {
      return Result.err(new Error('expected seeded entity to exist'));
    }

    return Result.ok({ name: entity.name, source: entity.source });
  },
  description:
    'Trail that uses a mocked connector-bound provision through testAll',
  examples: [
    {
      expected: { name: 'Alpha', source: 'mock' },
      input: {},
      name: 'Uses auto-resolved provision mock',
    },
  ],
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
  provisions: [mockDbProvision],
});

const overrideTrail = trail('provision.override.all', {
  blaze: async (_input, ctx) => {
    const entity = await mockDbProvision.from(ctx).entities.get('seed-1');
    if (entity === null) {
      return Result.err(new Error('expected overridden entity to exist'));
    }

    return Result.ok({ name: entity.name, source: entity.source });
  },
  description: 'Trail that prefers explicit overrides over mock factories',
  examples: [
    {
      expected: { name: 'Override', source: 'override' },
      input: {},
      name: 'Explicit provision override wins',
    },
  ],
  input: z.object({}),
  output: z.object({ name: z.string(), source: z.string() }),
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
    () => ({
      provisions: {
        'db.mock.all': createOverrideStore(),
      },
    })
  );
});
