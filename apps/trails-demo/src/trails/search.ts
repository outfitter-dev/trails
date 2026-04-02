/**
 * Search trail -- full-text search across entities.
 *
 * Demonstrates: intent (read), schema-only examples.
 */

import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

import { entityStoreService } from '../services/entity-store.js';

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export const search = trail('search', {
  blaze: (input, ctx) => {
    const store = entityStoreService.from(ctx);
    const results = store.search(input.query);
    const limited = results.slice(0, input.limit);
    return Result.ok({
      query: input.query,
      results: limited.map((e) => ({
        id: e.id,
        name: e.name,
        tags: [...e.tags],
        type: e.type,
      })),
      total: results.length,
    });
  },
  description: 'Search entities by keyword',
  examples: [
    {
      description: 'Search by keyword matching name, type, or tags',
      input: { limit: 10, query: 'Alpha' },
      name: 'Search for entities',
    },
    {
      description: 'Search query that matches nothing',
      input: { limit: 10, query: 'zzz_nonexistent_zzz' },
      name: 'Search with no results',
    },
  ],
  input: z.object({
    limit: z.number().optional().default(10).describe('Maximum results'),
    query: z.string().describe('Search query'),
  }),
  intent: 'read',
  output: z.object({
    query: z.string(),
    results: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        tags: z.array(z.string()),
        type: z.string(),
      })
    ),
    total: z.number(),
  }),
  services: [entityStoreService],
});
