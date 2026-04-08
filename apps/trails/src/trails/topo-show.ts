import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { buildCurrentTopoDetail } from './topo-read-support.js';
import { DEFAULT_APP_MODULE } from './topo-support.js';

const trailDetailOutput = z.object({
  crosses: z.array(z.string()),
  description: z.unknown().nullable(),
  detours: z.unknown().nullable(),
  examples: z.array(z.unknown()),
  id: z.string(),
  intent: z.enum(['read', 'write', 'destroy']),
  kind: z.string(),
  resources: z.array(z.string()),
  safety: z.string(),
});

const provisionDetailOutput = z.object({
  description: z.string().nullable(),
  health: z.enum(['available', 'none']),
  id: z.string(),
  kind: z.literal('resource'),
  lifetime: z.literal('singleton'),
  usedBy: z.array(z.string()),
});

export const topoShowTrail = trail('topo.show', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    const detail = buildCurrentTopoDetail(app, input.id, { rootDir });
    if (detail !== undefined) {
      return Result.ok(detail);
    }
    return Result.err(
      new NotFoundError(`Trail or resource not found: ${input.id}`)
    );
  },
  description: 'Show detail for a current trail or resource',
  examples: [
    {
      input: { id: 'topo' },
      name: 'Show current trail detail',
    },
  ],
  input: z.object({
    id: z.string().describe('Trail or resource ID to inspect'),
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.union([trailDetailOutput, provisionDetailOutput]),
});
