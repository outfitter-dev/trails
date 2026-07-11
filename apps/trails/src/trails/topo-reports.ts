import {
  DETOUR_MAX_ATTEMPTS_CAP,
  deriveTrailCliCommandProjection,
  filterSurfaceTrails,
  isArchivedTrailVersionEntry,
  zodToJsonSchema,
} from '@ontrails/core';
import type { AnyTrail, Signal, Topo } from '@ontrails/core';
import { deriveHttpMethod } from '@ontrails/http';
import type { HttpMethod } from '@ontrails/http';
import { deriveToolName } from '@ontrails/mcp';
import { deriveTopoGraph } from '@ontrails/topographer';
import type {
  JsonSchema,
  TopoGraph,
  TopoGraphActivationEdge,
  TopoGraphEntry,
  TopoGraphFieldOverride,
  TopoGraphLayerReference,
  TopoGraphVersionEntry,
} from '@ontrails/topographer';
import { z } from 'zod';

import type {
  ActivationChainReport,
  ActivationEdgeReport,
  ActivationGraphReport,
  ActivationOverviewReport,
  ActivationSourceReport,
  SignalActivationRelations,
} from './topo-activation.js';
import {
  deriveActivationGraph,
  deriveDeclaredTrailActivation,
  deriveSignalActivationRelations,
} from './topo-activation.js';
import { REPORT_CONTRACT_VERSION, REPORT_VERSION } from './topo-constants.js';

export type {
  ActivationChainReport,
  ActivationEdgeReport,
  ActivationGraphReport,
  ActivationOverviewReport,
  ActivationSourceReport,
  SignalActivationRelations,
  TrailActivationReport,
} from './topo-activation.js';

export const briefReportSchema = z.object({
  contractVersion: z.string(),
  features: z.object({
    detours: z.boolean(),
    examples: z.boolean(),
    outputSchemas: z.boolean(),
    resources: z.boolean(),
    signals: z.boolean(),
  }),
  name: z.string(),
  resources: z.number(),
  signals: z.number(),
  trails: z.number(),
  version: z.string(),
});

type BriefReportShape = z.infer<typeof briefReportSchema>;

export type BriefReport = Readonly<
  Omit<BriefReportShape, 'features'> & {
    readonly features: Readonly<BriefReportShape['features']>;
  }
>;

export type SurfaceLayerKey = 'cli' | 'http' | 'mcp';

export type SurfaceLayerNames = Readonly<
  Record<SurfaceLayerKey, readonly string[]>
>;

export type ShippedSurfaceKey = 'cli' | 'mcp' | 'http';

export type SurfaceProjectionSource = 'authored' | 'default-derived';

export type ShippedSurfaceProjection =
  | {
      readonly commandPath: readonly string[];
      readonly derivedName: string;
      readonly method: null;
      readonly source: SurfaceProjectionSource;
      readonly surface: 'cli';
      readonly trailId: string;
    }
  | {
      readonly derivedName: string;
      readonly method: null;
      readonly source: SurfaceProjectionSource;
      readonly surface: 'mcp';
      readonly toolName: string;
      readonly trailId: string;
    }
  | {
      readonly derivedName: string;
      readonly method: HttpMethod;
      readonly path: string;
      readonly source: SurfaceProjectionSource;
      readonly surface: 'http';
      readonly trailId: string;
    };

export interface ShippedSurfaceInventoryReport {
  readonly count: number;
  readonly excludedSurfaces: readonly {
    readonly reason: string;
    readonly status: 'planned';
    readonly surface: 'websocket';
  }[];
  readonly projections: readonly ShippedSurfaceProjection[];
  readonly shippedSurfaces: readonly ShippedSurfaceKey[];
  readonly trails: readonly {
    readonly explicitSurfaces: readonly string[];
    readonly projections: readonly ShippedSurfaceProjection[];
    readonly trailId: string;
  }[];
}

type TopoGraphEntityEntry = TopoGraphEntry & { readonly kind: 'entity' };

export interface TrailDetailOptions {
  readonly surfaceLayerNames?: Partial<SurfaceLayerNames> | undefined;
  readonly topoGraph?: TopoGraph | undefined;
}

