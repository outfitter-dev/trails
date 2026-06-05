import { join } from 'node:path';

import {
  AmbiguousError,
  DerivationError,
  NotFoundError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import type { TrailsError } from '@ontrails/core';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';
import { z } from 'zod';

import {
  filterWayfinderEntityRefs,
  wayfinderEntityFilterSchema,
} from './filters.js';
import type {
  WayfinderEntityFilterInput,
  WayfinderEntityKind,
  WayfinderEntityRef,
} from './filters.js';
import { loadWayfinderArtifacts } from './loader.js';
import type {
  WayfinderArtifactLoad,
  WayfinderArtifactLoaderOptions,
} from './loader.js';

const artifactSourceSchema = z.object({
  kind: z.enum(['lockManifest', 'topoGraph', 'topoStore']),
  path: z.string().optional(),
  schemaVersion: z.number().optional(),
});

const freshnessSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fresh') }),
  z.object({
    artifacts: z
      .array(z.enum(['lockManifest', 'topoGraph', 'topoStore']))
      .readonly(),
    status: z.literal('missing'),
  }),
  z.object({
    reasons: z.array(z.record(z.string(), z.unknown())).readonly(),
    status: z.literal('stale'),
  }),
  z.object({
    artifact: z.enum(['lockManifest', 'topoGraph', 'topoStore']),
    message: z.string(),
    status: z.literal('schema-version-drift'),
  }),
]);

const envelopeSchema = z.object({
  freshness: freshnessSchema,
  source: artifactSourceSchema,
});

