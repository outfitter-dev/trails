import { z } from 'zod';

import { Result, ValidationError } from '@ontrails/core';
import type { WorkspaceView } from '@ontrails/topography';

import type {
  OperatorAppProjectContext,
  OperatorModuleSource,
  OperatorProjectContext,
  OperatorSelectionProvenance,
  OperatorWorkspaceProjectContext,
} from './project-context.js';

const moduleSourceSchema = z.enum(['config', 'convention', 'module']);
const selectionProvenanceSchema = z.enum(['app', 'cwd', 'root-dir']);

const projectAppBaseSchema = z.object({
  appRoot: z.string(),
  artifactPath: z.string(),
  modulePath: z.string(),
  moduleSource: moduleSourceSchema,
});

const projectAppSchema = projectAppBaseSchema.extend({
  appId: z.string(),
});

const configuredProjectAppSchema = projectAppSchema
  .extend({ configured: z.literal(true) })
  .strict();

const standaloneProjectAppSchema = projectAppBaseSchema
  .extend({ configured: z.literal(false) })
  .strict();

const projectContextBase = {
  configuredAppIds: z.array(z.string()),
  projectRoot: z.string(),
  selectionProvenance: selectionProvenanceSchema,
} as const;

const appProjectSelectionShape = {
  ...projectContextBase,
  ...projectAppSchema.shape,
  completeness: z.literal('complete'),
} as const;

export const configuredAppProjectSelectionSchema = z.object({
  ...appProjectSelectionShape,
  selectedExtent: z.literal('configured-app'),
});

export const standaloneAppProjectSelectionSchema = z.object({
  ...appProjectSelectionShape,
  selectedExtent: z.literal('standalone-app'),
});

export const appProjectSelectionSchema = z.discriminatedUnion(
  'selectedExtent',
  [configuredAppProjectSelectionSchema, standaloneAppProjectSelectionSchema]
);

export const workspaceProjectSelectionSchema = z.object({
  ...projectContextBase,
  apps: z.array(
    projectAppSchema.extend({
      binding: z.literal('matched'),
      freshness: z.literal('fresh'),
      status: z.literal('available'),
    })
  ),
  completeness: z.literal('complete'),
  selectedExtent: z.literal('workspace'),
  workspaceViewHash: z.string(),
});

export const operatorProjectContextOutputSchema = z
  .discriminatedUnion('selectedExtent', [
    z.object({
      ...projectContextBase,
      app: configuredProjectAppSchema,
      selectedExtent: z.literal('configured-app'),
    }),
    z.object({
      ...projectContextBase,
      app: standaloneProjectAppSchema,
      configuredAppIds: z.tuple([]),
      selectedExtent: z.literal('standalone-app'),
      selectionProvenance: z.enum(['cwd', 'root-dir']),
    }),
    z.object({
      ...projectContextBase,
      apps: z.array(configuredProjectAppSchema),
      selectedExtent: z.literal('workspace'),
      selectionProvenance: z.enum(['cwd', 'root-dir']),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.selectedExtent === 'configured-app') {
      if (!value.configuredAppIds.includes(value.app.appId)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'The selected configured app must be named in configuredAppIds.',
          path: ['configuredAppIds'],
        });
      }
      return;
    }
    if (value.selectedExtent !== 'workspace') {
      return;
    }
    const appIds = value.apps.map((app) => app.appId).toSorted();
    const configuredAppIds = [...value.configuredAppIds].toSorted();
    if (JSON.stringify(appIds) !== JSON.stringify(configuredAppIds)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Workspace apps must exactly match configuredAppIds.',
        path: ['apps'],
      });
    }
  });

export type OperatorProjectContextOutput = z.output<
  typeof operatorProjectContextOutputSchema
>;

export type ConfiguredAppProjectSelection = z.output<
  typeof configuredAppProjectSelectionSchema
>;
export type StandaloneAppProjectSelection = z.output<
  typeof standaloneAppProjectSelectionSchema
>;
export type AppProjectSelection =
  | ConfiguredAppProjectSelection
  | StandaloneAppProjectSelection;
export type WorkspaceProjectSelection = z.output<
  typeof workspaceProjectSelectionSchema
>;

const configuredIds = (
  context: OperatorAppProjectContext | OperatorWorkspaceProjectContext
): string[] => context.identity.apps.map((app) => app.id).toSorted();

const configuredProjectApp = (
  app: OperatorAppProjectContext['app']
): z.output<typeof configuredProjectAppSchema> => ({
  appId: app.id as string,
  appRoot: app.root,
  artifactPath: app.lockPath,
  configured: true,
  modulePath: app.modulePath,
  moduleSource: app.moduleSource,
});

