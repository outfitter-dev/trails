import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { buildDevStats, DEFAULT_TOPO_SAVE_RETENTION } from './dev-support.js';
import { isolatedExampleInput } from './topo-support.js';

export const devStatsTrail = trail('dev.stats', {
  blaze: (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    return Result.ok(
      buildDevStats({
        maxAge: input.trackAgeMs,
        maxRecords: input.tracks,
        rootDir,
        saveRetention: input.saves,
      })
    );
  },
  description: 'Show local Trails workspace state and retention',
  examples: [
    {
      input: { rootDir: isolatedExampleInput('dev-stats').rootDir },
      name: 'Show local dev state',
    },
  ],
  input: z.object({
    rootDir: z.string().optional().describe('Workspace root directory'),
    saves: z
      .number()
      .default(DEFAULT_TOPO_SAVE_RETENTION)
      .describe('Unpinned topo saves to retain'),
    trackAgeMs: z
      .number()
      .default(7 * 24 * 60 * 60 * 1000)
      .describe('Maximum retained track age in milliseconds'),
    tracks: z.number().default(10_000).describe('Maximum retained track count'),
  }),
  intent: 'read',
  output: z.object({
    db: z.object({
      exists: z.boolean(),
      fileSizeBytes: z.number(),
      path: z.string(),
    }),
    lock: z.object({
      exists: z.boolean(),
      fileSizeBytes: z.number(),
      path: z.string(),
    }),
    retention: z.object({
      saves: z.number(),
      trackAgeMs: z.number(),
      tracks: z.number(),
    }),
    topo: z.object({
      pinCount: z.number(),
      prunableSaveCount: z.number(),
      saveCount: z.number(),
    }),
    tracker: z.object({
      recordCount: z.number(),
    }),
  }),
});
