import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { compileCurrentTopo } from './topo-compile.js';
import {
  createIsolatedExampleInput,
  topoSnapshotOutput,
} from './topo-support.js';

export const topoExportTrail = trail('topo.export', {
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
      return await compileCurrentTopo(lease.app, { rootDir });
    } finally {
      lease.release();
    }
  },
  description: 'Legacy alias for compiling the current topo artifacts',
  examples: [
    {
      input: createIsolatedExampleInput('topo-export'),
      name: 'Compile the current topo artifacts through the legacy export alias',
    },
  ],
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: z.object({
    hash: z.string(),
    lockPath: z.string(),
    mapPath: z.string(),
    snapshot: topoSnapshotOutput,
  }),
});
