import { join, resolve } from 'node:path';

import { adapterTargetPlacements, checkAdapters } from '@ontrails/adapter-kit';
import type { AdapterFact } from '@ontrails/adapter-kit';
import {
  AmbiguousError,
  DerivationError,
  NotFoundError,
  Result,
  ValidationError,
  errorCategories,
  surfaceNames,
  topo,
  trail,
} from '@ontrails/core';
import type { TrailsError } from '@ontrails/core';
import { deriveTopoGraphDiff } from '@ontrails/topographer';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';
import { z } from 'zod';

import {
  filterWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
} from './filters.js';
import type {
  WayfinderEntityFilterInput,
  WayfinderEntityKind,
} from './filters.js';
import { loadWayfinderArtifacts } from './loader.js';
import type {
  WayfinderArtifactLoad,
  WayfinderArtifactLoaderOptions,
} from './loader.js';
import { deriveTrailErrorFacts } from './error-facts.js';
import {
  resolveWayfinderPopulation,
  resolveWayfinderRelations,
} from './navigation.js';
import { wayfinderDriftFromArtifactStatus } from './provenance.js';
import {
  diffResult,
  impactNodeSchema,
  relationEdgeSchema,
  relationGroupSchema,
} from './relations.js';
const artifactSourceSchema = z.object({
  kind: z.enum(['lockManifest', 'topoGraph', 'topoStore']),
  path: z.string().optional(),
  schemaVersion: z.number().optional(),
});

const envelopeSchema = z.object({
  drift: z.object({
    artifacts: z
      .array(z.enum(['lockManifest', 'topoGraph', 'topoStore']))
      .readonly()
      .optional(),
    reasons: z.array(z.record(z.string(), z.unknown())).readonly().optional(),
    status: z.enum(['absent', 'aligned', 'drifted']),
  }),
  source: artifactSourceSchema,
});