export interface SurveyListReport {
  readonly activation: ActivationOverviewReport;
  readonly count: number;
  readonly entries: readonly {
    readonly activatedBy: readonly string[];
    readonly activates: readonly string[];
    readonly examples: number;
    readonly id: string;
    readonly kind: string;
    readonly safety: string;
  }[];
  readonly resourceCount: number;
  readonly resources: readonly {
    readonly description: string | null;
    readonly health: 'available' | 'none';
    readonly id: string;
    readonly kind: 'resource';
    readonly lifetime: 'singleton';
    readonly usedBy: readonly string[];
  }[];
  readonly signalCount: number;
  readonly signals: readonly {
    readonly consumers: readonly string[];
    readonly description: string | null;
    readonly examples: number;
    readonly from: readonly string[];
    readonly id: string;
    readonly kind: 'signal';
    readonly payloadSchema: boolean;
    readonly producers: readonly string[];
  }[];
}

export interface TrailDetailReport {
  readonly activatedBy: readonly string[];
  readonly activates: readonly string[];
  readonly activationChains: readonly ActivationChainReport[];
  readonly activationContext: {
    readonly edgeCount: number;
    readonly sourceCount: number;
    readonly sourceKeys: readonly string[];
    readonly trailIds: readonly string[];
  };
  readonly activationEdges: readonly ActivationEdgeReport[];
  readonly activationSources: readonly ActivationSourceReport[];
  readonly cli: {
    readonly path: readonly string[];
    readonly routes?: NonNullable<TopoGraphEntry['cli']>['routes'];
  } | null;
  /**
   * Composed layer names visible at the survey boundary.
   *
   * Reports the names of typed layers that wrap this trail at execution time,
   * in the framework's composition order: `topo → surface → trail`
   * (outermost-first). Surface-scope layers are keyed by surface because
   * each surface owns its own attachment set.
   */
  readonly composedLayers: {
    readonly topo: readonly string[];
    readonly surface: SurfaceLayerNames;
    readonly trail: readonly string[];
  };
  readonly entityDetails: readonly TopoGraphEntityEntry[];
  readonly entities: readonly string[];
  readonly description: string | null;
  readonly detours:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: readonly unknown[];
  readonly fieldOverrides: readonly TopoGraphFieldOverride[];
  readonly composes: readonly string[];
  readonly fires: readonly string[];
  readonly governance: Readonly<Record<string, unknown>> | null;
  readonly id: string;
  readonly input: JsonSchema | null;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly kind: 'trail';
  readonly layers: readonly TopoGraphLayerReference[];
  readonly on: readonly string[];
  readonly output: JsonSchema | null;
  readonly pattern: string | null;
  readonly safety: string;
  readonly resources: readonly string[];
  readonly surfaceProjections: readonly ShippedSurfaceProjection[];
  readonly surfaces: readonly string[];
  readonly supports: readonly number[];
  readonly version: number | null;
  readonly versions: Readonly<Record<string, TopoGraphVersionEntry>>;
}

export interface SignalDetailReport {
  readonly consumers: readonly string[];
  readonly description: string | null;
  readonly examples: readonly unknown[];
  readonly from: readonly string[];
  readonly id: string;
  readonly kind: 'signal';
  /**
   * The signal's payload schema (JSON Schema object), or `null` when the
   * surface-map entry is missing for this signal. `null` is meaningful:
   * it matches the list view's `payloadSchema: false` flag and lets
   * consumers distinguish "schema not found" from "schema accepts any
   * value" (the latter would be an empty object `{}`).
   */
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly producers: readonly string[];
}

const countLiveTrailVersionExamples = (trail: AnyTrail): number => {
  let count = 0;
  for (const entry of Object.values(trail.versions ?? {})) {
    if (isArchivedTrailVersionEntry(entry)) {
      continue;
    }
    count += entry.examples?.length ?? 0;
  }
  return count;
};

export const countTrailExamples = (trail: AnyTrail): number =>
  (trail.examples?.length ?? 0) + countLiveTrailVersionExamples(trail);

const detectFeatures = (
  app: Topo
): {
  hasDetours: boolean;
  hasExamples: boolean;
  hasOutputSchemas: boolean;
  hasResources: boolean;
} => {
  const trails = [...app.trails.values()];
  return {
    hasDetours: trails.some((trail) => trail.detours.length > 0),
    hasExamples: trails.some((trail) => countTrailExamples(trail) > 0),
    hasOutputSchemas: trails.some((trail) => trail.output !== undefined),
    hasResources: trails.some((trail) => trail.resources.length > 0),
  };
};

