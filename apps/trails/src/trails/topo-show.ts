import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { topoDetailOutput } from './topo-output-schemas.js';
import { buildCurrentTopoDetail } from './topo-read-support.js';

export const topoShowTrail = trail('topo.show', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    const detail = buildCurrentTopoDetail(app, input.id, { rootDir });
    if (detail !== undefined) {
      return Result.ok(detail);
    }
    return Result.err(
      new NotFoundError(`Trail, resource, or signal not found: ${input.id}`)
    );
  },
  description: 'Show detail for a current trail, resource, or signal',
  examples: [
    {
      input: { id: 'topo' },
      name: 'Show current trail detail',
    },
  ],
  input: z.object({
    id: z.string().describe('Trail, resource, or signal ID to inspect'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: topoDetailOutput,
});
