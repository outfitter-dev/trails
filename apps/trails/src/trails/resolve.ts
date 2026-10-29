import {
  ConflictError,
  deriveSafePath,
  InternalError,
  Result,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { writeContainedProjectPath } from '../project-writes.js';

import { withFreshAppLease } from './operator-context.js';
import {
  assertConfiguredAppBinding,
  assertObservableProjectApps,
  resolveOperatorAppModuleContext,
  resolveOperatorProjectContext,
} from './project-context.js';
import type {
  OperatorAppProjectContext,
  OperatorProjectContext,
  OperatorProjectContextInput,
} from './project-context.js';
import {
  appProjectSelection,
  appProjectSelectionSchema,
} from './project-context-output.js';
import { deriveResolvedLock } from './resolve-current.js';
import { readResolveLockEvidence } from './resolve-evidence.js';

const resolveInputSchema = z.object({
  app: z.string().optional().describe('Configured workspace app ID'),
  configPath: z.string().optional().describe('Explicit project config path'),
  force: z
    .boolean()
    .optional()
    .describe(
      'Record genuine breaking changes using existing force governance'
    ),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('App or workspace root directory'),
});

const resolvedArtifactSchema = z.object({
  hash: z.string(),
  lockPath: z.string(),
  project: appProjectSelectionSchema,
  sources: z.array(z.enum(['ours', 'theirs', 'base', 'worktree'])),
});

const resolveOutputSchema = z.object({
  artifacts: z.array(resolvedArtifactSchema),
});

type ResolvedArtifact = z.output<typeof resolvedArtifactSchema>;

interface PreparedArtifact {
  readonly content: string;
  readonly originalContent: string;
  readonly report: ResolvedArtifact;
  readonly rootDir: string;
}

const selectedApps = (
  context: OperatorProjectContext
): readonly OperatorAppProjectContext[] =>
  context.selectedExtent === 'workspace'
    ? context.apps.map((app) => ({
        ...context,
        app,
        selectedExtent: 'configured-app' as const,
      }))
    : [context];

const prepareArtifact = async (
  context: OperatorAppProjectContext,
  force: boolean | undefined
): Promise<Result<PreparedArtifact, Error>> => {
  const moduleContext = resolveOperatorAppModuleContext(context);
  if (moduleContext.isErr()) {
    return moduleContext;
  }
  const selected = moduleContext.value;
  const safePath = deriveSafePath(selected.app.rootDir, 'trails.lock');
  if (safePath.isErr()) {
    return safePath;
  }
  const evidence = await readResolveLockEvidence(safePath.value);
  if (evidence.isErr()) {
    return evidence;
  }
  return withFreshAppLease(
    selected.app.modulePath,
    selected.app.rootDir,
    (lease) => {
      const binding = assertConfiguredAppBinding(selected, lease.app.name);
      if (binding.isErr()) {
        return binding;
      }
      const gitParents = evidence.value.parents.filter(
        (_, index) => evidence.value.sources[index] !== 'worktree'
      );
      const tips = evidence.value.parents.filter(
        (_, index) =>
          evidence.value.sources[index] === 'ours' ||
          evidence.value.sources[index] === 'theirs'
      );
      const base = evidence.value.parents.find(
        (_, index) => evidence.value.sources[index] === 'base'
      );
      const recovered = deriveResolvedLock(
        lease.app,
        gitParents.length > 0 ? gitParents : evidence.value.parents,
        {
          base,
          force,
          overlays: lease.overlays,
          rootDir: selected.app.rootDir,
          tips: tips.length > 0 ? tips : evidence.value.parents,
          worktreeLock: evidence.value.worktreeLock,
        }
      );
      return recovered.isErr()
        ? recovered
        : Result.ok({
            content: `${JSON.stringify(recovered.value, null, 2)}\n`,
            originalContent: evidence.value.originalContent,
            report: {
              hash: recovered.value.topoGraphHash,
              lockPath: safePath.value,
              project: appProjectSelection(selected, lease.app.name),
              sources: [...evidence.value.sources],
            },
            rootDir: selected.app.rootDir,
          });
    }
  );
};

/** Recover only selected generated app locks; never stage or rewrite Git state. */
export const resolveProjectLocks = async (
  input: OperatorProjectContextInput & { readonly force?: boolean | undefined },
  cwd?: string
): Promise<Result<z.output<typeof resolveOutputSchema>, Error>> => {
  try {
    const context = await resolveOperatorProjectContext(input, { cwd });
    if (context.isErr()) {
      return context;
    }
    const observable = await assertObservableProjectApps(context.value);
    if (observable.isErr()) {
      return observable;
    }
    const prepared: PreparedArtifact[] = [];
    for (const selected of selectedApps(context.value)) {
      const artifact = await prepareArtifact(selected, input.force);
      if (artifact.isErr()) {
        return artifact;
      }
      prepared.push(artifact.value);
    }
    // Finish every evidence/source preflight before writing any selected app.
    for (const artifact of prepared) {
      const current = await Bun.file(artifact.report.lockPath).text();
      if (current !== artifact.originalContent) {
        return Result.err(
          new ConflictError(
            `Lock changed during resolve: ${artifact.report.lockPath}. Stop the other writer and retry trails resolve.`
          )
        );
      }
    }
    for (const artifact of prepared) {
      if (artifact.content === artifact.originalContent) {
        continue;
      }
      const written = await writeContainedProjectPath(
        artifact.rootDir,
        'trails.lock',
        artifact.content
      );
      if (written.isErr()) {
        return written;
      }
    }
    return Result.ok({
      artifacts: prepared.map((artifact) => artifact.report),
    });
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new InternalError('Unable to resolve project locks.', {
            context: { detail: String(error) },
          })
    );
  }
};

export const resolveTrail = trail('resolve', {
  description:
    'Recover generated trails.lock files from resolved sources and verified audit evidence',
  examples: [
    { input: { rootDir: '.' }, name: 'Recover selected project locks' },
  ],
  implementation: async (input, ctx) => resolveProjectLocks(input, ctx.cwd),
  input: resolveInputSchema,
  intent: 'write',
  output: resolveOutputSchema,
  permit: { scopes: ['topo:write'] },
});
