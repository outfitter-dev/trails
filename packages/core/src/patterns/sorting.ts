/**
 * Sorting schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Sort fields constrained to a set of allowed column names. */
export const sortFields = (allowedFields: string[]) =>
  z.object({
    sortBy: z.enum(allowedFields as [string, ...string[]]).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  });