const sourceInputSchema = z
  .object({
    dir: z.string().optional().describe('Directory containing trails.lock'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    trailsDbPath: z.string().optional().describe('Path to trails.db'),
  })
  .strict();

const filteredInputSchema = sourceInputSchema.extend({
  filters: wayfinderEntityFilterSchema.optional(),
  limit: z.number().int().positive().max(500).default(100),
});

const adapterFactKindSchema = z.enum([
  'available',
  'configured',
  'observed',
  'used',
]);

const adapterFactsInputSchema = z
  .object({
    filters: z
      .object({
        kind: adapterFactKindSchema.optional(),
        packageName: z.string().optional(),
        target: z.string().optional(),
      })
      .optional(),
    limit: z.number().int().positive().max(500).default(100),
    rootDir: z.string().optional().describe('Workspace root directory'),
  })
  .strict();

const overlayInputSchema = sourceInputSchema.extend({
  namespace: z
    .string()
    .min(1)
    .describe('Overlay namespace to read from the saved graph'),
});

const inspectKindSchema = z.enum([
  'entity',
  'trailhead',
  'resource',
  'signal',
  'surface',
  'trail',
  'version',
]);

const inspectInputSchema = sourceInputSchema.extend({
  id: z.string().min(1).describe('Entity ID to inspect'),
  kind: inspectKindSchema.optional().describe('Optional entity kind'),
});

const contractInputSchema = inspectInputSchema.extend({
  version: z.number().int().positive().optional(),
});

const relationInputSchema = inspectInputSchema.extend({
  filters: wayfinderEntityFilterSchema.optional(),
});

const impactDirectionSchema = z
  .enum(['downstream', 'upstream', 'both'])
  .default('downstream');

const impactInputSchema = inspectInputSchema.extend({
  direction: impactDirectionSchema,
  filters: wayfinderEntityFilterSchema.optional(),
  limit: z.number().int().positive().max(500).default(100),
  maxDepth: z.number().int().positive().max(10).default(2),
});

type ImpactDirection = z.output<typeof impactDirectionSchema>;

const relationModeFromImpactDirection = (direction: ImpactDirection) => {
  if (direction === 'both') {
    return 'related';
  }
  return direction === 'upstream' ? 'deps' : 'impact';
};

const diffInputSchema = sourceInputSchema
  .extend({
    againstDir: z
      .string()
      .optional()
      .describe('Baseline artifact directory containing trails.lock'),
    againstRootDir: z
      .string()
      .optional()
      .describe('Baseline workspace root directory'),
    againstTrailsDbPath: z
      .string()
      .optional()
      .describe('Baseline trails.db path'),
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

const refOutputSchema = z.object({
  id: z.string(),
  kind: inspectKindSchema,
  trailId: z.string().optional(),
  versionKey: z.string().optional(),
});

const entrySummarySchema = z.object({
  exampleCount: z.number(),
  id: z.string(),
  surfaces: z.array(z.string()).readonly(),
});

const cliRouteSchema = z.object({
  kind: z.enum(['alias', 'canonical']),
  path: z.array(z.string()).readonly(),
  source: z.enum(['derived', 'surface', 'trail']),
  target: z.string(),
});

const cliProjectionSchema = z
  .object({
    path: z.array(z.string()).readonly(),
    routes: z.array(cliRouteSchema).readonly().optional(),
  })
  .nullable();

const trailSummarySchema = entrySummarySchema.extend({
  cli: cliProjectionSchema,
  composes: z.array(z.string()).readonly(),
  intent: z.enum(['destroy', 'read', 'write']),
  kind: z.literal('trail'),
  resources: z.array(z.string()).readonly(),
  signals: z.array(z.string()).readonly(),
  version: z.number().nullable(),
});

const entitySummarySchema = entrySummarySchema.extend({
  identity: z.string().optional(),
  kind: z.literal('entity'),
  references: z.array(z.unknown()).readonly(),
});

const resourceSummarySchema = entrySummarySchema.extend({
  kind: z.literal('resource'),
  usedBy: z.array(z.string()).readonly(),
});

const signalSummarySchema = entrySummarySchema.extend({
  consumers: z.array(z.string()).readonly(),
  kind: z.literal('signal'),
  producers: z.array(z.string()).readonly(),
});

const surfaceSummarySchema = z.object({
  id: z.string(),
  trailheads: z.array(z.string()).readonly(),
  trails: z.array(z.string()).readonly(),
});

const trailheadSummarySchema = z.object({
  description: z.string(),
  id: z.string(),
  memberIds: z.array(z.string()).readonly(),
  surfaces: z.array(z.string()).readonly(),
  visibility: z.enum(['internal', 'public']).optional(),
});

const versionSummarySchema = z.object({
  current: z.boolean(),
  exampleCount: z.number(),
  id: z.string(),
  kind: z.enum(['current', 'fork', 'revision']),
  marker: z.string().optional(),
  resources: z.array(z.string()).readonly(),
  status: z.unknown().optional(),
  trailId: z.string(),
  version: z.number(),
});

const exampleSummarySchema = z.object({
  example: z.unknown(),
  index: z.number(),
  source: z.enum(['entry', 'version']),
  targetId: z.string(),
});

const errorFactsCompletenessSchema = z.discriminatedUnion('status', [
  z.object({
    reason: z.literal('authored-facts-exhausted'),
    status: z.literal('complete'),
  }),
  z.object({
    reason: z.enum(['inferred-facts-supplied', 'observed-facts-supplied']),
    status: z.literal('partial'),
  }),
  z.object({
    reason: z.enum(['no-exhaustive-emitted-error-contract', 'not-evaluated']),
    status: z.literal('unknown'),
  }),
]);

const errorSurfaceProjectionSchema = z.object({
  category: z.enum(errorCategories),
  code: z.number(),
  name: z.string(),
  retryable: z.boolean(),
  surface: z.enum(surfaceNames),
});

const errorTaxonomyProjectionSchema = z.object({
  category: z.enum(errorCategories).optional(),
  dynamicCategory: z
    .object({
      inheritsCategoryFrom: z.literal('wrapped-error'),
    })
    .optional(),
  known: z.boolean(),
  name: z.string(),
  retryable: z.boolean().optional(),
  surfaces: z.array(errorSurfaceProjectionSchema).readonly(),
});

const errorFactProvenanceSchema = z.object({
  detail: z.string().optional(),
  detourIndex: z.number().optional(),
  exampleName: z.string().optional(),
  source: z.enum([
    'runtime-observation',
    'static-inference',
    'trail.detours',
    'trail.examples',
    'trail.versions.detours',
    'trail.versions.examples',
  ]),
  trailId: z.string(),
  version: z.number().optional(),
});

const errorFactSchema = z.object({
  completeness: errorFactsCompletenessSchema,
  kind: z.enum(['documented', 'handled', 'inferred', 'observed']),
  provenance: errorFactProvenanceSchema,
  taxonomy: errorTaxonomyProjectionSchema,
});

const trailErrorFactsSchema = z.object({
  completeness: z.object({
    documented: errorFactsCompletenessSchema,
    emitted: errorFactsCompletenessSchema,
    handled: errorFactsCompletenessSchema,
    inferred: errorFactsCompletenessSchema,
    observed: errorFactsCompletenessSchema,
  }),
  facts: z.array(errorFactSchema).readonly(),
  trailId: z.string(),
});

const describeOutputSchema = envelopeSchema.extend({
  entity: z.record(z.string(), z.unknown()),
});

const contractOutputSchema = envelopeSchema.extend({
  contract: z.record(z.string(), z.unknown()),
});

const nearbyOutputSchema = envelopeSchema.extend({
  edges: z.array(relationEdgeSchema).readonly(),
  relations: z.array(relationGroupSchema).readonly(),
  target: refOutputSchema,
});

const impactOutputSchema = envelopeSchema.extend({
  direction: z.enum(['downstream', 'upstream', 'both']),
  edges: z.array(relationEdgeSchema).readonly(),
  maxDepth: z.number(),
  nodes: z.array(impactNodeSchema).readonly(),
  target: refOutputSchema,
});

const diffEntryOutputSchema = z.object({
  change: z.enum(['added', 'removed', 'modified']),
  details: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.enum(['entity', 'trailhead', 'resource', 'signal', 'trail']),
  severity: z.enum(['info', 'warning', 'breaking']),
});

const diffResultOutputSchema = z.object({
  breaking: z.array(diffEntryOutputSchema).readonly(),
  entries: z.array(diffEntryOutputSchema).readonly(),
  hasBreaking: z.boolean(),
  info: z.array(diffEntryOutputSchema).readonly(),
  warnings: z.array(diffEntryOutputSchema).readonly(),
});

const diffOutputSchema = envelopeSchema.extend({
  against: envelopeSchema,
  diff: diffResultOutputSchema,
});

const errorsOutputSchema = envelopeSchema.extend({
  errors: z.array(trailErrorFactsSchema).readonly(),
});

const adapterPlacementSchema = z.enum(adapterTargetPlacements);

const adapterFactProvenanceSchema = z.object({
  packageJsonPath: z.string().optional(),
  paths: z.array(z.string()).readonly().optional(),
  source: z.enum([
    'adapter-package-manifest',
    'conformance-test',
    'owner-package-manifest',
    'runtime-observation',
  ]),
});

const adapterFactSchema = z.object({
  adapterType: z.string().optional(),
  key: z.string(),
  kind: adapterFactKindSchema,
  ownerPackage: z.string().optional(),
  packageName: z.string().optional(),
  placement: adapterPlacementSchema.optional(),
  placements: z.array(adapterPlacementSchema).readonly().optional(),
  provenance: adapterFactProvenanceSchema,
  target: z.string(),
  targetKey: z.string().optional(),
});

const adapterFactCountsSchema = z.object({
  available: z.number(),
  configured: z.number(),
  diagnostics: z.number(),
  observed: z.number(),
  used: z.number(),
});

const adapterDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  packageJsonPath: z.string(),
  packageName: z.string().optional(),
  placement: adapterPlacementSchema.optional(),
  severity: z.enum(['error', 'warn']),
  target: z.string().optional(),
});

const adaptersOutputSchema = z.object({
  adapters: z.array(adapterFactSchema).readonly(),
  counts: adapterFactCountsSchema,
  diagnostics: z.array(adapterDiagnosticSchema).readonly(),
  rootDir: z.string(),
});

type SourceInput = z.output<typeof sourceInputSchema>;
type AdapterFactsInput = z.output<typeof adapterFactsInputSchema>;
type InspectInput = z.output<typeof inspectInputSchema>;
type ContractInput = z.output<typeof contractInputSchema>;
type DiffInput = z.output<typeof diffInputSchema>;

interface LoadedWayfinderGraph {
  readonly graph: TopoGraph;
  readonly load: WayfinderArtifactLoad;
  readonly source: {
    readonly kind: 'topoGraph';
    readonly path: string;
    readonly schemaVersion: number;
  };
}

const toLoaderOptions = (
  input: SourceInput,
  cwd: string | undefined
): WayfinderArtifactLoaderOptions => {
  const rootDir = input.rootDir ?? (input.dir === undefined ? cwd : undefined);
  return {
    ...(input.dir === undefined ? {} : { dir: input.dir }),
    ...(rootDir === undefined ? {} : { rootDir }),
    ...(input.trailsDbPath === undefined ? {} : { path: input.trailsDbPath }),
  };
};

const topoGraphSourcePath = (
  input: SourceInput,
  cwd: string | undefined
): string | undefined => {
  if (input.dir !== undefined) {
    return join(input.dir, 'trails.lock');
  }
  const rootDir = input.rootDir ?? cwd;
  return rootDir === undefined ? undefined : join(rootDir, 'trails.lock');
};

const loadGraph = async (
  input: SourceInput,
  cwd: string | undefined
): Promise<Result<LoadedWayfinderGraph, TrailsError>> => {
  let load: WayfinderArtifactLoad;
  try {
    load = await loadWayfinderArtifacts(toLoaderOptions(input, cwd));
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return Result.err(
      new DerivationError('Unable to load Wayfinder artifacts.', {
        cause,
        context: {
          artifact: 'topoGraph',
          path: topoGraphSourcePath(input, cwd) ?? 'trails.lock',
        },
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
        },
      })
    );
  }
  if (load.topoGraph === null) {
    return Result.err(
      new NotFoundError(
        'No wayfinder TopoGraph artifact found. Run `trails compile` first.'
      )
    );
  }
  return Result.ok({
    graph: load.topoGraph,
    load,
    source: {
      kind: 'topoGraph',
      path: topoGraphSourcePath(input, cwd) ?? 'trails.lock',
      schemaVersion: load.topoGraph.topoGraphSchemaVersion,
    },
  });
};

