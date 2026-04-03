import { trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import { DEFAULT_APP_MODULE, verifyCurrentTopo } from './topo-support.js';

export const topoVerifyTrail = trail('topo.verify', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    return verifyCurrentTopo(app, { rootDir });
  },
  description: 'Verify that the committed lockfile matches the current topo',
  input: z.object({
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
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
