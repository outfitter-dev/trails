import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { loadApp } from './load-app.js';
import {
  DEFAULT_APP_MODULE,
  isolatedExampleInput,
  pinCurrentTopo,
  topoPinOutput,
  topoSaveOutput,
} from './topo-support.js';

export const topoPinTrail = trail('topo.pin', {
  blaze: async (input, ctx) => {
    const rootDir = input.rootDir ?? ctx.cwd ?? process.cwd();
    const app = await loadApp(input.module, rootDir);
    return Result.ok(pinCurrentTopo(app, { name: input.name, rootDir }));
  },
  description: 'Pin the current topo under a durable name',
  examples: [
    {
      input: {
        ...isolatedExampleInput('topo-pin'),
        name: 'before-auth-refactor',
      },
      name: 'Pin the current topo',
    },
  ],
  input: z.object({
    module: z
      .string()
      .default(DEFAULT_APP_MODULE)
      .describe('Path to the app module'),
    name: z.string().describe('Pin name'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: z.object({
    pin: topoPinOutput,
    save: topoSaveOutput,
  }),
});