const adapterFactsRootDir = (
  input: AdapterFactsInput,
  cwd: string | undefined
): Result<string, ValidationError> => {
  const rootDir = input.rootDir ?? cwd;
  return rootDir === undefined
    ? Result.err(
        new ValidationError(
          'Provide rootDir or run wayfind.adapters from a workspace directory.'
        )
      )
    : Result.ok(resolve(rootDir));
};

const filteredAdapterFacts = (
  input: AdapterFactsInput,
  cwd: string | undefined
): Result<z.output<typeof adaptersOutputSchema>, ValidationError> => {
  const rootDir = adapterFactsRootDir(input, cwd);
  if (rootDir.isErr()) {
    return rootDir;
  }

  const report = checkAdapters(rootDir.value);
  const facts = report.facts
    .filter(
      (fact: AdapterFact) =>
        (input.filters?.kind === undefined ||
          fact.kind === input.filters.kind) &&
        (input.filters?.target === undefined ||
          fact.target === input.filters.target) &&
        (input.filters?.packageName === undefined ||
          fact.packageName === input.filters.packageName)
    )
    .slice(0, input.limit);

  return Result.ok({
    adapters: facts,
    counts: {
      available: report.facts.filter(
        (fact: AdapterFact) => fact.kind === 'available'
      ).length,
      configured: report.facts.filter(
        (fact: AdapterFact) => fact.kind === 'configured'
      ).length,
      diagnostics: report.diagnostics.length,
      observed: report.facts.filter(
        (fact: AdapterFact) => fact.kind === 'observed'
      ).length,
      used: report.facts.filter((fact: AdapterFact) => fact.kind === 'used')
        .length,
    },
    diagnostics: [...report.diagnostics],
    rootDir: rootDir.value,
  });
};

const envelope = (
  loaded: LoadedWayfinderGraph
): z.output<typeof envelopeSchema> => ({
  drift: wayfinderDriftFromArtifactStatus(loaded.load.artifactStatus),
  source: loaded.source,
});

