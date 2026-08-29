import { join } from 'node:path';

import {
  DerivationError,
  NotFoundError,
  Result,
  ValidationError,
  trail,
} from '@ontrails/core';
import type { Result as TrailResult, TrailContext } from '@ontrails/core';
import {
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  deriveWorkspaceView,
  loadWayfinderArtifacts,
  wayfinderDriftFromArtifactStatus,
} from '@ontrails/topography';
import type {
  LockManifest,
  LockManifestSummary,
  TopoGraph,
  WayfinderArtifactLoaderOptions,
  WayfinderStaleReason,
  WorkspaceView,
} from '@ontrails/topography';
import { z } from 'zod';

import {
  assertObservableProjectApps,
  assertSelectedArtifactBinding,
  resolveOperatorProjectContext,
} from './project-context.js';
import type {
  OperatorAppProjectContext,
  OperatorWorkspaceProjectContext,
} from './project-context.js';
import {
  operatorProjectContextOutput,
  operatorProjectContextOutputSchema,
} from './project-context-output.js';

const artifactSourceSchema = z.object({
  kind: z.literal('topoGraph'),
  path: z.string(),
  schemaVersion: z.number(),
});

const artifactDriftSchema = z.object({
  artifacts: z
    .array(z.enum(['lockManifest', 'topoGraph', 'topoStore']))
    .readonly()
    .optional(),
  reasons: z.array(z.record(z.string(), z.unknown())).readonly().optional(),
  status: z.enum(['absent', 'aligned', 'drifted']),
});

const diffEntrySchema = z.object({
  change: z.enum(['added', 'removed', 'modified']),
  details: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.enum(['entity', 'trailhead', 'resource', 'signal', 'trail']),
  severity: z.enum(['info', 'warning', 'breaking']),
});

const topoDiffSchema = z.object({
  breaking: z.array(diffEntrySchema).readonly(),
  entries: z.array(diffEntrySchema).readonly(),
  hasBreaking: z.boolean(),
  info: z.array(diffEntrySchema).readonly(),
  warnings: z.array(diffEntrySchema).readonly(),
});

const artifactEnvelopeSchema = z.object({
  drift: artifactDriftSchema,
  source: artifactSourceSchema,
});

const wayfindDiffInputSchema = z
  .object({
    againstDir: z
      .string()
      .optional()
      .describe('Baseline artifact directory containing trails.lock'),
    againstRootDir: z
      .string()
      .optional()
      .describe('Baseline project root directory'),
    againstTrailsDbPath: z
      .string()
      .optional()
      .describe('Baseline trails.db path'),
    app: z.string().optional().describe('Configured workspace app ID'),
    dir: z
      .string()
      .optional()
      .describe('Current artifact directory containing trails.lock'),
    rootDir: z.string().optional().describe('Current project root directory'),
    trailsDbPath: z.string().optional().describe('Current trails.db path'),
  })
  .strict()
  .refine(
    (input) =>
      input.againstDir !== undefined || input.againstRootDir !== undefined,
    {
      message: 'Provide againstDir or againstRootDir for the baseline graph.',
      path: ['againstDir'],
    }
  )
  .refine(
    (input) =>
      input.againstDir === undefined || input.againstRootDir === undefined,
    {
      message: 'Provide only one of againstDir or againstRootDir.',
      path: ['againstDir'],
    }
  );

const appWayfindDiffOutputSchema = artifactEnvelopeSchema.extend({
  against: artifactEnvelopeSchema,
  diff: topoDiffSchema,
  kind: z.literal('app'),
  project: operatorProjectContextOutputSchema,
});

