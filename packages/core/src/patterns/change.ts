/**
 * Change-tracking schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Before/after change output for a given schema. */
export const changeOutput = <T>(schema: z.ZodType<T>) =>
  z.object({
    after: schema,
    before: schema.optional(),
  });
