/**
 * Bulk operation schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Bulk operation output wrapper for a given item schema. */
export const bulkOutput = <T>(itemSchema: z.ZodType<T>) =>
  z.object({
    errors: z
      .array(z.object({ index: z.number(), message: z.string() }))
      .optional(),
    failed: z.number(),
    items: z.array(itemSchema),
    succeeded: z.number(),
  });
