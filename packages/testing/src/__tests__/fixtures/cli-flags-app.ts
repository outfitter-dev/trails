import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

export const status = trail('system.status', {
  implementation: (input) => Result.ok(input),
  input: z.object({
    colors: z.array(z.enum(['red', 'blue'])).default([]),
    enabled: z.boolean().default(false),
    name: z.string().default('ready'),
    tags: z.array(z.string()).default([]),
  }),
  intent: 'read',
  output: z.object({
    colors: z.array(z.enum(['red', 'blue'])),
    enabled: z.boolean(),
    name: z.string(),
    tags: z.array(z.string()),
  }),
});

export const app = topo('cli-flags', { status });
