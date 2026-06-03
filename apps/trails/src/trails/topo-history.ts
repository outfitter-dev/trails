import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  DEFAULT_TOPO_HISTORY_LIMIT,
  createIsolatedExampleInput,
  listTopoHistory,
  topoSnapshotOutput,
} from './topo-support.js';
import { resolveTrailRootDir } from './root-dir.js';

const topoHistoryTrailInputSchema = z.object({
  limit: z
    .number()
    .default(DEFAULT_TOPO_HISTORY_LIMIT)
    .describe('Maximum number of snapshots to return'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

type TopoHistoryTrailInput = z.output<typeof topoHistoryTrailInputSchema>;

export const topoHistoryTrail = trail('topo.history', {
  blaze: (input: TopoHistoryTrailInput, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const rootDir = rootDirResult.value;
    return Result.ok(listTopoHistory({ limit: input.limit, rootDir }));
  },
  description: 'List saved topo snapshots, including pinned references',
  examples: [
    {
      input: createIsolatedExampleInput('topo-history'),
      name: 'Show topo history',
    },
  ],
  input: topoHistoryTrailInputSchema,
  intent: 'read',
  output: z.object({
    dbPath: z.string(),
    limit: z.number(),
    pinnedCount: z.number(),
    snapshotCount: z.number(),
    snapshots: z.array(topoSnapshotOutput),
  }),
});