const workspaceViewEvidenceSchema = z.object({
  apps: z
    .array(
      z.object({
        actualAppId: z.string().optional(),
        binding: z.enum(['matched', 'mismatched', 'unavailable']),
        coaching: z.string().optional(),
        detail: z.string().optional(),
        freshness: z.enum(['fresh', 'stale', 'unknown', 'unavailable']),
        id: z.string(),
        lockPath: z.string(),
        provenance: z.literal('configured-app-lock'),
        root: z.string(),
        selected: z.boolean(),
        status: z.enum(['available', 'invalid', 'missing', 'unavailable']),
      })
    )
    .readonly(),
  collectionSkips: z
    .array(
      z.object({
        path: z.string(),
        provenance: z.literal('source-collection'),
        reason: z.string(),
      })
    )
    .readonly(),
  configuredAppIds: z.array(z.string()).readonly(),
  configuredCompleteness: z.enum(['complete', 'partial']),
  selectedAppIds: z.array(z.string()).readonly(),
  selectedCompleteness: z.enum(['complete', 'partial']),
  unownedLocks: z
    .array(
      z.object({
        coaching: z.string(),
        kind: z.enum([
          'forbidden-workspace-aggregate',
          'unconfigured-app-lock',
        ]),
        path: z.string(),
        provenance: z.literal('source-collection'),
      })
    )
    .readonly(),
});

const workspaceWayfindDiffOutputSchema = z.object({
  against: z.object({
    evidence: workspaceViewEvidenceSchema,
    project: operatorProjectContextOutputSchema,
    workspaceViewHash: z.string(),
  }),
  apps: z.array(
    z.object({
      againstTopoGraphHash: z.string(),
      appId: z.string(),
      currentTopoGraphHash: z.string(),
      diff: topoDiffSchema,
    })
  ),
  current: z.object({
    evidence: workspaceViewEvidenceSchema,
    workspaceViewHash: z.string(),
  }),
  kind: z.literal('workspace'),
  project: operatorProjectContextOutputSchema,
});

const wayfindDiffOutputSchema = z.discriminatedUnion('kind', [
  appWayfindDiffOutputSchema,
  workspaceWayfindDiffOutputSchema,
]);

type WayfindDiffOutput = z.output<typeof wayfindDiffOutputSchema>;
type WayfindDiffInput = z.output<typeof wayfindDiffInputSchema>;

interface LoadedDiffGraph {
  readonly appId: string | undefined;
  readonly envelope: z.output<typeof artifactEnvelopeSchema>;
  readonly graph: TopoGraph;
}

const diffArtifactPath = (
  options: WayfinderArtifactLoaderOptions,
  cwd: string | undefined
): string =>
  join(options.dir ?? options.rootDir ?? cwd ?? process.cwd(), 'trails.lock');

const countEntries = (
  topoGraph: TopoGraph,
  kind: TopoGraph['entries'][number]['kind']
): number => topoGraph.entries.filter((entry) => entry.kind === kind).length;

const summaryMatchesGraph = (
  summary: LockManifestSummary,
  topoGraph: TopoGraph
): boolean =>
  summary.entities === countEntries(topoGraph, 'entity') &&
  summary.resources === countEntries(topoGraph, 'resource') &&
  summary.signals === countEntries(topoGraph, 'signal') &&
  summary.trails === countEntries(topoGraph, 'trail');

/**
 * Report how a saved lock contradicts the evidence its own envelope records.
 *
 * Wayfinder's loader raises the same contradictions as
 * `lock-manifest-hash-mismatch` and `lock-manifest-summary-mismatch` stale
 * reasons, but only once a Topography store is readable beside the lock. Diff
 * baselines are routinely artifact-only directories (`--against-dir`), so the
 * envelope is checked directly here instead. Reasons that only mean the lock
 * lags its source stay diffable; a lock whose recorded hash or summary cannot
 * describe its own graph does not.
 */
const lockIntegrityReason = (
  lockManifest: LockManifest | null,
  topoGraph: TopoGraph
): WayfinderStaleReason['reason'] | undefined => {
  if (lockManifest === null) {
    return undefined;
  }
  const topoArtifact = lockManifest.artifacts.find(
    (artifact) => artifact.role === 'topo'
  );
  if (
    topoArtifact !== undefined &&
    topoArtifact.sha256 !== deriveTopoGraphHash(topoGraph)
  ) {
    return 'lock-manifest-hash-mismatch';
  }
  return summaryMatchesGraph(lockManifest.summary, topoGraph)
    ? undefined
    : 'lock-manifest-summary-mismatch';
};

