import { Result, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { exportCurrentTopo } from './topo-store-support.js';
import type { TopoExportReport } from './topo-support.js';
import {
  createIsolatedExampleInput,
  topoSnapshotOutput,
} from './topo-support.js';

export const compileCurrentTopo = async (
  app: Topo,
  options?: { readonly force?: boolean | undefined; readonly rootDir?: string }
): Promise<Result<TopoExportReport, Error>> => exportCurrentTopo(app, options);

export const compileTrail = trail('compile', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return Result.err(rootDirResult.error);
    }
    const rootDir = rootDirResult.value;
    const leaseResult = await tryLoadFreshAppLease(input.module, rootDir);
    if (leaseResult.isErr()) {
      return Result.err(leaseResult.error);
    }
    const lease = leaseResult.value;
    try {
      return await compileCurrentTopo(lease.app, {
        force: input.force,
        rootDir,
      });
    } finally {
      lease.release();
    }
  },
  description: 'Compile the current topo to .trails artifacts',
  examples: [
    {
      input: createIsolatedExampleInput('compile'),
      name: 'Compile the current topo artifacts',
    },
  ],
  input: z.object({
    force: z
      .boolean()
      .optional()
      .describe('Record graph-only force events for breaking changes'),
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: z.object({
    hash: z.string(),
    lockPath: z.string(),
    snapshot: topoSnapshotOutput,
    topoPath: z.string(),
  }),
});
