import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { verifyCurrentTopo } from './topo-read-support.js';

export const topoVerifyTrail = trail('topo.verify', {
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
      return await verifyCurrentTopo(lease.app, { rootDir });
    } finally {
      lease.release();
    }
  },
  description: 'Verify that the committed lockfile matches the current topo',
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'read',
  output: z.object({
    committedHash: z.string(),
    currentHash: z.string(),
    lockPath: z.string(),
    stale: z.literal(false),
  }),
});
