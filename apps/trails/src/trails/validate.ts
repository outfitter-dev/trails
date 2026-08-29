import { Result, trail, ValidationError } from '@ontrails/core';
import type { Result as TrailResult } from '@ontrails/core';
import { deriveWorkspaceView } from '@ontrails/topography';
import { z } from 'zod';

import { withFreshAppLease } from './operator-context.js';
import type {
  OperatorAppProjectContext,
  OperatorProjectApp,
  OperatorWorkspaceProjectContext,
} from './project-context.js';
import {
  assertConfiguredAppBinding,
  assertObservableProjectApps,
  resolveOperatorAppModuleContext,
  resolveOperatorProjectContext,
} from './project-context.js';
import {
  configuredAppProjectSelection,
  configuredAppProjectSelectionSchema,
  standaloneAppProjectSelection,
  standaloneAppProjectSelectionSchema,
  workspaceProjectSelection,
  workspaceProjectSelectionSchema,
} from './project-context-output.js';
import { validateCurrentTopo } from './topo-read-support.js';

const validateTrailInputSchema = z.object({
  app: z.string().optional().describe('Configured workspace app ID'),
  module: z.string().optional().describe('Path to the app module'),
  rootDir: z.string().optional().describe('Workspace root directory'),
});

type ValidateTrailInput = z.output<typeof validateTrailInputSchema>;

const appValidationOutputShape = {
  committedHash: z.string(),
  currentHash: z.string(),
  lockPath: z.string(),
  stale: z.literal(false),
} as const;

const configuredAppValidationOutputSchema = z.object({
  ...appValidationOutputShape,
  project: configuredAppProjectSelectionSchema,
  selectedExtent: z.literal('configured-app'),
});

const standaloneAppValidationOutputSchema = z.object({
  ...appValidationOutputShape,
  project: standaloneAppProjectSelectionSchema,
  selectedExtent: z.literal('standalone-app'),
});

const workspaceAppValidationSchema = z.object({
  appId: z.string(),
  committedHash: z.string(),
  currentHash: z.string(),
  lockPath: z.string(),
  stale: z.literal(false),
});

const workspaceValidationOutputSchema = z.object({
  apps: z.array(workspaceAppValidationSchema),
  project: workspaceProjectSelectionSchema,
  selectedExtent: z.literal('workspace'),
  stale: z.literal(false),
  workspaceViewHash: z.string(),
});

const validateTrailOutputSchema = z.discriminatedUnion('selectedExtent', [
  configuredAppValidationOutputSchema,
  standaloneAppValidationOutputSchema,
  workspaceValidationOutputSchema,
]);

type ValidateTrailOutput = z.output<typeof validateTrailOutputSchema>;
type AppValidationOutput = z.output<
  | typeof configuredAppValidationOutputSchema
  | typeof standaloneAppValidationOutputSchema
>;
type WorkspaceAppValidation = z.output<typeof workspaceAppValidationSchema>;

const forbiddenWorkspaceAggregateLocks = (view: {
  readonly evidence: {
    readonly unownedLocks: readonly { readonly kind: string }[];
  };
}): readonly { readonly kind: string }[] =>
  view.evidence.unownedLocks.filter(
    (lock) => lock.kind === 'forbidden-workspace-aggregate'
  );

const appContext = (
  workspace: OperatorWorkspaceProjectContext,
  app: OperatorProjectApp
): OperatorAppProjectContext => ({
  app,
  boundaryDir: workspace.boundaryDir,
  identity: workspace.identity,
  projectRoot: workspace.projectRoot,
  selectedExtent: 'configured-app',
  selectionProvenance: workspace.selectionProvenance,
});

