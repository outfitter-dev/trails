/**
 * Status schema helpers for @ontrails/core/patterns
 */

import { z } from 'zod';

/** Standard workflow status field. */
export const statusFields = () =>
  z.object({
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  });