const loadDiffGraph = async (
  options: WayfinderArtifactLoaderOptions,
  cwd: string | undefined
): Promise<TrailResult<LoadedDiffGraph, Error>> => {
  const path = diffArtifactPath(options, cwd);
  let load: Awaited<ReturnType<typeof loadWayfinderArtifacts>>;
  try {
    load = await loadWayfinderArtifacts(options);
  } catch (error) {
    return Result.err(
      new DerivationError('Unable to load Wayfinder artifacts for diff.', {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { artifact: 'topoGraph', path },
      })
    );
  }
  if (
    load.artifactStatus.status === 'schema-version-drift' &&
    load.artifactStatus.artifact === 'topoGraph'
  ) {
    return Result.err(
      new DerivationError(load.artifactStatus.message, {
        context: {
          artifact: load.artifactStatus.artifact,
          artifactStatus: load.artifactStatus.status,
          path,
        },
      })
    );
  }
  if (load.topoGraph === null) {
    return Result.err(
      new NotFoundError(
        `No Wayfinder TopoGraph artifact found at ${path}. Run \`trails compile\` for the selected app first.`
      )
    );
  }
  const integrityReason = lockIntegrityReason(
    load.lockManifest,
    load.topoGraph
  );
  if (integrityReason !== undefined) {
    return Result.err(
      new DerivationError(
        `Saved Wayfinder artifact at ${path} does not match its recorded lock evidence. Run \`trails compile\` for the selected app before diffing.`,
        {
          context: {
            artifact: 'topoGraph',
            artifactStatus: load.artifactStatus.status,
            path,
            reason: integrityReason,
          },
        }
      )
    );
  }
  return Result.ok({
    appId: load.lockManifest?.scope['app'],
    envelope: {
      drift: wayfinderDriftFromArtifactStatus(load.artifactStatus),
      source: {
        kind: 'topoGraph',
        path,
        schemaVersion: load.topoGraph.topoGraphSchemaVersion,
      },
    },
    graph: load.topoGraph,
  });
};

const assertDiffGraphAppBinding = (
  loaded: LoadedDiffGraph,
  expectedAppId: string,
  artifact: 'baseline' | 'current'
): TrailResult<void, ValidationError> => {
  if (loaded.appId === expectedAppId) {
    return Result.ok();
  }
  return Result.err(
    new ValidationError(
      `Saved ${artifact} artifact for configured app "${expectedAppId}" does not match its Config-owned identity.`,
      {
        context: {
          actualAppId: loaded.appId,
          artifact,
          expectedAppId,
          reason: 'invalid-binding',
        },
      }
    )
  );
};

