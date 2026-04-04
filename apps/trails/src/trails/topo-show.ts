import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { formatProvisionDetail, generateTrailDetail } from './topo-reports.js';
import { DEFAULT_APP_MODULE } from './topo-support.js';

const trailDetailOutput = z.object({
  crosses: z.array(z.string()),
  description: z.unknown().nullable(),
  detours: z.unknown().nullable(),
  examples: z.array(z.unknown()),
  id: z.string(),
  intent: z.enum(['read', 'write', 'destroy']),
  kind: z.string(),
  provisions: z.array(z.string()),
  safety: z.string(),
});

const provisionDetailOutput = z.object({
  description: z.string().nullable(),
  health: z.enum(['available', 'none']),
  id: z.string(),
  kind: z.literal('provision'),
  lifetime: z.literal('singleton'),
  usedBy: z.array(z.string()),
});

export const topoShowTrail = trail('topo.show', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    const item = app.get(input.id);

    if (item) {
      return Result.ok(generateTrailDetail(item));
    }
    if (app.getProvision(input.id)) {
      return Result.ok(formatProvisionDetail(app, input.id));
    }
    return Result.err(
      new NotFoundError(`Trail or provision not found: ${input.id}`)
    );
  },
  description: 'Show detail for a current trail or provision',
  examples: [
    {
      input: { id: 'topo' },
      name: 'Show current trail detail',
    },
  ],
  input: z.object({
    id: z.string().describe('Trail or provision ID to inspect'),
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.union([trailDetailOutput, provisionDetailOutput]),
});