const entrySignals = (entry: TopoGraphEntry): readonly string[] =>
  [
    ...(entry.fires ?? []),
    ...(entry.on ?? []),
    ...(entry.from ?? []),
    ...(entry.producers ?? []),
    ...(entry.consumers ?? []),
  ].toSorted();

const entryExamples = (entry: TopoGraphEntry): readonly unknown[] =>
  entry.examples ?? [];

const entryById = (
  graph: TopoGraph,
  id: string,
  kind?: TopoGraphEntry['kind']
): TopoGraphEntry | undefined =>
  graph.entries.find(
    (entry) => entry.id === id && (kind === undefined || entry.kind === kind)
  );

const usedByResource = (
  graph: TopoGraph,
  resourceId: string
): readonly string[] =>
  graph.entries
    .filter(
      (entry) =>
        entry.kind === 'trail' && (entry.resources ?? []).includes(resourceId)
    )
    .map((entry) => entry.id)
    .toSorted();

const trailSummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'trail')
    .map((entry) => ({
      cli: entry.cli ?? null,
      composes: entry.composes ?? [],
      exampleCount: entry.exampleCount,
      id: entry.id,
      intent: entry.intent ?? 'write',
      kind: 'trail' as const,
      resources: entry.resources ?? [],
      signals: entrySignals(entry),
      surfaces: entry.surfaces,
      version: entry.version ?? null,
    }));

const entitySummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'entity')
    .map((entry) => ({
      exampleCount: entry.exampleCount,
      id: entry.id,
      identity: entry.identity,
      kind: 'entity' as const,
      references: entry.references ?? [],
      surfaces: entry.surfaces,
    }));

const resourceSummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'resource')
    .map((entry) => ({
      exampleCount: entry.exampleCount,
      id: entry.id,
      kind: 'resource' as const,
      surfaces: entry.surfaces,
      usedBy: usedByResource(graph, entry.id),
    }));

const signalSummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'signal')
    .map((entry) => ({
      consumers: entry.consumers ?? [],
      exampleCount: entry.exampleCount,
      id: entry.id,
      kind: 'signal' as const,
      producers: entry.producers ?? [],
      surfaces: entry.surfaces,
    }));

const surfaceSummaries = (graph: TopoGraph) => {
  const surfaceIds = new Set<string>();
  for (const entry of graph.entries) {
    for (const surface of entry.surfaces) {
      surfaceIds.add(surface);
    }
  }
  for (const trailhead of graph.trailheads ?? []) {
    for (const surface of trailhead.surfaces) {
      surfaceIds.add(surface);
    }
  }
  return [...surfaceIds].toSorted().map((surface) => ({
    id: surface,
    trailheads: (graph.trailheads ?? [])
      .filter((trailhead) => trailhead.surfaces.includes(surface))
      .map((trailhead) => trailhead.id)
      .toSorted(),
    trails: filterWayfinderEntityRefs(graph, {
      kind: 'trail',
      surface,
    }).map((ref) => ref.id),
  }));
};

const trailheadSummaries = (graph: TopoGraph) =>
  (graph.trailheads ?? []).map((trailhead) => ({
    description: trailhead.description,
    id: trailhead.id,
    memberIds: trailhead.memberIds,
    surfaces: trailhead.surfaces,
    visibility: trailhead.visibility,
  }));

const versionSummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'trail' && entry.version !== undefined)
    .flatMap((entry) => {
      const current = {
        current: true,
        exampleCount: entry.exampleCount,
        id: `${entry.id}@${entry.version as number}`,
        kind: 'current' as const,
        marker: entry.marker,
        resources: entry.resources ?? [],
        trailId: entry.id,
        version: entry.version as number,
      };
      const historical = Object.entries(entry.versions ?? {}).map(
        ([versionKey, version]) => ({
          current: false,
          exampleCount: version.exampleCount,
          id: `${entry.id}@${versionKey}`,
          kind: version.kind,
          marker: version.marker,
          resources: version.resources ?? [],
          status: version.status,
          trailId: entry.id,
          version: Number(versionKey),
        })
      );
      return [current, ...historical].toSorted(
        (a, b) => a.trailId.localeCompare(b.trailId) || a.version - b.version
      );
    });

const exampleSummaries = (graph: TopoGraph) =>
  graph.entries.flatMap((entry) => {
    const current = entryExamples(entry).map((example, index) => ({
      example,
      index,
      source: 'entry' as const,
      targetId: entry.id,
    }));
    const versions = Object.entries(entry.versions ?? {}).flatMap(
      ([versionKey, version]) =>
        (version.examples ?? []).map((example, index) => ({
          example,
          index,
          source: 'version' as const,
          targetId: `${entry.id}@${versionKey}`,
        }))
    );
    return [...current, ...versions];
  });

const kindFilter = (
  kind: WayfinderEntityKind,
  filters: WayfinderEntityFilterInput | undefined
): WayfinderEntityFilterInput => ({ ...filters, kind });

const allowsTrailKind = (
  filters: WayfinderEntityFilterInput | undefined
): boolean => {
  const kind = filters?.kind;
  return (
    kind === undefined ||
    kind === 'trail' ||
    (Array.isArray(kind) && kind.includes('trail'))
  );
};

const allowsVersionKind = (
  filters: WayfinderEntityFilterInput | undefined
): boolean => {
  const kind = filters?.kind;
  return (
    kind === undefined ||
    kind === 'version' ||
    (Array.isArray(kind) && kind.includes('version'))
  );
};