const currentDiffOptions = (
  input: WayfindDiffInput,
  context: OperatorAppProjectContext
): TrailResult<WayfinderArtifactLoaderOptions, ValidationError> => {
  if (input.dir !== undefined) {
    return Result.err(
      new ValidationError(
        'Diff derives its current artifact from project selection. Remove --dir and use --root-dir to select the current project.',
        {
          context: {
            appId: context.app.id,
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  if (
    context.selectedExtent === 'configured-app' &&
    input.trailsDbPath !== undefined
  ) {
    return Result.err(
      new ValidationError(
        'Configured app diff derives its current artifact from --root-dir and --app. Remove --trails-db-path so it cannot bypass project selection.',
        {
          context: {
            appId: context.app.id,
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  return Result.ok({
    rootDir: context.app.rootDir,
    ...(input.trailsDbPath === undefined ? {} : { path: input.trailsDbPath }),
  });
};

const resolveBaselineApp = async (
  input: WayfindDiffInput,
  current: OperatorAppProjectContext,
  cwd: string | undefined
): Promise<
  TrailResult<
    | {
        readonly context: OperatorAppProjectContext;
        readonly options: WayfinderArtifactLoaderOptions;
      }
    | { readonly options: WayfinderArtifactLoaderOptions },
    Error
  >
> => {
  if (input.againstDir !== undefined) {
    return Result.ok({
      options: {
        dir: input.againstDir,
        ...(input.againstTrailsDbPath === undefined
          ? {}
          : { path: input.againstTrailsDbPath }),
      },
    });
  }
  const baseline = await resolveOperatorProjectContext(
    {
      ...(current.app.id === undefined ? {} : { app: current.app.id }),
      rootDir: input.againstRootDir,
    },
    { cwd }
  );
  if (baseline.isErr()) {
    return baseline;
  }
  if (baseline.value.selectedExtent === 'workspace') {
    return Result.err(
      new ValidationError(
        'One-app diff cannot compare against a workspace extent. Select the same configured app on both project roots.',
        {
          context: {
            appId: current.app.id,
            baselineProjectRoot: baseline.value.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  const observable = await assertObservableProjectApps(baseline.value);
  if (observable.isErr()) {
    return observable;
  }
  const baselineBinding = await assertSelectedArtifactBinding(baseline.value);
  if (baselineBinding.isErr()) {
    return baselineBinding;
  }
  return Result.ok({
    context: baseline.value,
    options: {
      rootDir: baseline.value.app.rootDir,
      ...(input.againstTrailsDbPath === undefined
        ? {}
        : { path: input.againstTrailsDbPath }),
    },
  });
};

const executeAppWayfindDiff = async (
  input: WayfindDiffInput,
  context: OperatorAppProjectContext,
  ctx: TrailContext
): Promise<Result<WayfindDiffOutput, Error>> => {
  const currentBinding = await assertSelectedArtifactBinding(context);
  if (currentBinding.isErr()) {
    return currentBinding;
  }
  const options = currentDiffOptions(input, context);
  if (options.isErr()) {
    return options;
  }
  const baseline = await resolveBaselineApp(input, context, ctx.cwd);
  if (baseline.isErr()) {
    return baseline;
  }
  const currentGraph = await loadDiffGraph(options.value, ctx.cwd);
  if (currentGraph.isErr()) {
    return currentGraph;
  }
  const baselineGraph = await loadDiffGraph(baseline.value.options, ctx.cwd);
  if (baselineGraph.isErr()) {
    return baselineGraph;
  }
  if (context.app.configured && context.app.id !== undefined) {
    const currentGraphBinding = assertDiffGraphAppBinding(
      currentGraph.value,
      context.app.id,
      'current'
    );
    if (currentGraphBinding.isErr()) {
      return currentGraphBinding;
    }
    const baselineGraphBinding = assertDiffGraphAppBinding(
      baselineGraph.value,
      context.app.id,
      'baseline'
    );
    if (baselineGraphBinding.isErr()) {
      return baselineGraphBinding;
    }
  }
  return Result.ok({
    ...currentGraph.value.envelope,
    against: baselineGraph.value.envelope,
    diff: deriveTopoGraphDiff(
      baselineGraph.value.graph,
      currentGraph.value.graph
    ),
    kind: 'app',
    project: operatorProjectContextOutput(context),
  });
};

const requireCompleteWorkspaceView = (
  view: WorkspaceView,
  projectRoot: string,
  role: 'baseline' | 'current'
): TrailResult<WorkspaceView & { readonly workspaceViewHash: string }, Error> =>
  view.workspaceViewHash !== null &&
  view.evidence.configuredCompleteness === 'complete'
    ? Result.ok(view as WorkspaceView & { readonly workspaceViewHash: string })
    : Result.err(
        new ValidationError(
          `Semantic workspace diff requires a complete ${role} app-partitioned view.`,
          {
            context: {
              evidence: view.evidence,
              projectRoot,
              reason: 'workspace-incomplete',
              role,
            },
          }
        )
      );

const matchingWorkspaceAppIds = (
  current: OperatorWorkspaceProjectContext,
  baseline: OperatorWorkspaceProjectContext
): TrailResult<readonly string[], ValidationError> => {
  const currentIds = current.apps.map((app) => app.id as string).toSorted();
  const baselineIds = baseline.apps.map((app) => app.id as string).toSorted();
  if (JSON.stringify(currentIds) !== JSON.stringify(baselineIds)) {
    return Result.err(
      new ValidationError(
        'Semantic workspace diff requires the same configured app IDs on both project roots.',
        {
          context: {
            baselineAppIds: baselineIds,
            baselineProjectRoot: baseline.projectRoot,
            currentAppIds: currentIds,
            currentProjectRoot: current.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  return Result.ok(currentIds);
};

const executeWorkspaceWayfindDiff = async (
  input: WayfindDiffInput,
  context: OperatorWorkspaceProjectContext,
  ctx: TrailContext
): Promise<Result<WayfindDiffOutput, Error>> => {
  if (
    input.againstRootDir === undefined ||
    input.againstDir !== undefined ||
    input.dir !== undefined ||
    input.trailsDbPath !== undefined ||
    input.againstTrailsDbPath !== undefined
  ) {
    return Result.err(
      new ValidationError(
        'Workspace diff compares two complete project roots. Use --against-root-dir and omit artifact-directory or trails.db overrides.',
        {
          context: {
            projectRoot: context.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  const baseline = await resolveOperatorProjectContext(
    { rootDir: input.againstRootDir },
    { cwd: ctx.cwd }
  );
  if (baseline.isErr()) {
    return baseline;
  }
  if (baseline.value.selectedExtent !== 'workspace') {
    return Result.err(
      new ValidationError(
        'Workspace diff requires a configured workspace at --against-root-dir.',
        {
          context: {
            baselineProjectRoot: baseline.value.projectRoot,
            reason: 'invalid-binding',
          },
        }
      )
    );
  }
  const appIds = matchingWorkspaceAppIds(context, baseline.value);
  if (appIds.isErr()) {
    return appIds;
  }
  const [currentView, baselineView] = await Promise.all([
    deriveWorkspaceView({ identity: context.identity }),
    deriveWorkspaceView({ identity: baseline.value.identity }),
  ]);
  const completeCurrent = requireCompleteWorkspaceView(
    currentView,
    context.projectRoot,
    'current'
  );
  if (completeCurrent.isErr()) {
    return completeCurrent;
  }
  const completeBaseline = requireCompleteWorkspaceView(
    baselineView,
    baseline.value.projectRoot,
    'baseline'
  );
  if (completeBaseline.isErr()) {
    return completeBaseline;
  }
  const currentById = new Map(
    currentView.content.apps.map((app) => [app.id, app])
  );
  const baselineById = new Map(
    baselineView.content.apps.map((app) => [app.id, app])
  );
  const apps: {
    againstTopoGraphHash: string;
    appId: string;
    currentTopoGraphHash: string;
    diff: ReturnType<typeof deriveTopoGraphDiff>;
  }[] = [];
  for (const appId of appIds.value) {
    const currentApp = currentById.get(appId);
    const baselineApp = baselineById.get(appId);
    if (currentApp === undefined || baselineApp === undefined) {
      return Result.err(
        new ValidationError(
          `Complete workspace diff view is missing configured app ${appId}.`
        )
      );
    }
    apps.push({
      againstTopoGraphHash: baselineApp.topoGraphHash,
      appId,
      currentTopoGraphHash: currentApp.topoGraphHash,
      diff: deriveTopoGraphDiff(baselineApp.topoGraph, currentApp.topoGraph),
    });
  }
  return Result.ok({
    against: {
      evidence: completeBaseline.value.evidence,
      project: operatorProjectContextOutput(baseline.value),
      workspaceViewHash: completeBaseline.value.workspaceViewHash,
    },
    apps,
    current: {
      evidence: completeCurrent.value.evidence,
      workspaceViewHash: completeCurrent.value.workspaceViewHash,
    },
    kind: 'workspace',
    project: operatorProjectContextOutput(context),
  });
};

export const wayfindDiffTrail = trail('wayfind.diff', {
  cli: {
    path: 'wayfind diff',
  },
  description:
    'Diff one selected app or two complete app-partitioned workspace views',
  examples: [
    {
      input: { againstRootDir: '../baseline', app: 'trails' },
      name: 'Diff one configured app across project roots',
    },
  ],
  implementation: async (
    input,
    ctx
  ): Promise<Result<WayfindDiffOutput, Error>> => {
    const context = await resolveOperatorProjectContext(input, {
      cwd: ctx.cwd,
    });
    if (context.isErr()) {
      return context;
    }
    const observable = await assertObservableProjectApps(context.value);
    if (observable.isErr()) {
      return observable;
    }
    if (context.value.selectedExtent === 'workspace') {
      const workspaceResult = await executeWorkspaceWayfindDiff(
        input,
        context.value,
        ctx
      );
      return workspaceResult;
    }
    const appResult = await executeAppWayfindDiff(input, context.value, ctx);
    return appResult;
  },
  input: wayfindDiffInputSchema,
  intent: 'read',
  output: wayfindDiffOutputSchema,
  visibility: 'internal',
});
