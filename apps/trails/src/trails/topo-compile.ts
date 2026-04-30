import { trail } from '@ontrails/core';
import type { Result, Topo } from '@ontrails/core';
import { z } from 'zod';

import { loadFreshAppLease } from './load-app.js';
import { exportCurrentTopo } from './topo-store-support.js';
import type { TopoExportReport } from './topo-support.js';
import {
  createIsolatedExampleInput,
  topoSnapshotOutput,
} from './topo-support.js';

export const compileCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoExportReport, Error>> => exportCurrentTopo(app, options);

export const topoCompileTrail = trail('topo.compile', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const lease = await loadFreshAppLease(input.module, rootDir);
    try {
      return await compileCurrentTopo(lease.app, { rootDir });
    } finally {
      lease.release();
    }
  },
  description: 'Compile the current topo to .trails artifacts',
  examples: [
    {
      input: createIsolatedExampleInput('topo-compile'),
      name: 'Compile the current topo artifacts',
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
