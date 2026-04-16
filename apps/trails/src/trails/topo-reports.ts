import type { Topo, Trail } from '@ontrails/core';

import { REPORT_CONTRACT_VERSION, REPORT_VERSION } from './topo-constants.js';

export interface BriefReport {
  readonly name: string;
  readonly version: string;
  readonly contractVersion: string;
  readonly features: {
    readonly resources: boolean;
    readonly outputSchemas: boolean;
    readonly examples: boolean;
    readonly detours: boolean;
    readonly signals: boolean;
  };
  readonly trails: number;
  readonly signals: number;
  readonly resources: number;
}

export interface SurveyListReport {
  readonly count: number;
  readonly entries: readonly {
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
}

export interface TrailDetailReport {
  readonly description: string | null;
  readonly detours:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: readonly unknown[];
  readonly crosses: readonly string[];
  readonly id: string;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly kind: string;
  readonly safety: string;
  readonly resources: readonly string[];
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

export const deriveSurveyList = (app: Topo): SurveyListReport => {
  const items = app.list();
  const entries = items.map((item) => {
    const safety = safetyLabel(
      item as unknown as { intent?: 'read' | 'write' | 'destroy' }
    );
    const examples = Array.isArray(
      (item as unknown as { examples?: unknown[] }).examples
    )
      ? (item as unknown as { examples: unknown[] }).examples.length
      : 0;

    return {
      examples,
      id: item.id,
      kind: item.kind,
      safety,
    };
  });

  const resources = formatResourceList(app);

  return {
    count: items.length,
    entries,
    resourceCount: resources.length,
    resources,
  };
};

export const deriveTrailDetail = (
  item: Trail<unknown, unknown>
): TrailDetailReport => {
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  return {
    crosses: item.crosses.toSorted(),
    description: item.description ?? null,
    detours:
      item.detours.length > 0
        ? item.detours.map((d) => ({
            maxAttempts: d.maxAttempts ?? 1,
            on: d.on.name,
          }))
        : null,
    examples: item.examples ?? [],
    id: item.id,
    intent: item.intent,
    kind: item.kind,
    resources: item.resources.map((resource) => resource.id).toSorted(),
    safety,
  };
};
