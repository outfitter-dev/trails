import {
  filterSurfaceTrails,
  isDraftId,
  zodToJsonSchema,
} from '@ontrails/core';
import type { Topo, Trail } from '@ontrails/core';

import type {
  JsonSchema,
  TopoGraphLibraryCollision,
  TopoGraphLibraryExclusion,
  TopoGraphLibraryExport,
  TopoGraphLibraryProjection,
} from './types.js';

const sortKeys = <T extends Record<string, unknown>>(obj: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).toSorted()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
};

const deepSortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const toSortedJsonSchema = (schema: unknown): JsonSchema => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = zodToJsonSchema(schema as any);
  return deepSortKeys(raw) as JsonSchema;
};

const deriveLibraryExportName = (trailId: string): string => {
  const words = trailId.split(/[.-]/u).filter((word) => word.length > 0);
  return words
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join('');
};

const isInternalTrail = (trail: Trail<unknown, unknown, unknown>): boolean =>
  trail.visibility === 'internal' || trail.meta?.['internal'] === true;

const collectLibraryExclusions = (
  topo: Topo,
  selectedIds: ReadonlySet<string>
): readonly TopoGraphLibraryExclusion[] => {
  const excluded: TopoGraphLibraryExclusion[] = [];

  for (const trail of topo.trails.values()) {
    if (selectedIds.has(trail.id)) {
      continue;
    }
    if (isDraftId(trail.id)) {
      excluded.push({ reason: 'draft', trailId: trail.id });
    } else if (trail.activationSources.length > 0) {
      excluded.push({ reason: 'activation', trailId: trail.id });
    } else if (isInternalTrail(trail as Trail<unknown, unknown, unknown>)) {
      excluded.push({ reason: 'internal', trailId: trail.id });
    }
  }

  return excluded.toSorted((a, b) => a.trailId.localeCompare(b.trailId));
};

export const collectLibraryProjection = (
  topo: Topo
): TopoGraphLibraryProjection => {
  const selected = filterSurfaceTrails([...topo.trails.values()]).filter(
    (trail) => !isDraftId(trail.id)
  );
  const selectedIds = new Set(selected.map((trail) => trail.id));
  const namesToTrailIds = new Map<string, string[]>();
  const collisionNames = new Set<string>();
  const exports: TopoGraphLibraryExport[] = [];

  for (const trail of selected.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const exportName = deriveLibraryExportName(trail.id);
    const existing = namesToTrailIds.get(exportName);
    if (existing !== undefined) {
      existing.push(trail.id);
      collisionNames.add(exportName);
      continue;
    }

    namesToTrailIds.set(exportName, [trail.id]);
    exports.push(
      sortKeys({
        ...(trail.description === undefined
          ? {}
          : { description: trail.description }),
        exportName,
        ...(trail.input === undefined
          ? {}
          : { input: toSortedJsonSchema(trail.input) }),
        intent: trail.intent,
        nameSource: 'derived' as const,
        ...(trail.output === undefined
          ? {}
          : { output: toSortedJsonSchema(trail.output) }),
        resources: trail.resources.map((resource) => resource.id).toSorted(),
        trailId: trail.id,
        ...(trail.version === undefined ? {} : { version: trail.version }),
      })
    );
  }

  const collisions: TopoGraphLibraryCollision[] = [...collisionNames]
    .map((name) => ({
      exportName: name,
      trailIds: namesToTrailIds.get(name) ?? [],
    }))
    .toSorted((a, b) => a.exportName.localeCompare(b.exportName));

  return sortKeys({
    app: topo.name,
    collisions,
    excluded: collectLibraryExclusions(topo, selectedIds),
    exports,
  }) as unknown as TopoGraphLibraryProjection;
};
