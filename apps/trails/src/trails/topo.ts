import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { buildTopoSummary } from './topo-read-support.js';
import { DEFAULT_APP_MODULE } from './topo-support.js';

const summaryOutput = z.object({
  app: z.object({
    contractVersion: z.string(),
    features: z.object({
      detours: z.boolean(),
      examples: z.boolean(),
      outputSchemas: z.boolean(),
      resources: z.boolean(),
      signals: z.boolean(),
    }),
    name: z.string(),
    resources: z.number(),
    signals: z.number(),
    trails: z.number(),
    version: z.string(),
  }),
  dbPath: z.string(),
  list: z.object({
    count: z.number(),
    entries: z.array(
      z.object({
        examples: z.number(),
        id: z.string(),
        kind: z.string(),
        safety: z.string(),
      })
    ),
    resourceCount: z.number(),
    resources: z.array(
      z.object({
        description: z.string().nullable(),
        health: z.enum(['available', 'none']),
        id: z.string(),
        kind: z.literal('resource'),
        lifetime: z.literal('singleton'),
        usedBy: z.array(z.string()),
      })
    ),
  }),
  lockExists: z.boolean(),
  lockPath: z.string(),
});

export const topoTrail = trail('topo', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    return Result.ok(buildTopoSummary(app, { rootDir }));
  },
  description: 'Show the current topo summary and entry list',
  examples: [
    {
      input: {},
      name: 'Show the current topo summary',
    },
  ],
  input: z.object({
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: summaryOutput,
});