const assertValidatedConfiguredAppBinding = async (
  context: OperatorAppProjectContext,
  committedHash: string
): Promise<TrailResult<void, ValidationError>> => {
  const expectedAppId = context.app.id;
  if (expectedAppId === undefined) {
    return Result.ok();
  }
  try {
    const view = await deriveWorkspaceView({
      currentAppGraphHashes: { [expectedAppId]: committedHash },
      identity: context.identity,
      selectedAppIds: [expectedAppId],
    });
    const observation = view.evidence.apps.find(
      (app) => app.id === expectedAppId
    );
    const forbiddenAggregateLocks = forbiddenWorkspaceAggregateLocks(view);
    if (
      observation?.binding === 'matched' &&
      observation.freshness === 'fresh' &&
      observation.status === 'available' &&
      forbiddenAggregateLocks.length === 0
    ) {
      return Result.ok();
    }
    return Result.err(
      new ValidationError(
        `Configured app "${expectedAppId}" is bound to a contradictory saved lock. ${observation?.detail ?? 'No matching lock observation is available.'}`,
        {
          context: {
            actualAppId: observation?.actualAppId,
            expectedAppId,
            freshness: observation?.freshness,
            lockPath: context.app.lockPath,
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
            status: observation?.status,
            unownedLocks: view.evidence.unownedLocks,
          },
        }
      )
    );
  } catch (error) {
    return Result.err(
      new ValidationError(
        `Unable to prove the saved lock binding for configured app "${expectedAppId}".`,
        {
          ...(error instanceof Error ? { cause: error } : {}),
          context: {
            detail: error instanceof Error ? error.message : String(error),
            expectedAppId,
            lockPath: context.app.lockPath,
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
};

const validateAppProject = async (
  context: OperatorAppProjectContext,
  options: { readonly validateArtifactBinding?: boolean } = {}
): Promise<TrailResult<AppValidationOutput, Error>> => {
  const moduleContext = resolveOperatorAppModuleContext(context);
  if (moduleContext.isErr()) {
    return moduleContext;
  }
  const selectedContext = moduleContext.value;
  return withFreshAppLease<AppValidationOutput>(
    selectedContext.app.modulePath,
    selectedContext.app.rootDir,
    async (lease) => {
      const binding = assertConfiguredAppBinding(
        selectedContext,
        lease.app.name
      );
      if (binding.isErr()) {
        return binding;
      }
      const validated = await validateCurrentTopo(lease.app, {
        overlays: lease.overlays,
        rootDir: selectedContext.app.rootDir,
      });
      if (validated.isErr()) {
        return validated;
      }
      if (options.validateArtifactBinding !== false) {
        const artifactBinding = await assertValidatedConfiguredAppBinding(
          selectedContext,
          validated.value.committedHash
        );
        if (artifactBinding.isErr()) {
          return artifactBinding;
        }
      }
      return selectedContext.selectedExtent === 'configured-app'
        ? Result.ok({
            ...validated.value,
            project: configuredAppProjectSelection(
              selectedContext,
              lease.app.name
            ),
            selectedExtent: 'configured-app',
          })
        : Result.ok({
            ...validated.value,
            project: standaloneAppProjectSelection(
              selectedContext,
              lease.app.name
            ),
            selectedExtent: 'standalone-app',
          });
    }
  );
};

const workspaceValidationError = (
  message: string,
  context: Record<string, unknown>,
  cause?: Error
): ValidationError =>
  new ValidationError(message, {
    ...(cause === undefined ? {} : { cause }),
    context: { ...context, reason: 'workspace-incomplete' },
  });

const validateWorkspaceProject = async (
  context: OperatorWorkspaceProjectContext
): Promise<TrailResult<ValidateTrailOutput, Error>> => {
  const results: WorkspaceAppValidation[] = [];
  for (const app of context.apps) {
    const validated = await validateAppProject(appContext(context, app), {
      validateArtifactBinding: false,
    });
    if (validated.isErr()) {
      return Result.err(
        workspaceValidationError(
          `Workspace app "${String(app.id)}" failed validation: ${validated.error.message}`,
          {
            appId: app.id,
            configuredAppIds: context.apps.map((item) => item.id),
            projectRoot: context.projectRoot,
            unownedLocks:
              validated.error instanceof ValidationError
                ? validated.error.context?.['unownedLocks']
                : undefined,
          },
          validated.error
        )
      );
    }
    results.push({
      appId: app.id as string,
      committedHash: validated.value.committedHash,
      currentHash: validated.value.currentHash,
      lockPath: app.lockPath,
      stale: false,
    });
  }

  const view = await deriveWorkspaceView({
    currentAppGraphHashes: Object.fromEntries(
      results.map((result) => [result.appId, result.committedHash])
    ),
    identity: context.identity,
  });
  const incomplete = view.evidence.apps.filter(
    (app) =>
      app.binding !== 'matched' ||
      app.freshness !== 'fresh' ||
      app.status !== 'available'
  );
  const forbiddenAggregateLocks = forbiddenWorkspaceAggregateLocks(view);
  if (
    view.workspaceViewHash === null ||
    view.evidence.configuredCompleteness !== 'complete' ||
    incomplete.length > 0 ||
    forbiddenAggregateLocks.length > 0
  ) {
    return Result.err(
      workspaceValidationError(
        'Workspace validation cannot claim completeness because app evidence is incomplete, stale, invalid, or contradictory.',
        {
          appEvidence: view.evidence.apps,
          collectionSkips: view.evidence.collectionSkips,
          completeness: view.evidence.configuredCompleteness,
          configuredAppIds: view.evidence.configuredAppIds,
          projectRoot: context.projectRoot,
          unownedLocks: view.evidence.unownedLocks,
        }
      )
    );
  }
  const project = workspaceProjectSelection(context, view);
  if (project.isErr()) {
    return project;
  }
  return Result.ok({
    apps: results,
    project: project.value,
    selectedExtent: 'workspace',
    stale: false,
    workspaceViewHash: project.value.workspaceViewHash,
  });
};

const validateSelectedProject = async (
  input: ValidateTrailInput,
  cwd: string | undefined
): Promise<TrailResult<ValidateTrailOutput, Error>> => {
  try {
    const contextResult = await resolveOperatorProjectContext(input, { cwd });
    if (contextResult.isErr()) {
      return contextResult;
    }
    const context = contextResult.value;
    const observable = await assertObservableProjectApps(context);
    if (observable.isErr()) {
      return observable;
    }
    return context.selectedExtent === 'workspace'
      ? await validateWorkspaceProject(context)
      : await validateAppProject(context);
  } catch (error) {
    return Result.err(
      error instanceof Error
        ? error
        : new ValidationError('Unable to validate project context.', {
            context: { detail: String(error) },
          })
    );
  }
};

export const validateTrail = trail('validate', {
  description: 'Validate selected app or workspace locks against current topos',
  implementation: async (input, ctx) => validateSelectedProject(input, ctx.cwd),
  input: validateTrailInputSchema,
  intent: 'read',
  output: validateTrailOutputSchema,
});
