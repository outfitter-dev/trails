/**
 * entity.onboard route -- creates an entity and verifies it is searchable.
 *
 * Demonstrates: trail(), crossing declaration, ctx.cross() composition,
 * error propagation from downstream trails.
 */

import { InternalError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// entity.onboard
// ---------------------------------------------------------------------------

export const onboard = trail('entity.onboard', {
  blaze: async (input, ctx) => {
    if (!ctx.cross) {
      return Result.err(new InternalError('Route requires a cross function'));
    }

    const added = await ctx.cross<{
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

    const searched = await ctx.cross<{
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
  crosses: ['entity.add', 'search'],
  description: 'Create an entity and verify it appears in search',
  examples: [
    {
      description: 'Create an entity and verify it appears in search results',
      input: { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
      name: 'Onboard a new entity',
    },
  ],
  input: z.object({
    name: z.string().describe('Entity name'),
    tags: z.array(z.string()).optional().default([]),
    type: z.string().describe('Entity type'),
  }),
  intent: 'write',
  output: z.object({
    entity: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
    searchable: z.boolean(),
  }),
});
