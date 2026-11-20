/**
 * Example-driven parity across shipped surfaces.
 */

import { expect, test } from 'bun:test';

import { createProgram } from '@ontrails/commander';
import { Result, topo, trail } from '@ontrails/core';
import { createFetchHandler } from '@ontrails/http';
import { testSurfaceParity } from '@ontrails/testing/surface-parity';
import { z } from 'zod';

import { graph } from '../src/app.js';
import { createNotificationStore } from '../src/resources/notification-store.js';
import { createStore } from '../src/store.js';

// oxlint-disable-next-line require-hook -- testSurfaceParity registers tests at module level by design
testSurfaceParity(graph, {
  createResources: () => ({
    'demo.entity-store': createStore([
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: 'entity-alpha',
        name: 'Alpha',
        tags: ['core'],
        type: 'concept',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        createdAt: '2026-01-02T00:00:00.000Z',
        id: 'entity-deletable',
        name: 'Deletable',
        tags: ['temp'],
        type: 'tool',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]),
    'demo.notification-store': createNotificationStore(),
  }),
  ctx: { permit: { actors: [], id: 'test-permit', scopes: ['entity:write'] } },
  exclusions: [
    {
      example: 'Add a new entity',
      reason:
        'creates generated id/timestamp fields, so each fresh surface store returns different values',
      trailId: 'entity.add',
    },
    {
      example: 'Onboard a new entity',
      reason:
        'composes entity.add and returns generated entity identity from each fresh surface store',
      trailId: 'entity.onboard',
    },
  ],
});

const tags = z.array(z.enum(['red', 'blue']));
const listTags = trail('list-tags', {
  implementation: (input) => Result.ok({ tags: input.tags }),
  input: z.object({ tags: tags.default([]) }),
  intent: 'read',
  output: z.object({ tags }),
});

test.each([
  { args: [], expected: [], query: '' },
  { args: ['--tags', 'red'], expected: ['red'], query: '?tags=red' },
  {
    args: ['--tags', 'red', 'blue', 'red'],
    expected: ['red', 'blue', 'red'],
    query: '?tags=red&tags=blue&tags=red',
  },
  {
    args: ['--tags', 'red', '--tags', 'blue'],
    expected: ['red', 'blue'],
    query: '?tags=red&tags=blue',
  },
])(
  'CLI $args and HTTP $query pass the same tags to the trail',
  async ({ args, expected, query }) => {
    const app = topo('array-parity', { listTags });
    let cliOutput: unknown;
    const program = createProgram(app, {
      onResult: async ({ result }) => {
        if (result.isErr()) {
          throw result.error;
        }
        cliOutput = result.value;
      },
    }).exitOverride();

    await program.parseAsync(['list-tags', ...args], { from: 'user' });
    expect(cliOutput).toEqual({ tags: expected });

    const response = await createFetchHandler(app)(
      new Request(`http://localhost/list-tags${query}`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: cliOutput });
  }
);
