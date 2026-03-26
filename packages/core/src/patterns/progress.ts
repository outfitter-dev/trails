/**
 * Progress schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Progress tracking fields. */
export const progressFields = () =>
  z.object({
    current: z.number(),
    percentage: z.number().optional(),
    total: z.number(),
  });
