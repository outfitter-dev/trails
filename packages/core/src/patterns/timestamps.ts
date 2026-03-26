/**
 * Timestamp schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Standard createdAt / updatedAt fields. */
export const timestampFields = () =>
  z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
  });
