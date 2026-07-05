/**
 * Public liveness probe.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

export const health = trail('status.health', {
  blaze: () => Result.ok({ status: 'ok' }),
  description: 'Public liveness check',
  examples: [
    {
      description: 'The relay reports healthy',
      expected: { status: 'ok' },
      input: {},
      name: 'Health check',
    },
    {
      description: 'Health stays ok on repeated probes',
      expected: { status: 'ok' },
      input: {},
      name: 'Health check again',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({ status: z.string().describe('Liveness indicator') }),
  permit: 'public',
});
