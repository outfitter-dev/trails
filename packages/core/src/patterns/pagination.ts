/**
 * Pagination schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Common pagination input fields. */
export const paginationFields = () =>
  z.object({
    cursor: z.string().optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0),
  });

/** Paginated output wrapper for a given item schema. */
export const paginatedOutput = <T>(itemSchema: z.ZodType<T>) =>
  z.object({
    hasMore: z.boolean(),
    items: z.array(itemSchema),
    nextCursor: z.string().optional(),
    total: z.number(),
  });
