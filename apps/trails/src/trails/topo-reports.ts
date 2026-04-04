import type { Topo, Trail } from '@ontrails/core';

import { REPORT_CONTRACT_VERSION, REPORT_VERSION } from './topo-constants.js';

export interface BriefReport {
  readonly name: string;
  readonly version: string;
  readonly contractVersion: string;
  readonly features: {
    readonly provisions: boolean;
    readonly outputSchemas: boolean;
    readonly examples: boolean;
    readonly detours: boolean;
    readonly signals: boolean;
  };
  readonly trails: number;
  readonly signals: number;
  readonly provisions: number;
}

export interface SurveyListReport {
  readonly count: number;
  readonly entries: readonly {
    readonly examples: number;
    readonly id: string;
    readonly kind: string;
    readonly safety: string;
  }[];
  readonly provisionCount: number;
  readonly provisions: readonly {
    readonly description: string | null;
    readonly health: 'available' | 'none';
    readonly id: string;
    readonly kind: 'provision';
    readonly lifetime: 'singleton';
    readonly usedBy: readonly string[];
  }[];
}

export interface TrailDetailReport {
  readonly description: string | null;
  readonly detours: Trail<unknown, unknown>['detours'] | null;
  readonly examples: readonly unknown[];
  readonly crosses: readonly string[];
  readonly id: string;
  readonly intent: 'read' | 'write' | 'destroy';
  readonly kind: string;
  readonly safety: string;
  readonly provisions: readonly string[];
}

const trailHas = (raw: Record<string, unknown>, key: string): boolean => {
  if (key === 'examples') {
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
  hasProvisions: boolean;
} => {
  const trails = [...app.trails.values()].map(
    (item) => item as unknown as Record<string, unknown>
  );
  return {
    hasDetours: trails.some((r) => trailHas(r, 'detours')),
    hasExamples: trails.some((r) => trailHas(r, 'examples')),
    hasOutputSchemas: trails.some((r) => trailHas(r, 'output')),
    hasProvisions: trails.some(
      (r) =>
        Array.isArray(r['provisions']) &&
        (r['provisions'] as unknown[]).length > 0
    ),
  };
};

export const generateBriefReport = (app: Topo): BriefReport => {
  const { hasDetours, hasExamples, hasOutputSchemas, hasProvisions } =
    detectFeatures(app);

  return {
    contractVersion: REPORT_CONTRACT_VERSION,
    features: {
      detours: hasDetours,
      examples: hasExamples,
      outputSchemas: hasOutputSchemas,
      provisions: hasProvisions,
      signals: app.signals.size > 0,
    },
    name: app.name,
    provisions: app.provisions.size,
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

const buildProvisionUsage = (
  app: Topo
): ReadonlyMap<string, readonly string[]> => {
  const usage = new Map<string, string[]>();

  for (const trailDef of app.list()) {
    for (const declaredProvision of trailDef.provisions) {
      const users = usage.get(declaredProvision.id) ?? [];
      users.push(trailDef.id);
      usage.set(declaredProvision.id, users);
    }
  }

  return new Map(
    [...usage.entries()].map(([id, users]) => [id, users.toSorted()] as const)
  );
};

const provisionHealthStatus = (provision: {
  health?: unknown;
}): 'available' | 'none' =>
  provision.health === undefined ? 'none' : 'available';

export const formatProvisionDetail = (
  app: Topo,
  provisionId: string
): object => {
  const item = app.getProvision(provisionId);
  const usedBy = buildProvisionUsage(app).get(provisionId) ?? [];

  return {
    description: item?.description ?? null,
    health: item ? provisionHealthStatus(item) : 'none',
    id: provisionId,
    kind: 'provision',
    lifetime: 'singleton',
    usedBy,
  };
};

const formatProvisionList = (app: Topo): SurveyListReport['provisions'] => {
  const usage = buildProvisionUsage(app);
  return app
    .listProvisions()
    .map((provision) => ({
      description: provision.description ?? null,
      health: provisionHealthStatus(provision),
      id: provision.id,
      kind: provision.kind,
      lifetime: 'singleton' as const,
      usedBy: usage.get(provision.id) ?? [],
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
};

export const generateSurveyList = (app: Topo): SurveyListReport => {
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

  const provisions = formatProvisionList(app);

  return {
    count: items.length,
    entries,
    provisionCount: provisions.length,
    provisions,
  };
};

export const generateTrailDetail = (
  item: Trail<unknown, unknown>
): TrailDetailReport => {
  const safety = safetyLabel(
    item as unknown as { intent?: 'read' | 'write' | 'destroy' }
  );

  return {
    crosses: item.crosses.toSorted(),
    description: item.description ?? null,
    detours: item.detours ?? null,
    examples: item.examples ?? [],
    id: item.id,
    intent: item.intent,
    kind: item.kind,
    provisions: item.provisions.map((provision) => provision.id).toSorted(),
    safety,
  };
};
