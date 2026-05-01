import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import {
  createIsolatedExampleInput,
  pinCurrentTopoSnapshot,
  topoSnapshotOutput,
} from './topo-support.js';

export const topoPinTrail = trail('topo.pin', {
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
      return Result.ok(
        pinCurrentTopoSnapshot(lease.app, { name: input.name, rootDir })
      );
    } finally {
      lease.release();
    }
  },
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
});
