import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import {
  DEFAULT_TOPO_HISTORY_LIMIT,
  createIsolatedExampleInput,
  listTopoHistory,
  topoSnapshotOutput,
} from './topo-support.js';
import { resolveTrailRootDir } from './root-dir.js';

export const topoHistoryTrail = trail('topo.history', {
  blaze: (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
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
  input: z.object({
    limit: z
      .number()
      .default(DEFAULT_TOPO_HISTORY_LIMIT)
      .describe('Maximum number of snapshots to return'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.object({
    dbPath: z.string(),
    limit: z.number(),
    pinnedCount: z.number(),
    snapshotCount: z.number(),
    snapshots: z.array(topoSnapshotOutput),
  }),
});
