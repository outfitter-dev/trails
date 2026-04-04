import { trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import {
  DEFAULT_APP_MODULE,
  exportCurrentTopo,
  isolatedExampleInput,
  topoSaveOutput,
} from './topo-support.js';

export const topoExportTrail = trail('topo.export', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    return exportCurrentTopo(app, { rootDir });
  },
  description: 'Export the current topo to .trails artifacts',
  examples: [
    {
      input: isolatedExampleInput('topo-export'),
      name: 'Write the current topo export',
    },
  ],
  input: z.object({
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: z.object({
    hash: z.string(),
    lockPath: z.string(),
    mapPath: z.string(),
    save: topoSaveOutput,
  }),
});
