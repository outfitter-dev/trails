import { Result, trail } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import type { TopoGraphOverlayRegistration } from '@ontrails/topography';
import { z } from 'zod';

import { withFreshAppLease } from './operator-context.js';
import {
  assertConfiguredAppBinding,
  assertObservableProjectApps,
  compileNeedsAppError,
  resolveOperatorProjectContext,
} from './project-context.js';
import {
  appProjectSelection,
  appProjectSelectionSchema,
} from './project-context-output.js';
import { exportCurrentTopo } from './topo-store-support.js';
import type { TopoExportReport } from './topo-support.js';
import {
  createIsolatedExampleInput,
  topoSnapshotOutput,
} from './topo-support.js';

export const compileCurrentTopo = async (
  app: Topo,
  options?: {
    readonly force?: boolean | undefined;
    readonly rootDir?: string;
    readonly overlays?: readonly TopoGraphOverlayRegistration[] | undefined;
  }
): Promise<Result<TopoExportReport, Error>> => exportCurrentTopo(app, options);

const compileTrailInputSchema = z.object({
  app: z.string().optional().describe('Configured workspace app ID'),
  force: z
    .boolean()
    .optional()
    .describe('Record graph-only force events for breaking changes'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

type CompileTrailInput = z.output<typeof compileTrailInputSchema>;

const compileTrailOutputSchema = z.object({
  hash: z.string(),
  lockPath: z.string(),
  project: appProjectSelectionSchema,
  snapshot: topoSnapshotOutput,
});

type CompileTrailOutput = z.output<typeof compileTrailOutputSchema>;

const compileSelectedProject = async (
  input: CompileTrailInput,
  cwd: string | undefined
): Promise<Result<CompileTrailOutput, Error>> => {
  const contextResult = await resolveOperatorProjectContext(input, { cwd });
  if (contextResult.isErr()) {
    return contextResult;
  }
  const context = contextResult.value;
  if (context.selectedExtent === 'workspace') {
    return Result.err(compileNeedsAppError(context));
  }
  const observable = await assertObservableProjectApps(context);
  if (observable.isErr()) {
    return observable;
  }
  return withFreshAppLease(
    context.app.modulePath,
    context.app.rootDir,
    async (lease) => {
      const binding = assertConfiguredAppBinding(context, lease.app.name);
      if (binding.isErr()) {
        return binding;
      }
      const compiled = await compileCurrentTopo(lease.app, {
        force: input.force,
        overlays: lease.overlays,
        rootDir: context.app.rootDir,
      });
      return compiled.isErr()
        ? compiled
        : Result.ok({
            ...compiled.value,
            project: appProjectSelection(context, lease.app.name),
          });
    }
  );
};

export const compileTrail = trail('compile', {
  description: 'Compile the current topo to trails.lock',
  examples: [
    {
      input: createIsolatedExampleInput('compile'),
      name: 'Compile the current topo to trails.lock',
    },
  ],
  implementation: async (input: CompileTrailInput, ctx) =>
    compileSelectedProject(input, ctx.cwd),
  input: compileTrailInputSchema,
  intent: 'write',
  output: compileTrailOutputSchema,
  permit: { scopes: ['topo:write'] },
});
