import { DETOUR_MAX_ATTEMPTS_CAP, zodToJsonSchema } from '@ontrails/core';
import type { AnyTrail, Signal, Topo } from '@ontrails/core';
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
  readonly activationEdges: readonly ActivationEdgeReport[];
  readonly activationSources: readonly ActivationSourceReport[];
  readonly description: string | null;
  readonly detours:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: readonly unknown[];
  readonly crosses: readonly string[];
  readonly fires: readonly string[];
  readonly id: string;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly kind: 'trail';
  readonly on: readonly string[];
  readonly pattern: string | null;
  readonly safety: string;
  readonly resources: readonly string[];
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

const trailHas = (raw: Record<string, unknown>, key: string): boolean => {
  if (key === 'examples' || key === 'detours') {
    return Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0;
  }
  return Boolean(raw[key]);
};

const detectFeatures = (
  app: Topo
): {
  hasDetours: boolean;
  hasExamples: boolean;
  hasOutputSchemas: boolean;
  hasResources: boolean;
} => {
  const trails = [...app.trails.values()].map(
    (item) => item as unknown as Record<string, unknown>
  );
  return {
    hasDetours: trails.some((r) => trailHas(r, 'detours')),
    hasExamples: trails.some((r) => trailHas(r, 'examples')),
    hasOutputSchemas: trails.some((r) => trailHas(r, 'output')),
    hasResources: trails.some(
      (r) =>
        Array.isArray(r['resources']) &&
        (r['resources'] as unknown[]).length > 0
    ),
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
    const examples = Array.isArray(
      (item as unknown as { examples?: unknown[] }).examples
    )
      ? (item as unknown as { examples: unknown[] }).examples.length
      : 0;

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

export const deriveTrailDetail = (
  item: AnyTrail,
  app?: Topo | undefined,
  activationGraph?: ActivationGraphReport | undefined
): TrailDetailReport => {
  const activation =
    app === undefined
      ? deriveDeclaredTrailActivation(item)
      : ((activationGraph ?? deriveActivationGraph(app)).trails.get(item.id) ??
        deriveDeclaredTrailActivation(item));
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  return {
    activatedBy: activation.activatedBy,
    activates: activation.activates,
    activationChains: activation.chains,
    activationEdges: activation.edges,
    activationSources: activation.sources,
    crosses: item.crosses.toSorted(),
    description: item.description ?? null,
    detours:
      item.detours.length > 0
        ? item.detours.map((d) => ({
            maxAttempts: Math.max(
              1,
              Math.min(d.maxAttempts ?? 1, DETOUR_MAX_ATTEMPTS_CAP)
            ),
            on: d.on.name,
          }))
        : null,
    examples: item.examples ?? [],
    fires: activation.fires,
    id: item.id,
    intent: item.intent,
    kind: 'trail',
    on: activation.on,
    pattern: item.pattern ?? null,
    resources: item.resources.map((resource) => resource.id).toSorted(),
    safety,
  };
};
