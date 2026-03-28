/**
 * entity.onboard route -- creates an entity and verifies it is searchable.
 *
 * Demonstrates: trail(), follow declaration, ctx.follow() composition,
 * error propagation from downstream trails.
 */

import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// entity.onboard
// ---------------------------------------------------------------------------

export const onboard = trail('entity.onboard', {
  description: 'Create an entity and verify it appears in search',
  examples: [
    {
      description: 'Create an entity and verify it appears in search results',
      input: { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
      name: 'Onboard a new entity',
    },
  ],
  follow: ['entity.add', 'search'],
  implementation: async (input, ctx) => {
    if (!ctx.follow) {
      return Result.err(new Error('Route requires a follow function'));
    }

    const added = await ctx.follow<{
      id: string;
      name: string;
      type: string;
      tags: string[];
      createdAt: string;
      updatedAt: string;
    }>('entity.add', {
      name: input.name,
      tags: input.tags,
      type: input.type,
    });
    if (added.isErr()) {
      return Result.err(added.error);
    }

    const searched = await ctx.follow<{
      results: {
        id: string;
        name: string;
        type: string;
        tags: string[];
      }[];
      query: string;
      total: number;
    }>('search', { query: input.name });
    const searchable = searched.isOk() && searched.value.total > 0;

    return Result.ok({
      entity: {
        id: added.value.id,
        name: added.value.name,
        type: added.value.type,
      },
      searchable,
    });
  },
  input: z.object({
    name: z.string().describe('Entity name'),
    tags: z.array(z.string()).optional().default([]),
    type: z.string().describe('Entity type'),
  }),
  output: z.object({
    entity: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
    searchable: z.boolean(),
  }),
});