const sourceInputSchema = z
  .object({
    dir: z
      .string()
      .optional()
      .describe('Directory containing topo.lock and trails.lock'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    trailsDbPath: z.string().optional().describe('Path to trails.db'),
  })
  .strict();

const filteredInputSchema = sourceInputSchema.extend({
  filters: wayfinderEntityFilterSchema.optional(),
  limit: z.number().int().positive().max(500).default(100),
});

const inspectKindSchema = z.enum([
  'contour',
  'facet',
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

const trailSummarySchema = entrySummarySchema.extend({
  composes: z.array(z.string()).readonly(),
  intent: z.enum(['destroy', 'read', 'write']),
  kind: z.literal('trail'),
  resources: z.array(z.string()).readonly(),
  signals: z.array(z.string()).readonly(),
  version: z.number().nullable(),
});

const contourSummarySchema = entrySummarySchema.extend({
  identity: z.string().optional(),
  kind: z.literal('contour'),
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
  facets: z.array(z.string()).readonly(),
  id: z.string(),
  trails: z.array(z.string()).readonly(),
});

const facetSummarySchema = z.object({
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

const describeOutputSchema = envelopeSchema.extend({
  entity: z.record(z.string(), z.unknown()),
});

const contractOutputSchema = envelopeSchema.extend({
  contract: z.record(z.string(), z.unknown()),
});

type SourceInput = z.output<typeof sourceInputSchema>;
type InspectInput = z.output<typeof inspectInputSchema>;
type ContractInput = z.output<typeof contractInputSchema>;

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

const topoLockPath = (
  input: SourceInput,
  cwd: string | undefined
): string | undefined => {
  if (input.dir !== undefined) {
    return join(input.dir, 'topo.lock');
  }
  const rootDir = input.rootDir ?? cwd;
  return rootDir === undefined
    ? undefined
    : join(rootDir, '.trails', 'topo.lock');
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
          path: topoLockPath(input, cwd) ?? 'topo.lock',
        },
      })
    );
  }
  if (
    load.freshness.status === 'schema-version-drift' &&
    load.freshness.artifact === 'topoGraph'
  ) {
    return Result.err(
      new DerivationError(load.freshness.message, {
        context: {
          artifact: load.freshness.artifact,
          freshnessStatus: load.freshness.status,
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
      path: topoLockPath(input, cwd) ?? 'topo.lock',
      schemaVersion: load.topoGraph.topoGraphSchemaVersion,
    },
  });
};

const envelope = (
  loaded: LoadedWayfinderGraph
): z.output<typeof envelopeSchema> => ({
  freshness: loaded.load.freshness,
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

const contourSummaries = (graph: TopoGraph) =>
  graph.entries
    .filter((entry) => entry.kind === 'contour')
    .map((entry) => ({
      exampleCount: entry.exampleCount,
      id: entry.id,
      identity: entry.identity,
      kind: 'contour' as const,
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
  for (const facet of graph.facets ?? []) {
    for (const surface of facet.surfaces) {
      surfaceIds.add(surface);
    }
  }
  return [...surfaceIds].toSorted().map((surface) => ({
    facets: (graph.facets ?? [])
      .filter((facet) => facet.surfaces.includes(surface))
      .map((facet) => facet.id)
      .toSorted(),
    id: surface,
    trails: filterWayfinderEntityRefs(graph, {
      kind: 'trail',
      surface,
    }).map((ref) => ref.id),
  }));
};

const facetSummaries = (graph: TopoGraph) =>
  (graph.facets ?? []).map((facet) => ({
    description: facet.description,
    id: facet.id,
    memberIds: facet.memberIds,
    surfaces: facet.surfaces,
    visibility: facet.visibility,
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
  return exampleSummaries(graph)
    .filter((example) => ids.has(example.targetId))
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

const refSummary = (ref: WayfinderEntityRef) => ({
  id: ref.id,
  kind: ref.kind,
  ...(ref.trailId === undefined ? {} : { trailId: ref.trailId }),
  ...(ref.versionKey === undefined ? {} : { versionKey: ref.versionKey }),
});

const describeSurface = (graph: TopoGraph, id: string) => {
  const surface = surfaceSummaries(graph).find(
    (candidate) => candidate.id === id
  );
  return surface === undefined ? undefined : { ...surface, kind: 'surface' };
};

const describeFacet = (graph: TopoGraph, id: string) => {
  const facet = facetSummaries(graph).find((candidate) => candidate.id === id);
  return facet === undefined ? undefined : { ...facet, kind: 'facet' };
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
  const facet = describeFacet(graph, id);
  if (facet !== undefined) {
    candidates.push({ kind: 'facet', value: facet });
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
  if (input.kind === 'facet') {
    return Result.ok(describeFacet(graph, input.id));
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
  kind === 'facet' ||
  kind === 'surface' ||
  kind === 'version'
    ? undefined
    : kind;

const contractEntry = (
  entry: TopoGraphEntry
): Readonly<Record<string, unknown>> => ({
  id: entry.id,
  input: entry.input ?? null,
  kind: entry.kind,
  output: entry.output ?? null,
  payload: entry.payload ?? null,
  resources: entry.resources ?? [],
  schema: entry.schema ?? null,
  version: entry.version ?? null,
});

const contractSurfaceOrFacet = (
  graph: TopoGraph,
  input: ContractInput
): ResolvedEntity | undefined => {
  if (input.kind === 'facet') {
    return describeFacet(graph, input.id);
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
  if (input.kind === 'surface' || input.kind === 'facet') {
    return Result.ok(contractSurfaceOrFacet(graph, input));
  }
  if (input.kind === undefined) {
    const candidates: ResolvedEntityCandidate[] = [];
    const entry = entryById(graph, input.id);
    if (entry !== undefined) {
      candidates.push({ kind: entry.kind, value: contractEntry(entry) });
    }
    const facet = describeFacet(graph, input.id);
    if (facet !== undefined) {
      candidates.push({ kind: 'facet', value: facet });
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
    return Result.ok(contractSurfaceOrFacet(graph, input));
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
    filterWayfinderEntityRefs(graph, kindFilter(kind, filters))
      .slice(0, limit)
      .map((ref) => ref.id)
  );

export const wayfindOverviewTrail = trail('wayfind.overview', {
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const { graph } = loaded;
      return {
        ...envelope(loaded),
        counts: {
          contours: contourSummaries(graph).length,
          examples: exampleSummaries(graph).length,
          facets: facetSummaries(graph).length,
          resources: resourceSummaries(graph).length,
          signals: signalSummaries(graph).length,
          surfaces: surfaceSummaries(graph).length,
          trails: trailSummaries(graph).length,
          versions: versionSummaries(graph).length,
        },
        generatedAt: graph.generatedAt,
        workspace:
          graph.workspace === undefined
            ? null
            : {
                collisionCount: graph.workspace.collisions?.length ?? 0,
                trailCount: Object.keys(graph.workspace.trails).length,
              },
      };
    }),
  description: 'Summarize the saved Wayfinder topo graph',
  examples: [{ input: {}, name: 'Overview' }],
  input: sourceInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    counts: z.object({
      contours: z.number(),
      examples: z.number(),
      facets: z.number(),
      resources: z.number(),
      signals: z.number(),
      surfaces: z.number(),
      trails: z.number(),
      versions: z.number(),
    }),
    generatedAt: z.string(),
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
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      matches: filterWayfinderEntityRefs(loaded.graph, input.filters ?? {})
        .slice(0, input.limit)
        .map(refSummary),
    })),
  description: 'Find topo graph entities with typed filters',
  examples: [{ input: { filters: { kind: 'trail' } }, name: 'Find trails' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    matches: z.array(refOutputSchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindTrailsTrail = trail('wayfind.trails', {
  blaze: async (input, ctx) =>
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
  description: 'List saved trail contracts',
  examples: [{ input: {}, name: 'List trails' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    trails: z.array(trailSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindContoursTrail = trail('wayfind.contours', {
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'contour',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        contours: contourSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  description: 'List saved contour contracts',
  examples: [{ input: {}, name: 'List contours' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    contours: z.array(contourSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindResourcesTrail = trail('wayfind.resources', {
  blaze: async (input, ctx) =>
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
  description: 'List saved resource contracts and usage',
  examples: [{ input: {}, name: 'List resources' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    resources: z.array(resourceSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindSignalsTrail = trail('wayfind.signals', {
  blaze: async (input, ctx) =>
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
  description: 'List saved signal contracts and graph usage',
  examples: [{ input: {}, name: 'List signals' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    signals: z.array(signalSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindSurfacesTrail = trail('wayfind.surfaces', {
  blaze: async (input, ctx) =>
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
  description: 'List saved direct and facet-projected surfaces',
  examples: [{ input: {}, name: 'List surfaces' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    surfaces: z.array(surfaceSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindFacetsTrail = trail('wayfind.facets', {
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => {
      const ids = filteredIds(
        loaded.graph,
        'facet',
        input.filters,
        input.limit
      );
      return {
        ...envelope(loaded),
        facets: facetSummaries(loaded.graph).filter((entry) =>
          ids.has(entry.id)
        ),
      };
    }),
  description: 'List saved facet membership',
  examples: [{ input: {}, name: 'List facets' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    facets: z.array(facetSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindVersionsTrail = trail('wayfind.versions', {
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      versions: filteredVersionSummaries(
        loaded.graph,
        input.filters,
        input.limit
      ),
    })),
  description: 'List saved trail version contracts',
  examples: [{ input: {}, name: 'List versions' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    versions: z.array(versionSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindExamplesTrail = trail('wayfind.examples', {
  blaze: async (input, ctx) =>
    withGraph(input, ctx.cwd, (loaded) => ({
      ...envelope(loaded),
      examples: filteredExampleSummaries(
        loaded.graph,
        input.filters,
        input.limit
      ),
    })),
  description: 'List saved examples without executing trails',
  examples: [{ input: {}, name: 'List examples' }],
  input: filteredInputSchema,
  intent: 'read',
  output: envelopeSchema.extend({
    examples: z.array(exampleSummarySchema).readonly(),
  }),
  visibility: 'internal',
});

export const wayfindDescribeTrail = trail('wayfind.describe', {
  args: ['id'],
  blaze: async (input, ctx) => {
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
  description: 'Inspect one saved topo graph entity',
  examples: [{ input: { id: 'user.create' }, name: 'Describe entity' }],
  input: inspectInputSchema,
  intent: 'read',
  output: describeOutputSchema,
  visibility: 'internal',
});

export const wayfindContractTrail = trail('wayfind.contract', {
  args: ['id'],
  blaze: async (input, ctx) => {
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
  description: 'Inspect one saved input/output contract',
  examples: [{ input: { id: 'user.create' }, name: 'Inspect contract' }],
  input: contractInputSchema,
  intent: 'read',
  output: contractOutputSchema,
  visibility: 'internal',
});

export const wayfinderTopo = topo('wayfinder', {
  wayfindContoursTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindExamplesTrail,
  wayfindFacetsTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSignalsTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
});