const allowsExampleWidening = (
  filters: WayfinderEntityFilterInput | undefined
): boolean => filters?.exampleCoverage !== false;

const filteredExampleSummaries = (
  graph: TopoGraph,
  filters: WayfinderEntityFilterInput | undefined,
  limit: number
) => {
  if (filters === undefined || Object.keys(filters).length === 0) {
    return exampleSummaries(graph).slice(0, limit);
  }
  const ids = new Set(
    filterWayfinderEntityRefs(graph, filters).map((ref) => ref.id)
  );
  const trailIds = new Set(
    allowsTrailKind(filters)
      ? filterWayfinderEntityRefs(graph, kindFilter('trail', filters)).map(
          (ref) => ref.id
        )
      : []
  );
  const versionIds = new Set(
    allowsVersionKind(filters)
      ? filterWayfinderEntityRefs(graph, kindFilter('version', filters)).map(
          (ref) => ref.id
        )
      : []
  );
  const currentVersionTrailIds = new Set(
    graph.entries
      .filter(
        (entry) =>
          entry.kind === 'trail' &&
          entry.version !== undefined &&
          versionIds.has(`${entry.id}@${entry.version}`)
      )
      .map((entry) => entry.id)
  );
  const historicalVersionTrailIds = new Map(
    graph.entries.flatMap((entry) =>
      entry.kind === 'trail'
        ? Object.keys(entry.versions ?? {}).map((versionKey) => [
            `${entry.id}@${versionKey}`,
            entry.id,
          ])
        : []
    )
  );
  return exampleSummaries(graph)
    .filter(
      (example) =>
        ids.has(example.targetId) ||
        (example.source === 'entry' &&
          currentVersionTrailIds.has(example.targetId)) ||
        (example.source === 'version' &&
          allowsExampleWidening(filters) &&
          trailIds.has(historicalVersionTrailIds.get(example.targetId) ?? ''))
    )
    .slice(0, limit);
};

const filteredVersionSummaries = (
  graph: TopoGraph,
  filters: WayfinderEntityFilterInput | undefined,
  limit: number
) => {
  const summaries = versionSummaries(graph);
  if (filters === undefined || Object.keys(filters).length === 0) {
    return summaries.slice(0, limit);
  }
  const ids = new Set(
    filterWayfinderEntityRefs(graph, kindFilter('version', filters)).map(
      (ref) => ref.id
    )
  );
  const trailIds = new Set(
    filterWayfinderEntityRefs(graph, kindFilter('trail', filters)).map(
      (ref) => ref.id
    )
  );
  return summaries
    .filter(
      (summary) =>
        ids.has(summary.id) ||
        (summary.current && trailIds.has(summary.trailId))
    )
    .slice(0, limit);
};

const againstInput = (input: DiffInput): SourceInput => ({
  ...(input.againstDir === undefined ? {} : { dir: input.againstDir }),
  ...(input.againstRootDir === undefined
    ? {}
    : { rootDir: input.againstRootDir }),
  ...(input.againstTrailsDbPath === undefined
    ? {}
    : { trailsDbPath: input.againstTrailsDbPath }),
});

const diffBaselineError = (input: DiffInput): ValidationError | undefined => {
  if (input.againstDir === undefined && input.againstRootDir === undefined) {
    return new ValidationError(
      'Provide againstDir or againstRootDir for the baseline graph.'
    );
  }
  if (input.againstDir !== undefined && input.againstRootDir !== undefined) {
    return new ValidationError(
      'Provide only one of againstDir or againstRootDir.'
    );
  }
  return undefined;
};

const describeSurface = (graph: TopoGraph, id: string) => {
  const surface = surfaceSummaries(graph).find(
    (candidate) => candidate.id === id
  );
  return surface === undefined ? undefined : { ...surface, kind: 'surface' };
};

const describeTrailhead = (graph: TopoGraph, id: string) => {
  const trailhead = trailheadSummaries(graph).find(
    (candidate) => candidate.id === id
  );
  return trailhead === undefined
    ? undefined
    : { ...trailhead, kind: 'trailhead' };
};

const describeVersion = (graph: TopoGraph, id: string) => {
  const version = versionSummaries(graph).find(
    (candidate) => candidate.id === id
  );
  return version === undefined ? undefined : { ...version, kind: 'version' };
};

type ResolvedEntity = Readonly<Record<string, unknown>>;

interface ResolvedEntityCandidate {
  readonly kind: WayfinderEntityKind;
  readonly value: ResolvedEntity;
}

const ambiguousId = (
  id: string,
  candidates: readonly ResolvedEntityCandidate[]
): AmbiguousError =>
  new AmbiguousError(
    `Wayfinder id "${id}" matched multiple entity kinds: ${candidates
      .map((candidate) => candidate.kind)
      .join(', ')}. Pass kind to disambiguate.`
  );

const singleCandidate = (
  id: string,
  candidates: readonly ResolvedEntityCandidate[]
): Result<ResolvedEntity | undefined, AmbiguousError> => {
  if (candidates.length > 1) {
    return Result.err(ambiguousId(id, candidates));
  }
  return Result.ok(candidates[0]?.value);
};

const describeCandidates = (
  graph: TopoGraph,
  id: string
): readonly ResolvedEntityCandidate[] => {
  const candidates: ResolvedEntityCandidate[] = [];
  const entry = entryById(graph, id);
  if (entry !== undefined) {
    candidates.push({
      kind: entry.kind,
      value: entry as unknown as ResolvedEntity,
    });
  }
  const trailhead = describeTrailhead(graph, id);
  if (trailhead !== undefined) {
    candidates.push({ kind: 'trailhead', value: trailhead });
  }
  const surface = describeSurface(graph, id);
  if (surface !== undefined) {
    candidates.push({ kind: 'surface', value: surface });
  }
  const version = describeVersion(graph, id);
  if (version !== undefined) {
    candidates.push({ kind: 'version', value: version });
  }
  return candidates;
};