const standaloneProjectApp = (
  app: OperatorAppProjectContext['app']
): z.output<typeof standaloneProjectAppSchema> => ({
  appRoot: app.root,
  artifactPath: app.lockPath,
  configured: false,
  modulePath: app.modulePath,
  moduleSource: app.moduleSource,
});

export const operatorProjectContextOutput = (
  context: OperatorProjectContext
): OperatorProjectContextOutput => {
  const base = {
    configuredAppIds: context.identity.apps.map((app) => app.id).toSorted(),
    projectRoot: context.projectRoot,
    selectionProvenance: context.selectionProvenance,
  } as const;
  if (context.selectedExtent === 'workspace') {
    return {
      ...base,
      apps: context.apps.map(configuredProjectApp),
      selectedExtent: 'workspace',
      selectionProvenance: context.selectionProvenance as 'cwd' | 'root-dir',
    };
  }
  if (context.selectedExtent === 'standalone-app') {
    return {
      app: standaloneProjectApp(context.app),
      configuredAppIds: [],
      projectRoot: context.projectRoot,
      selectedExtent: 'standalone-app',
      selectionProvenance: context.selectionProvenance as 'cwd' | 'root-dir',
    };
  }
  return {
    ...base,
    app: configuredProjectApp(context.app),
    selectedExtent: 'configured-app',
  };
};

const appProjectSelectionBase = (
  context: OperatorAppProjectContext,
  actualAppId: string
): Omit<AppProjectSelection, 'selectedExtent'> => ({
  appId: actualAppId,
  appRoot: context.app.root,
  artifactPath: context.app.lockPath,
  completeness: 'complete',
  configuredAppIds: configuredIds(context),
  modulePath: context.app.modulePath,
  moduleSource: context.app.moduleSource as OperatorModuleSource,
  projectRoot: context.projectRoot,
  selectionProvenance:
    context.selectionProvenance as OperatorSelectionProvenance,
});

export const configuredAppProjectSelection = (
  context: OperatorAppProjectContext,
  actualAppId: string
): ConfiguredAppProjectSelection => ({
  ...appProjectSelectionBase(context, actualAppId),
  selectedExtent: 'configured-app',
});

export const standaloneAppProjectSelection = (
  context: OperatorAppProjectContext,
  actualAppId: string
): StandaloneAppProjectSelection => ({
  ...appProjectSelectionBase(context, actualAppId),
  selectedExtent: 'standalone-app',
});

export const appProjectSelection = (
  context: OperatorAppProjectContext,
  actualAppId: string
): AppProjectSelection =>
  context.selectedExtent === 'configured-app'
    ? configuredAppProjectSelection(context, actualAppId)
    : standaloneAppProjectSelection(context, actualAppId);

export const workspaceProjectSelection = (
  context: OperatorWorkspaceProjectContext,
  view: WorkspaceView
): Result<WorkspaceProjectSelection, ValidationError> => {
  if (
    view.workspaceViewHash === null ||
    view.evidence.configuredCompleteness !== 'complete'
  ) {
    return Result.err(
      new ValidationError(
        'A workspace selection requires a complete workspace view.',
        {
          context: {
            completeness: view.evidence.configuredCompleteness,
            projectRoot: context.projectRoot,
            reason: 'workspace-incomplete',
          },
        }
      )
    );
  }
  const observations = new Map(
    view.evidence.apps.map((observation) => [observation.id, observation])
  );
  const apps: WorkspaceProjectSelection['apps'][number][] = [];
  for (const app of context.apps) {
    const observation = observations.get(app.id as string);
    if (
      observation?.binding !== 'matched' ||
      observation.freshness !== 'fresh' ||
      observation.status !== 'available'
    ) {
      return Result.err(
        new ValidationError(
          `Workspace app ${String(app.id)} is not complete and fresh.`,
          {
            context: {
              appId: app.id,
              evidence: observation,
              projectRoot: context.projectRoot,
              reason: 'workspace-incomplete',
            },
          }
        )
      );
    }
    apps.push({
      appId: app.id as string,
      appRoot: app.root,
      artifactPath: app.lockPath,
      binding: observation.binding,
      freshness: observation.freshness,
      modulePath: app.modulePath,
      moduleSource: app.moduleSource,
      status: observation.status,
    });
  }
  return Result.ok({
    apps,
    completeness: 'complete',
    configuredAppIds: configuredIds(context),
    projectRoot: context.projectRoot,
    selectedExtent: 'workspace',
    selectionProvenance: context.selectionProvenance,
    workspaceViewHash: view.workspaceViewHash,
  });
};
