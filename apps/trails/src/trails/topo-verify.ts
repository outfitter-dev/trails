import { trail } from '@ontrails/core';
import { z } from 'zod';

import { loadFreshAppLease } from './load-app.js';
import { verifyCurrentTopo } from './topo-read-support.js';

export const topoVerifyTrail = trail('topo.verify', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const lease = await loadFreshAppLease(input.module, rootDir);
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
