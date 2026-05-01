import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  buildDevStats,
  DEFAULT_TOPO_SNAPSHOT_RETENTION,
} from './dev-support.js';
import { resolveTrailRootDir } from './root-dir.js';
import { createIsolatedExampleInput } from './topo-support.js';

export const devStatsTrail = trail('dev.stats', {
  blaze: (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    return Result.ok(
      buildDevStats({
        maxAge: input.traceAgeMs,
        maxRecords: input.traces,
        rootDir,
        snapshotRetention: input.snapshots,
      })
    );
  },
  description: 'Show local Trails workspace state and retention',
  examples: [
    {
      input: { rootDir: createIsolatedExampleInput('dev-stats').rootDir },
      name: 'Show local dev state',
    },
  ],
  input: z.object({
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
      snapshots: z.number(),
      traceAgeMs: z.number(),
      traces: z.number(),
    }),
    topo: z.object({
      pinnedCount: z.number(),
      prunableSnapshotCount: z.number(),
      snapshotCount: z.number(),
    }),
    tracing: z.object({
      recordCount: z.number(),
    }),
  }),
});