export const deriveBriefReport = (app: Topo): BriefReport => {
  const { hasDetours, hasExamples, hasOutputSchemas, hasResources } =
    detectFeatures(app);

  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    features: {
      detours: hasDetours,
      examples: hasExamples,
      outputSchemas: hasOutputSchemas,
      resources: hasResources,
      signals: app.signals.size > 0,
    },
    name: app.name,
    resources: app.resources.size,
    signals: app.signals.size,
    trails: app.trails.size,
    version: REPORT_VERSION,
  };
};

const safetyLabel = (entry: {
  intent?: 'read' | 'write' | 'destroy';
}): string => {
  if (entry.intent === 'destroy') {
    return 'destroy';
  }
  if (entry.intent === 'write') {
    return 'write';
  }
  if (entry.intent === 'read') {
    return 'read';
  }
  return '-';
};

const buildResourceUsage = (
  app: Topo
): ReadonlyMap<string, readonly string[]> => {
  const usage = new Map<string, string[]>();

  for (const trailDef of app.list()) {
    for (const declaredResource of trailDef.resources) {
      const users = usage.get(declaredResource.id) ?? [];
      users.push(trailDef.id);
      usage.set(declaredResource.id, users);
    }
  }

  return new Map(
    [...usage.entries()].map(([id, users]) => [id, users.toSorted()] as const)
  );
};

const resourceHealthStatus = (resource: {
  health?: unknown;
}): 'available' | 'none' =>
  resource.health === undefined ? 'none' : 'available';

export const deriveResourceDetail = (app: Topo, resourceId: string): object => {
  const item = app.getResource(resourceId);
  const usedBy = buildResourceUsage(app).get(resourceId) ?? [];

  return {
    description: item?.description ?? null,
    health: item ? resourceHealthStatus(item) : 'none',
    id: resourceId,
    kind: 'resource',
    lifetime: 'singleton',
    usedBy,
  };
};

