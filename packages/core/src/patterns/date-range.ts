/**
 * Date-range schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Optional since/until date-range fields. */
export const dateRangeFields = () =>
  z.object({
    since: z.string().optional(),
    until: z.string().optional(),
  });
