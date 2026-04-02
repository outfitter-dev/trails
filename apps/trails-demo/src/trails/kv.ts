/**
 * Key-value trail -- demonstrates the `idempotent` flag.
 *
 * An idempotent upsert: calling it multiple times with the same input
 * produces the same result with no side effects.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// demo.upsert
// ---------------------------------------------------------------------------

export const upsert = trail('demo.upsert', {
  blaze: (input) => Result.ok({ key: input.key, value: input.value }),
  description: 'Upsert a key-value pair (idempotent)',
  examples: [
    {
      description:
        'Store a value under a key; repeating produces the same result',
      expected: { key: 'theme', value: 'dark' },
      input: { key: 'theme', value: 'dark' },
      name: 'Upsert a key-value pair',
    },
  ],
  idempotent: true,
  input: z.object({
    key: z.string().describe('Item key'),
    value: z.string().describe('Item value'),
  }),
  output: z.object({ key: z.string(), value: z.string() }),
});
