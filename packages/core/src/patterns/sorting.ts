/**
 * Sorting schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Sort fields constrained to a set of allowed column names. */
export const sortFields = <const T extends string>(
  allowedFields: [T, ...T[]]
) =>
  z.object({
    sortBy: z.enum(allowedFields).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  });