const describeEntry = (
  graph: TopoGraph,
  input: InspectInput
): Result<ResolvedEntity | undefined, AmbiguousError> => {
  if (input.kind === 'surface') {
    return Result.ok(describeSurface(graph, input.id));
  }
  if (input.kind === 'trailhead') {
    return Result.ok(describeTrailhead(graph, input.id));
  }
  if (input.kind === 'version') {
    return Result.ok(describeVersion(graph, input.id));
  }
  if (input.kind === undefined) {
    return singleCandidate(input.id, describeCandidates(graph, input.id));
  }
  const entry = entryById(graph, input.id, input.kind);
  return Result.ok(
    entry === undefined ? undefined : (entry as unknown as ResolvedEntity)
  );
};

const contractVersionFor = (
  graph: TopoGraph,
  input: ContractInput
): Readonly<Record<string, unknown>> | undefined => {
  const versionId =
    input.version === undefined ? input.id : `${input.id}@${input.version}`;
  const described = describeVersion(graph, versionId);
  if (described === undefined) {
    return undefined;
  }
  const entry = entryById(graph, described.trailId, 'trail');
  const version = entry?.versions?.[String(described.version)];
  return {
    id: described.trailId,
    input: version?.input ?? entry?.input ?? null,
    kind: 'version',
    output: version?.output ?? entry?.output ?? null,
    resources: version?.resources ?? entry?.resources ?? [],
    version: described.version,
  };
};

const contractEntryKind = (
  kind: ContractInput['kind']
): TopoGraphEntry['kind'] | undefined =>
  kind === undefined ||
  kind === 'trailhead' ||
  kind === 'surface' ||
  kind === 'version'
    ? undefined
    : kind;

const contractEntry = (
  entry: TopoGraphEntry
): Readonly<Record<string, unknown>> => ({
  cli: entry.cli ?? null,
  id: entry.id,
  input: entry.input ?? null,
  kind: entry.kind,
  output: entry.output ?? null,
  payload: entry.payload ?? null,
  resources: entry.resources ?? [],
  schema: entry.schema ?? null,
  version: entry.version ?? null,
});

const contractSurfaceOrTrailhead = (
  graph: TopoGraph,
  input: ContractInput
): ResolvedEntity | undefined => {
  if (input.kind === 'trailhead') {
    return describeTrailhead(graph, input.id);
  }
  if (input.kind === 'surface') {
    return describeSurface(graph, input.id);
  }
  return undefined;
};

const contractFor = (
  graph: TopoGraph,
  input: ContractInput
): Result<ResolvedEntity | undefined, AmbiguousError> => {
  if (input.kind === 'version' || input.version !== undefined) {
    return Result.ok(contractVersionFor(graph, input));
  }
  if (input.kind === 'surface' || input.kind === 'trailhead') {
    return Result.ok(contractSurfaceOrTrailhead(graph, input));
  }
  if (input.kind === undefined) {
    const candidates: ResolvedEntityCandidate[] = [];
    const entry = entryById(graph, input.id);
    if (entry !== undefined) {
      candidates.push({ kind: entry.kind, value: contractEntry(entry) });
    }
    const trailhead = describeTrailhead(graph, input.id);
    if (trailhead !== undefined) {
      candidates.push({ kind: 'trailhead', value: trailhead });
    }
    const surface = describeSurface(graph, input.id);
    if (surface !== undefined) {
      candidates.push({ kind: 'surface', value: surface });
    }
    const version = contractVersionFor(graph, { ...input, kind: 'version' });
    if (version !== undefined) {
      candidates.push({ kind: 'version', value: version });
    }
    return singleCandidate(input.id, candidates);
  }

  const entry = entryById(graph, input.id, contractEntryKind(input.kind));
  if (entry === undefined) {
    return Result.ok(contractSurfaceOrTrailhead(graph, input));
  }
  return Result.ok(contractEntry(entry));
};

const withGraph = async <TValue>(
  input: SourceInput,
  cwd: string | undefined,
  project: (loaded: LoadedWayfinderGraph) => TValue
): Promise<Result<TValue, TrailsError>> => {
  const loaded = await loadGraph(input, cwd);
  if (loaded.isErr()) {
    return loaded;
  }
  return Result.ok(project(loaded.value));
};

const notFound = (kind: string, id: string): NotFoundError =>
  new NotFoundError(`No Wayfinder ${kind} found for "${id}".`);

const filteredIds = (
  graph: TopoGraph,
  kind: WayfinderEntityKind,
  filters: WayfinderEntityFilterInput | undefined,
  limit: number
): ReadonlySet<string> =>
  new Set(
    resolveWayfinderPopulation(graph, {
      filters,
      kind,
      limit,
    }).map((ref) => ref.id)
  );

const filteredErrorFacts = (
  graph: TopoGraph,
  filters: WayfinderEntityFilterInput | undefined,
  limit: number
) => {
  const ids = filteredIds(graph, 'trail', filters, limit);
  return deriveTrailErrorFacts(graph)
    .filter((entry) => ids.has(entry.trailId))
    .slice(0, limit);
};

