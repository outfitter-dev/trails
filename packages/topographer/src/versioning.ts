import {
  DETOUR_MAX_ATTEMPTS_CAP,
  deriveSupportedTrailVersions,
  getTrailVersionEntryKind,
} from '@ontrails/core';
import type { AnyTrail, TrailVersionEntry } from '@ontrails/core';

import type { JsonSchema, TopoGraphVersionEntry } from './types.js';

type SchemaProjector = (schema: unknown) => JsonSchema;

const sortPlainRecord = <T extends Record<string, unknown>>(value: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = value[key];
  }
  return sorted as T;
};

const projectVersionDetours = (
  entry: TrailVersionEntry
): TopoGraphVersionEntry['detours'] => {
  const raw = entry as unknown as Record<string, unknown>;
  const { detours } = raw;
  if (!Array.isArray(detours) || detours.length === 0) {
    return undefined;
  }

  return detours.map((detour) => {
    const candidate = detour as {
      readonly maxAttempts?: number | undefined;
      readonly on?: { readonly name?: string | undefined } | undefined;
    };
    return {
      maxAttempts: Math.max(
        1,
        Math.min(candidate.maxAttempts ?? 1, DETOUR_MAX_ATTEMPTS_CAP)
      ),
      on: candidate.on?.name ?? 'Error',
    };
  });
};

const projectVersionRuntimeRefs = (
  entry: TrailVersionEntry,
  field: 'crosses' | 'resources'
): readonly string[] | undefined => {
  const raw = entry as unknown as Record<string, unknown>;
  const values = raw[field];
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const refs: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      refs.push(value);
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { readonly id?: unknown }).id === 'string'
    ) {
      refs.push((value as { readonly id: string }).id);
    }
  }

  return refs.toSorted();
};

export const projectTrailVersionEntry = (
  entry: TrailVersionEntry,
  projectSchema: SchemaProjector
): TopoGraphVersionEntry => {
  const projected: Record<string, unknown> = {
    input: projectSchema(entry.input),
    kind: getTrailVersionEntryKind(entry),
    output: projectSchema(entry.output),
  };

  if (entry.status !== undefined) {
    projected['status'] = sortPlainRecord({ ...entry.status });
  }

  if (projected['kind'] === 'fork') {
    const crosses = projectVersionRuntimeRefs(entry, 'crosses');
    const resources = projectVersionRuntimeRefs(entry, 'resources');
    const detours = projectVersionDetours(entry);
    if (crosses !== undefined) {
      projected['crosses'] = crosses;
    }
    if (resources !== undefined) {
      projected['resources'] = resources;
    }
    if (detours !== undefined) {
      projected['detours'] = detours;
    }
  }

  return sortPlainRecord(projected) as unknown as TopoGraphVersionEntry;
};

export const projectTrailVersions = (
  trail: AnyTrail,
  projectSchema: SchemaProjector
):
  | {
      readonly supports: readonly number[];
      readonly version: number;
      readonly versions?: Readonly<Record<string, TopoGraphVersionEntry>>;
    }
  | undefined => {
  if (trail.version === undefined) {
    return undefined;
  }

  const projectedEntries: Record<string, TopoGraphVersionEntry> = {};
  for (const [rawVersion, entry] of Object.entries(
    trail.versions ?? {}
  ).toSorted(([left], [right]) => Number(left) - Number(right))) {
    projectedEntries[rawVersion] = projectTrailVersionEntry(
      entry,
      projectSchema
    );
  }

  return {
    supports: deriveSupportedTrailVersions(trail),
    version: trail.version,
    ...(Object.keys(projectedEntries).length > 0
      ? { versions: projectedEntries }
      : {}),
  };
};
