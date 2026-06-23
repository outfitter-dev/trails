import { trail } from '@ontrails/core';
import { z } from 'zod';

import { withFreshOperatorApp } from './operator-context.js';
import { validateCurrentTopo } from './topo-read-support.js';

export const validateTrail = trail('validate', {
  blaze: async (input, ctx) =>
    withFreshOperatorApp(input, ctx, ({ lease, rootDir }) =>
      validateCurrentTopo(lease.app, {
        cliAliases: lease.cliAliases,
        rootDir,
      })
    ),
  description: 'Validate that root trails.lock matches the current topo',
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
