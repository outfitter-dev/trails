import { trail } from '@ontrails/core';
import type { CliCommandAliasInput, Result, Topo } from '@ontrails/core';
import { z } from 'zod';

import { withFreshOperatorApp } from './operator-context.js';
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
  blaze: async (input: CompileTrailInput, ctx) =>
    withFreshOperatorApp(input, ctx, ({ lease, rootDir }) =>
      compileCurrentTopo(lease.app, {
        cliAliases: lease.cliAliases,
        force: input.force,
        rootDir,
      })
    ),
  description: 'Compile the current topo to trails.lock',
  examples: [
    {
      input: createIsolatedExampleInput('compile'),
      name: 'Compile the current topo to trails.lock',
    },
  ],
  input: compileTrailInputSchema,
  intent: 'write',
  output: z.object({
    hash: z.string(),
    lockPath: z.string(),
    snapshot: topoSnapshotOutput,
  }),
  permit: { scopes: ['topo:write'] },
});