export const wayfindOverviewTrail = trail('wayfind.overview', {
  description: 'Summarize the saved Wayfinder topo graph',
  examples: [{ input: {}, name: 'Overview' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const { graph } = loaded;
      return {
        ...envelope(loaded),
        counts: {
          entities: entitySummaries(graph).length,
          examples: exampleSummaries(graph).length,
          resources: resourceSummaries(graph).length,
          signals: signalSummaries(graph).length,
          surfaces: surfaceSummaries(graph).length,
          trailheads: trailheadSummaries(graph).length,
          trails: trailSummaries(graph).length,
          versions: versionSummaries(graph).length,
        },
        generatedAt: graph.generatedAt ?? null,
        workspace:
          graph.workspace === undefined
            ? null
            : {
                collisionCount: graph.workspace.collisions?.length ?? 0,
                trailCount: Object.keys(graph.workspace.trails).length,
              },
      };
    }),
  input: sourceInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    counts: z.object({
      entities: z.number(),
      examples: z.number(),
      resources: z.number(),
      signals: z.number(),
      surfaces: z.number(),
      trailheads: z.number(),
      trails: z.number(),
      versions: z.number(),
    }),
    generatedAt: z.string().nullable(),
    workspace: z
      .object({
        collisionCount: z.number(),
        trailCount: z.number(),
      })
      .nullable(),
  }),
  visibility: 'internal',
});

