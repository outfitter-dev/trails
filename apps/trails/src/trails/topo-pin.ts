import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { withFreshOperatorApp } from './operator-context.js';
import {
  createIsolatedExampleInput,
  pinCurrentTopoSnapshot,
  topoSnapshotOutput,
} from './topo-support.js';

export const topoPinTrail = trail('topo.pin', {
  blaze: async (input, ctx) =>
    withFreshOperatorApp(input, ctx, ({ lease, rootDir }) =>
      Result.ok(
        pinCurrentTopoSnapshot(lease.app, { name: input.name, rootDir })
      )
    ),
  description: 'Pin the current topo under a durable name',
  examples: [
    {
      input: {
        ...createIsolatedExampleInput('topo-pin'),
        name: 'before-auth-refactor',
      },
      name: 'Pin the current topo',
    },
  ],
  input: z.object({
    module: z.string().optional().describe('Path to the app module'),
    name: z.string().describe('Pin name'),
    rootDir: z.string().optional().describe('Workspace root directory'),
  }),
  intent: 'write',
  output: z.object({
    snapshot: topoSnapshotOutput,
  }),
  permit: { scopes: ['topo:write'] },
});
