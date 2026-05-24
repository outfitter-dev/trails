import { trail } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { validateCurrentTopo } from './topo-read-support.js';

export const validateTrail = trail('validate', {
  blaze: async (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }
    const rootDir = rootDirResult.value;
    const leaseResult = await tryLoadFreshAppLease(input.module, rootDir);
    if (leaseResult.isErr()) {
      return leaseResult;
    }
    const lease = leaseResult.value;
    try {
      return await validateCurrentTopo(lease.app, { rootDir });
    } finally {
      lease.release();
    }
  },
  description: 'Validate that committed topo artifacts match the current topo',
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