export const wayfindSearchTrail = trail('wayfind.search', {
  description: 'Find topo graph entities with typed filters',
  examples: [{ input: { filters: { kind: 'trail' } }, name: 'Find trails' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      matches: resolveWayfinderPopulation(loaded.graph, {
        filters: input.filters,
        limit: input.limit,
      }).map((ref) => ({
        id: ref.id,
        kind: ref.kind,
        ...(ref.trailId === undefined ? {} : { trailId: ref.trailId }),
        ...(ref.versionKey === undefined ? {} : { versionKey: ref.versionKey }),
      })),
    })),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    matches: z.array(refOutputSchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindTrailsTrail = trail('wayfind.trails', {
  description: 'List saved trail contracts',
  examples: [{ input: {}, name: 'List trails' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'trail',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        trails: trailSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    trails: z.array(trailSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindEntitiesTrail = trail('wayfind.entities', {
  description: 'List saved entity contracts',
  examples: [{ input: {}, name: 'List entities' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'entity',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        entities: entitySummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    entities: z.array(entitySummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindResourcesTrail = trail('wayfind.resources', {
  description: 'List saved resource contracts and usage',
  examples: [{ input: {}, name: 'List resources' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'resource',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        resources: resourceSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    resources: z.array(resourceSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindSignalsTrail = trail('wayfind.signals', {
  description: 'List saved signal contracts and graph usage',
  examples: [{ input: {}, name: 'List signals' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'signal',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        signals: signalSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    signals: z.array(signalSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindSurfacesTrail = trail('wayfind.surfaces', {
  description: 'List saved direct and trailhead-rendered surfaces',
  examples: [{ input: {}, name: 'List surfaces' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'surface',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        surfaces: surfaceSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    surfaces: z.array(surfaceSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindTrailheadsTrail = trail('wayfind.trailheads', {
  description: 'List saved trailhead membership',
  examples: [{ input: {}, name: 'List trailheads' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'trailhead',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        trailheads: trailheadSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    trailheads: z.array(trailheadSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindVersionsTrail = trail('wayfind.versions', {
  description: 'List saved trail version contracts',
  examples: [{ input: {}, name: 'List versions' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      versions: filteredVersionSummaries(
        loaded.graph,
        input.filters,
        input.limit
      ),
    })),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    versions: z.array(versionSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindExamplesTrail = trail('wayfind.examples', {
  description: 'List saved examples without executing trails',
  examples: [{ input: {}, name: 'List examples' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      examples: filteredExampleSummaries(
        loaded.graph,
        input.filters,
        input.limit
      ),
    })),
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    examples: z.array(exampleSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindErrorsTrail = trail('wayfind.errors', {
  description: 'List saved trail error facts with provenance',
  examples: [{ input: {}, name: 'List trail error facts' }],
  implementation: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      errors: filteredErrorFacts(loaded.graph, input.filters, input.limit),
    })),
  input: filteredInputSchema,
  intent: 'read',
  output: errorsOutputSchema,
  visibility: 'internal',
});

export const wayfindAdaptersTrail = trail('wayfind.adapters', {
  description: 'List adapter facts with package and conformance provenance',
  examples: [{ input: {}, name: 'List adapter facts' }],
  implementation: (input, ctx) => filteredAdapterFacts(input, ctx.cwd),
  input: adapterFactsInputSchema,
  intent: 'read',
  output: adaptersOutputSchema,
  visibility: 'internal',
});

export const wayfindOverlayTrail = trail('wayfind.overlay', {
  description: 'Read a namespaced fact overlay from the saved graph',
  examples: [
    { input: { namespace: 'cloudflare' }, name: 'Read cloudflare lock facts' },
  ],
  implementation: async (input, ctx) => {
    const loaded = await loadGraph(input, ctx.cwd);
    if (loaded.isErr()) {
      return loaded;
    }
    const overlays = loaded.value.graph.overlays ?? {};
    const namespaces = Object.keys(overlays).toSorted();
    if (!Object.hasOwn(overlays, input.namespace)) {
      return Result.err(
        new NotFoundError(
          `No lock overlay named "${input.namespace}". Available overlays: ${namespaces.length === 0 ? 'none' : namespaces.join(', ')}. Adapters contribute overlays via trailsOverlays; run \`trails compile\` to refresh the lock.`
        )
      );
    }
    return Result.ok({
      ...envelope(loaded.value),
      facts: overlays[input.namespace],
      namespace: input.namespace,
      namespaces,
    });
  },
  input: overlayInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    facts: z.unknown(),
    namespace: z.string(),
    namespaces: z.array(z.string()).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindDescribeTrail = trail('wayfind.describe', {
  args: ['id'],
  description: 'Inspect one saved topo graph entity',
  examples: [{ input: { id: 'user.create' }, name: 'Describe entity' }],
  implementation: async (input, ctx) => {
    const loaded = await loadGraph(input, ctx.cwd);
    if (loaded.isErr()) {
      return loaded;
    }
    const entity = describeEntry(loaded.value.graph, input);
    if (entity.isErr()) {
      return entity;
    }
    if (entity.value === undefined) {
      return Result.err(notFound(input.kind ?? 'entity', input.id));
    }
    return Result.ok({ ...envelope(loaded.value), entity: entity.value });
  },
  input: inspectInputSchema,
  intent: 'read',
  output: describeOutputSchema,
  visibility: 'internal',
});

export const wayfindContractTrail = trail('wayfind.contract', {
  args: ['id'],
  description: 'Inspect one saved input/output contract',
  examples: [{ input: { id: 'user.create' }, name: 'Inspect contract' }],
  implementation: async (input, ctx) => {
    const loaded = await loadGraph(input, ctx.cwd);
    if (loaded.isErr()) {
      return loaded;
    }
    const contract = contractFor(loaded.value.graph, input);
    if (contract.isErr()) {
      return contract;
    }
    if (contract.value === undefined) {
      return Result.err(notFound(input.kind ?? 'contract', input.id));
    }
    return Result.ok({ ...envelope(loaded.value), contract: contract.value });
  },
  input: contractInputSchema,
  intent: 'read',
  output: contractOutputSchema,
  visibility: 'internal',
});

export const wayfindNearbyTrail = trail('wayfind.nearby', {
  args: ['id'],
  description: 'Inspect direct graph relationships around one topo entity',
  examples: [{ input: { id: 'user.create' }, name: 'Nearby graph context' }],
  implementation: async (input, ctx) => {
    const loaded = await loadGraph(input, ctx.cwd);
    if (loaded.isErr()) {
      return loaded;
    }
    const resolved = resolveWayfinderRelations(loaded.value.graph, {
      filters: input.filters,
      id: input.id,
      kind: input.kind,
      limit: 100,
      maxDepth: 1,
      mode: 'related',
      view: 'groups',
    });
    if (resolved.isErr()) {
      return resolved;
    }
    if (resolved.value === undefined) {
      return Result.err(notFound(input.kind ?? 'entity', input.id));
    }
    return Result.ok({
      ...envelope(loaded.value),
      edges: resolved.value.edges,
      relations: resolved.value.groups,
      target: resolved.value.target,
    });
  },
  input: relationInputSchema,
  intent: 'read',
  output: nearbyOutputSchema,
  visibility: 'internal',
});

export const wayfindImpactTrail = trail('wayfind.impact', {
  args: ['id'],
  description: 'Traverse multi-hop graph impact from one topo entity',
  examples: [
    {
      input: { direction: 'downstream', id: 'db.main', kind: 'resource' },
      name: 'Resource impact',
    },
  ],
  implementation: async (input, ctx) => {
    const impactInput = {
      ...input,
      direction: input.direction ?? 'downstream',
      limit: input.limit ?? 100,
      maxDepth: input.maxDepth ?? 2,
    };
    const loaded = await loadGraph(input, ctx.cwd);
    if (loaded.isErr()) {
      return loaded;
    }
    const resolved = resolveWayfinderRelations(loaded.value.graph, {
      filters: input.filters,
      id: input.id,
      kind: input.kind,
      limit: impactInput.limit,
      maxDepth: impactInput.maxDepth,
      mode: relationModeFromImpactDirection(impactInput.direction),
    });
    if (resolved.isErr()) {
      return resolved;
    }
    if (resolved.value === undefined) {
      return Result.err(notFound(input.kind ?? 'entity', input.id));
    }
    return Result.ok({
      ...envelope(loaded.value),
      direction: impactInput.direction,
      edges: resolved.value.edges,
      maxDepth: impactInput.maxDepth,
      nodes: resolved.value.nodes,
      target: resolved.value.target,
    });
  },
  input: impactInputSchema,
  intent: 'read',
  output: impactOutputSchema,
  visibility: 'internal',
});

export const wayfindDiffTrail = trail('wayfind.diff', {
  description: 'Diff two saved Wayfinder topo graph artifacts',
  examples: [
    {
      input: { againstDir: '.trails-baseline' },
      name: 'Diff against saved artifacts',
    },
  ],
  implementation: async (input, ctx) => {
    const baselineError = diffBaselineError(input);
    if (baselineError !== undefined) {
      return Result.err(baselineError);
    }
    const current = await loadGraph(input, ctx.cwd);
    if (current.isErr()) {
      return current;
    }
    const baseline = await loadGraph(againstInput(input), ctx.cwd);
    if (baseline.isErr()) {
      return baseline;
    }
    const diff = deriveTopoGraphDiff(baseline.value.graph, current.value.graph);
    return Result.ok({
      ...envelope(current.value),
      against: envelope(baseline.value),
      diff: diffResult(diff),
    });
  },
  input: diffInputSchema,
  intent: 'read',
  output: diffOutputSchema,
  visibility: 'internal',
});

export const wayfinderTopo = topo('wayfinder', {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindEntitiesTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverlayTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSignalsTrail,
  wayfindSurfacesTrail,
  wayfindTrailheadsTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
});
