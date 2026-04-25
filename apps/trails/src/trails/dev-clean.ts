import { Result, ValidationError, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  cleanDevState,
  DEFAULT_TOPO_SNAPSHOT_RETENTION,
} from './dev-support.js';
import { createIsolatedExampleInput } from './topo-support.js';

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
        maxAge: input.traceAgeMs,
        maxRecords: input.traces,
        rootDir,
        snapshotRetention: input.snapshots,
      })
    );
  },
  description: 'Prune unpinned topo snapshots and old trace records',
  examples: [
    {
      input: {
        dryRun: true,
        rootDir: createIsolatedExampleInput('dev-clean').rootDir,
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
    snapshots: z
      .number()
      .default(DEFAULT_TOPO_SNAPSHOT_RETENTION)
      .describe('Unpinned topo snapshots to retain'),
    traceAgeMs: z
      .number()
      .default(7 * 24 * 60 * 60 * 1000)
      .describe('Maximum retained trace age in milliseconds'),
    traces: z.number().default(10_000).describe('Maximum retained trace count'),
    yes: z.boolean().default(false).describe('Confirm destructive changes'),
  }),
  intent: 'destroy',
  output: z.object({
    dryRun: z.boolean(),
    remaining: z.object({
      pinnedCount: z.number(),
      snapshotCount: z.number(),
      traceCount: z.number(),
    }),
    removed: z.object({
      topoSnapshots: z.number(),
      traceRecords: z.number(),
    }),
    retention: z.object({
      snapshots: z.number(),
      traceAgeMs: z.number(),
      traces: z.number(),
    }),
  }),
  permit: { scopes: ['dev:clean'] },
});
