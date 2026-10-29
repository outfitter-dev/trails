import { outputModePreset } from '@ontrails/cli';
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { status } from './cli-flags-app.js';

const pages = trail('items.list', {
  implementation: (input) =>
    Result.ok(
      input.cursor === undefined
        ? { hasMore: true, items: ['a', 'b'], nextCursor: 'next' }
        : { hasMore: false, items: ['c'] }
    ),
  input: z.object({ cursor: z.string().optional() }),
  intent: 'read',
  output: z.object({
    hasMore: z.boolean(),
    items: z.array(z.string()),
    nextCursor: z.string().optional(),
  }),
});

const defaults = trail('defaults.show', {
  implementation: (input) => Result.ok(input),
  input: z.object({ tags: z.array(z.string()).default(['base']) }),
  intent: 'read',
  output: z.object({ tags: z.array(z.string()) }),
});

export const app = topo('cli-review', { defaults, pages, status });
export const options = {
  presets: [
    outputModePreset().map((flag) =>
      flag.name === 'output' ? { ...flag, default: 'jsonl' } : flag
    ),
  ],
};