const formatResourceList = (app: Topo): SurveyListReport['resources'] => {
  const usage = buildResourceUsage(app);
  return app
    .listResources()
    .map((resource) => ({
      description: resource.description ?? null,
      health: resourceHealthStatus(resource),
      id: resource.id,
      kind: resource.kind,
      lifetime: 'singleton' as const,
      usedBy: usage.get(resource.id) ?? [],
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
};

const formatSignalList = (
  app: Topo,
  relations: ReadonlyMap<string, SignalActivationRelations>
): SurveyListReport['signals'] =>
  app
    .listSignals()
    .map((signalDef) => {
      const related = relations.get(signalDef.id);
      const consumers = related?.consumers ?? [];
      const producers = related?.producers ?? [];
      return {
        consumers,
        description: signalDef.description ?? null,
        examples: signalDef.examples?.length ?? 0,
        from: signalDef.from?.toSorted() ?? [],
        id: signalDef.id,
        kind: signalDef.kind,
        // Mirror the store path (`mapSignalRow` in `topo-store-read.ts`) which
        // derives this from the surface-map entry. SignalSpec<T> requires
        // `payload` so this is `true` in practice today; the explicit check
        // keeps the in-memory and store reports self-consistent if a future
        // SignalSpec variant ever omits `payload`.
        payloadSchema: signalDef.payload !== undefined,
        producers,
      };
    })
    .toSorted((a, b) => a.id.localeCompare(b.id));

export const deriveSurveyList = (app: Topo): SurveyListReport => {
  const items = app.list();
  const activation = deriveActivationGraph(app);
  const entries = items.map((item) => {
    const trailActivation =
      activation.trails.get(item.id) ?? deriveDeclaredTrailActivation(item);
    const safety = safetyLabel(
      item as unknown as { intent?: 'read' | 'write' | 'destroy' }
    );
    const examples = countTrailExamples(item);

    return {
      activatedBy: trailActivation.activatedBy,
      activates: trailActivation.activates,
      examples,
      id: item.id,
      kind: item.kind,
      safety,
    };
  });

  const resources = formatResourceList(app);
  const signals = formatSignalList(app, activation.signals);

  return {
    activation: activation.overview,
    count: items.length,
    entries,
    resourceCount: resources.length,
    resources,
    signalCount: signals.length,
    signals,
  };
};

export const deriveSignalDetail = (
  app: Topo,
  signalId: string,
  activationGraph?: ActivationGraphReport | undefined
): SignalDetailReport | undefined => {
  const signalDef = app.signals.get(signalId) as Signal<unknown> | undefined;
  if (signalDef === undefined) {
    return undefined;
  }
  const related =
    activationGraph?.signals.get(signalId) ??
    deriveSignalActivationRelations(app, signalId);

  return {
    consumers: [...related.consumers],
    description: signalDef.description ?? null,
    examples: [...(signalDef.examples ?? [])],
    from: signalDef.from?.toSorted() ?? [],
    id: signalDef.id,
    kind: 'signal',
    payload: zodToJsonSchema(signalDef.payload),
    producers: [...related.producers],
  };
};

const emptySurfaceLayerNames = (): SurfaceLayerNames => ({
  cli: [],
  http: [],
  mcp: [],
});

const normalizeSurfaceLayerNames = (
  names?: Partial<SurfaceLayerNames> | undefined
): SurfaceLayerNames => {
  const base = emptySurfaceLayerNames();
  if (names === undefined) {
    return base;
  }
  return {
    cli: names.cli ?? base.cli,
    http: names.http ?? base.http,
    mcp: names.mcp ?? base.mcp,
  };
};

const emptyActivationContext = (): TrailDetailReport['activationContext'] => ({
  edgeCount: 0,
  sourceCount: 0,
  sourceKeys: [],
  trailIds: [],
});

const activationContextFromTopoGraph = (
  topoGraph: TopoGraph | undefined,
  trailId: string,
  fallbackEdges: readonly TopoGraphActivationEdge[]
): TrailDetailReport['activationContext'] => {
  const edges =
    topoGraph?.activationGraph.edges.filter(
      (edge) => edge.trailId === trailId
    ) ?? fallbackEdges;
  if (edges.length === 0) {
    return emptyActivationContext();
  }
  return {
    edgeCount: edges.length,
    sourceCount: new Set(edges.map((edge) => edge.sourceKey)).size,
    sourceKeys: [...new Set(edges.map((edge) => edge.sourceKey))].toSorted(),
    trailIds: [...new Set(edges.map((edge) => edge.trailId))].toSorted(),
  };
};

const findTopoEntry = (
  topoGraph: TopoGraph | undefined,
  id: string,
  kind: TopoGraphEntry['kind']
): TopoGraphEntry | undefined =>
  topoGraph?.entries.find((entry) => entry.id === id && entry.kind === kind);

const trailActivationEdgesFromTopoGraph = (
  topoGraph: TopoGraph | undefined,
  trailId: string,
  fallback: readonly TopoGraphActivationEdge[]
): readonly TopoGraphActivationEdge[] =>
  topoGraph?.activationGraph.edges.filter((edge) => edge.trailId === trailId) ??
  fallback;

const SHIPPED_SURFACES = ['cli', 'mcp', 'http'] as const;

const PLANNED_SURFACE_EXCLUSIONS = [
  {
    reason: 'WebSocket is planned, but no public package or API ships yet.',
    status: 'planned' as const,
    surface: 'websocket' as const,
  },
] as const;

const surfaceOrder = (surface: ShippedSurfaceKey): number =>
  SHIPPED_SURFACES.indexOf(surface);

const sortSurfaceProjections = (
  projections: readonly ShippedSurfaceProjection[]
): readonly ShippedSurfaceProjection[] =>
  projections.toSorted(
    (a, b) =>
      a.trailId.localeCompare(b.trailId) ||
      surfaceOrder(a.surface) - surfaceOrder(b.surface)
  );

const explicitSurfacesForEntry = (
  entry: TopoGraphEntry | undefined
): readonly string[] => entry?.surfaces ?? [];

const projectionSource = (
  entry: TopoGraphEntry | undefined,
  surface: ShippedSurfaceKey
): SurfaceProjectionSource =>
  explicitSurfacesForEntry(entry).includes(surface)
    ? 'authored'
    : 'default-derived';

const deriveHttpPath = (trailId: string): string =>
  `/${trailId.replaceAll('.', '/')}`;

const isSurfaceEligibleTrail = (app: Topo, trail: AnyTrail): boolean =>
  filterSurfaceTrails([trail]).length > 0 &&
  app.trails.get(trail.id) !== undefined;

export const deriveShippedSurfaceProjectionsForTrail = (
  app: Topo,
  trail: AnyTrail,
  topoGraph?: TopoGraph | undefined
): readonly ShippedSurfaceProjection[] => {
  if (!isSurfaceEligibleTrail(app, trail)) {
    return [];
  }

  const entry = findTopoEntry(
    topoGraph ?? deriveTopoGraph(app),
    trail.id,
    'trail'
  );
  const commandPath =
    entry?.cli?.path ?? deriveTrailCliCommandProjection(trail).path;
  const httpMethod = deriveHttpMethod(trail.intent);
  const httpPath = deriveHttpPath(trail.id);
  const mcpToolName = deriveToolName(app.name, trail.id);

  return sortSurfaceProjections([
    {
      commandPath,
      derivedName: commandPath.join(' '),
      method: null,
      source: projectionSource(entry, 'cli'),
      surface: 'cli',
      trailId: trail.id,
    },
    {
      derivedName: mcpToolName,
      method: null,
      source: projectionSource(entry, 'mcp'),
      surface: 'mcp',
      toolName: mcpToolName,
      trailId: trail.id,
    },
    {
      derivedName: httpPath,
      method: httpMethod,
      path: httpPath,
      source: projectionSource(entry, 'http'),
      surface: 'http',
      trailId: trail.id,
    },
  ]);
};

const deriveFallbackSurfaceProjections = (
  entry: TopoGraphEntry | undefined
): readonly ShippedSurfaceProjection[] => {
  if (entry?.cli === undefined) {
    return [];
  }

  return [
    {
      commandPath: entry.cli.path,
      derivedName: entry.cli.path.join(' '),
      method: null,
      source: projectionSource(entry, 'cli'),
      surface: 'cli',
      trailId: entry.id,
    },
  ];
};

export const deriveShippedSurfaceProjectionInventory = (
  app: Topo
): ShippedSurfaceInventoryReport => {
  const topoGraph = deriveTopoGraph(app);
  const trails = filterSurfaceTrails(app.list()).map((trail) => {
    const entry = findTopoEntry(topoGraph, trail.id, 'trail');
    const projections = deriveShippedSurfaceProjectionsForTrail(
      app,
      trail,
      topoGraph
    );

    return {
      explicitSurfaces: explicitSurfacesForEntry(entry),
      projections,
      trailId: trail.id,
    };
  });
  const projections = sortSurfaceProjections(
    trails.flatMap((trail) => trail.projections)
  );

  return {
    count: trails.length,
    excludedSurfaces: PLANNED_SURFACE_EXCLUSIONS,
    projections,
    shippedSurfaces: SHIPPED_SURFACES,
    trails: trails.toSorted((a, b) => a.trailId.localeCompare(b.trailId)),
  };
};

const deriveResolvedSurfaceProjections = (
  app: Topo | undefined,
  trailId: string,
  topoEntry: TopoGraphEntry | undefined,
  topoGraph: TopoGraph | undefined
): readonly ShippedSurfaceProjection[] => {
  if (app === undefined) {
    return deriveFallbackSurfaceProjections(topoEntry);
  }

  const trail = app.trails.get(trailId);
  return trail === undefined
    ? deriveFallbackSurfaceProjections(topoEntry)
    : deriveShippedSurfaceProjectionsForTrail(app, trail, topoGraph);
};

const deriveResolvedTrailVersionDetail = (
  topoEntry: TopoGraphEntry | undefined
): Pick<TrailDetailReport, 'supports' | 'version' | 'versions'> => ({
  supports: topoEntry?.supports ?? [],
  version: topoEntry?.version ?? null,
  versions: topoEntry?.versions ?? {},
});

const deriveResolvedTrailGraphDetail = (
  app: Topo | undefined,
  trailId: string,
  fallbackActivationEdges: readonly TopoGraphActivationEdge[],
  topoGraphOverride?: TopoGraph | undefined
): Pick<
  TrailDetailReport,
  | 'activationContext'
  | 'activationEdges'
  | 'cli'
  | 'entityDetails'
  | 'entities'
  | 'fieldOverrides'
  | 'governance'
  | 'input'
  | 'layers'
  | 'output'
  | 'surfaceProjections'
  | 'surfaces'
  | 'supports'
  | 'version'
  | 'versions'
> => {
  const topoGraph =
    topoGraphOverride ?? (app === undefined ? undefined : deriveTopoGraph(app));
  const topoEntry = findTopoEntry(topoGraph, trailId, 'trail');
  const entities = topoEntry?.entities ?? [];
  const entityDetails = entities
    .map((entityId) => findTopoEntry(topoGraph, entityId, 'entity'))
    .filter(
      (entry): entry is TopoGraphEntityEntry =>
        entry !== undefined && entry.kind === 'entity'
    );

  return {
    activationContext: activationContextFromTopoGraph(
      topoGraph,
      trailId,
      fallbackActivationEdges
    ),
    activationEdges: trailActivationEdgesFromTopoGraph(
      topoGraph,
      trailId,
      fallbackActivationEdges
    ),
    cli: topoEntry?.cli ?? null,
    entities,
    entityDetails,
    fieldOverrides: topoEntry?.fieldOverrides ?? [],
    governance: topoEntry?.governance ?? null,
    input: topoEntry?.input ?? null,
    layers: topoEntry?.layers ?? [],
    output: topoEntry?.output ?? null,
    surfaceProjections: deriveResolvedSurfaceProjections(
      app,
      trailId,
      topoEntry,
      topoGraph
    ),
    surfaces: topoEntry?.surfaces ?? [],
    ...deriveResolvedTrailVersionDetail(topoEntry),
  };
};

const formatTrailDetours = (item: AnyTrail): TrailDetailReport['detours'] =>
  item.detours.length > 0
    ? item.detours.map((d) => ({
        maxAttempts: Math.max(
          1,
          Math.min(d.maxAttempts ?? 1, DETOUR_MAX_ATTEMPTS_CAP)
        ),
        on: d.on.name,
      }))
    : null;

export const deriveTrailDetail = (
  item: AnyTrail,
  app?: Topo | undefined,
  activationGraph?: ActivationGraphReport | undefined,
  options: TrailDetailOptions = {}
): TrailDetailReport => {
  const activation =
    app === undefined
      ? deriveDeclaredTrailActivation(item)
      : ((activationGraph ?? deriveActivationGraph(app)).trails.get(item.id) ??
        deriveDeclaredTrailActivation(item));
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  const trailLayerNames = item.layers.map((layer) => layer.name);
  const topoLayerNames = (app?.layers ?? []).map((layer) => layer.name);
  const graphDetail = deriveResolvedTrailGraphDetail(
    app,
    item.id,
    activation.edges,
    options.topoGraph
  );

  return {
    activatedBy: activation.activatedBy,
    activates: activation.activates,
    activationChains: activation.chains,
    activationContext: graphDetail.activationContext,
    activationEdges: graphDetail.activationEdges,
    activationSources: activation.sources,
    cli: graphDetail.cli,
    composedLayers: {
      surface: normalizeSurfaceLayerNames(options.surfaceLayerNames),
      topo: topoLayerNames,
      trail: trailLayerNames,
    },
    composes: item.composes.toSorted(),
    description: item.description ?? null,
    detours: formatTrailDetours(item),
    entities: graphDetail.entities,
    entityDetails: graphDetail.entityDetails,
    examples: item.examples ?? [],
    fieldOverrides: graphDetail.fieldOverrides,
    fires: activation.fires,
    governance: graphDetail.governance,
    id: item.id,
    input: graphDetail.input,
    intent: item.intent,
    kind: 'trail',
    layers: graphDetail.layers,
    on: activation.on,
    output: graphDetail.output,
    pattern: item.pattern ?? null,
    resources: item.resources.map((resource) => resource.id).toSorted(),
    safety,
    supports: graphDetail.supports,
    surfaceProjections: graphDetail.surfaceProjections,
    surfaces: graphDetail.surfaces,
    version: graphDetail.version,
    versions: graphDetail.versions,
  };
};
