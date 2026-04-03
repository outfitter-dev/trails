import { Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import { cleanDevState, DEFAULT_TOPO_SAVE_RETENTION } from './dev-support.js';
import { isolatedExampleInput } from './topo-support.js';

export const devCleanTrail = trail('dev.clean', {
  blaze: (input, ctx) => {
    if (input.dryRun !== true && input.yes !== true) {
      return Result.err(
        new ValidationError(
          'Refusing to clean local state without `--yes` or `--dry-run`.'
        )
      );
    }

    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    return Result.ok(
      cleanDevState({
        dryRun: input.dryRun,
        maxAge: input.trackAgeMs,
        maxRecords: input.tracks,
        rootDir,
        saveRetention: input.saves,
      })
    );
  },
  description: 'Prune unpinned topo saves and old track records',
  examples: [
    {
      input: {
        dryRun: true,
        rootDir: isolatedExampleInput('dev-clean').rootDir,
      },
      name: 'Preview local cleanup',
    },
  ],
  input: z.object({
    dryRun: z
      .boolean()
      .default(true)
      .describe('Preview cleanup without changing state'),
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
    yes: z.boolean().default(false).describe('Confirm destructive changes'),
  }),
  intent: 'destroy',
  output: z.object({
    dryRun: z.boolean(),
    remaining: z.object({
      pinCount: z.number(),
      saveCount: z.number(),
      trackCount: z.number(),
    }),
    removed: z.object({
      topoSaves: z.number(),
      trackRecords: z.number(),
    }),
    retention: z.object({
      saves: z.number(),
      trackAgeMs: z.number(),
      tracks: z.number(),
    }),
  }),
});
