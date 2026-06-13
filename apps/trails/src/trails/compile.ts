import { trail } from '@ontrails/core';
import type { CliCommandAliasInput, Result, Topo } from '@ontrails/core';
import { z } from 'zod';

import { tryLoadFreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';
import { exportCurrentTopo } from './topo-store-support.js';
import type { TopoExportReport } from './topo-support.js';
import {
  createIsolatedExampleInput,
  topoSnapshotOutput,
} from './topo-support.js';

export const compileCurrentTopo = async (
  app: Topo,
  options?: {
    readonly cliAliases?:
      | Readonly<Record<string, readonly CliCommandAliasInput[]>>
      | undefined;
    readonly force?: boolean | undefined;
    readonly rootDir?: string;
  }
): Promise<Result<TopoExportReport, Error>> => exportCurrentTopo(app, options);

const compileTrailInputSchema = z.object({
  force: z
    .boolean()
    .optional()
    .describe('Record graph-only force events for breaking changes'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

type CompileTrailInput = z.output<typeof compileTrailInputSchema>;

export const compileTrail = trail('compile', {
  blaze: async (input: CompileTrailInput, ctx) => {
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
      return await compileCurrentTopo(lease.app, {
        cliAliases: lease.cliAliases,
        force: input.force,
        rootDir,
      });
    } finally {
      lease.release();
    }
  },
  description: 'Compile the current topo to .trails artifacts',
  examples: [
    {
      input: createIsolatedExampleInput('compile'),
      name: 'Compile the current topo artifacts',
    },
  ],
  input: compileTrailInputSchema,
  intent: 'write',
  output: z.object({
    hash: z.string(),
    lockPath: z.string(),
    snapshot: topoSnapshotOutput,
    topoPath: z.string(),
  }),
  permit: { scopes: ['topo:write'] },
});
