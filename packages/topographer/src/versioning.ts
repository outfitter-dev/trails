import {
  DETOUR_MAX_ATTEMPTS_CAP,
  TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH,
  deriveStructuredTrailExamples,
  ValidationError,
  deriveCurrentTrailVersionMarker,
  deriveShortestUnambiguousTrailVersionMarkerPrefix,
  deriveSupportedTrailVersions,
  deriveTrailVersionEntryMarker,
  deriveTrailVersionMarkers,
  getTrailVersionEntryKind,
  resolveTrailVersionMarkerPrefix,
} from '@ontrails/core';
import type {
  AnyTrail,
  TrailVersionEntry,
  TrailVersionMarkerBinding,
} from '@ontrails/core';

import type {
  JsonSchema,
  TopoGraphEntry,
  TopoGraphVersionEntry,
} from './types.js';

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
  const kind = getTrailVersionEntryKind(entry);
  const examples = deriveStructuredTrailExamples(entry.examples, {
    provenance: { source: 'trail.versions.examples' },
  });
  const projected: Record<string, unknown> = {
    exampleCount: entry.examples?.length ?? 0,
    input: projectSchema(entry.input),
    kind,
    marker: deriveTrailVersionEntryMarker(entry),
    output: projectSchema(entry.output),
  };

  if (examples !== undefined) {
    projected['examples'] = examples;
  }

  if (entry.status !== undefined) {
    projected['status'] = sortPlainRecord({ ...entry.status });
  }

  if (kind === 'fork') {
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

export interface TopoGraphVersionMarkerRecord {
  readonly current: boolean;
  readonly displayMarker?: string | undefined;
  readonly marker?: string | undefined;
  readonly version: number;
}

export interface TopoGraphVersionMarkerResolution extends TopoGraphVersionMarkerRecord {
  readonly prefix: string;
}

export const collectTopoGraphVersionMarkers = (
  entry: Pick<TopoGraphEntry, 'marker' | 'version' | 'versions'>
): readonly TrailVersionMarkerBinding[] => {
  if (entry.version === undefined) {
    return [];
  }

  const markers: TrailVersionMarkerBinding[] = [];
  if (entry.marker !== undefined) {
    markers.push({ marker: entry.marker, version: entry.version });
  }

  for (const [version, versionEntry] of Object.entries(entry.versions ?? {})) {
    const { marker } = versionEntry as { readonly marker?: unknown };
    if (typeof marker === 'string') {
      markers.push({ marker, version: Number(version) });
    }
  }

  return markers.toSorted((left, right) => left.version - right.version);
};

export const deriveTopoGraphVersionMarkerRecords = (
  entry: Pick<TopoGraphEntry, 'marker' | 'version' | 'versions'>
): readonly TopoGraphVersionMarkerRecord[] => {
  const markers = collectTopoGraphVersionMarkers(entry);
  const markerValues = markers.map((candidate) => candidate.marker);

  return markers.map((candidate) => ({
    ...candidate,
    current: candidate.version === entry.version,
    displayMarker: deriveShortestUnambiguousTrailVersionMarkerPrefix(
      candidate.marker,
      markerValues
    ),
  }));
};

const hasTopoGraphVersion = (
  entry: Pick<TopoGraphEntry, 'version' | 'versions'>,
  version: number
): boolean =>
  entry.version === version || Object.hasOwn(entry.versions ?? {}, version);

export const resolveTopoGraphVersionReference = (
  entry: Pick<TopoGraphEntry, 'marker' | 'version' | 'versions'>,
  reference: number | string
): TopoGraphVersionMarkerResolution => {
  const markers = collectTopoGraphVersionMarkers(entry);
  const markerValues = markers.map((candidate) => candidate.marker);

  if (typeof reference === 'number') {
    const match = markers.find((candidate) => candidate.version === reference);
    if (match !== undefined) {
      return {
        ...match,
        current: match.version === entry.version,
        displayMarker: deriveShortestUnambiguousTrailVersionMarkerPrefix(
          match.marker,
          markerValues
        ),
        prefix: String(reference),
      };
    }
    if (!hasTopoGraphVersion(entry, reference)) {
      throw new ValidationError(
        `Trail version ${reference} is not in the TopoGraph`
      );
    }

    return {
      current: reference === entry.version,
      prefix: String(reference),
      version: reference,
    };
  }

  if (/^\d+$/.test(reference)) {
    const version = Number(reference);
    if (hasTopoGraphVersion(entry, version)) {
      return resolveTopoGraphVersionReference(entry, version);
    }
    if (reference.length < TRAIL_VERSION_MARKER_MIN_PREFIX_LENGTH) {
      throw new ValidationError(
        `Trail version ${version} is not in the TopoGraph`
      );
    }
  }

  const markerPrefix = reference.startsWith('@')
    ? reference.slice(1)
    : reference;
  const resolved = resolveTrailVersionMarkerPrefix(markers, markerPrefix);
  return {
    ...resolved,
    current: resolved.version === entry.version,
    displayMarker: deriveShortestUnambiguousTrailVersionMarkerPrefix(
      resolved.marker,
      markerValues
    ),
  };
};

export const projectTrailVersions = (
  trail: AnyTrail,
  projectSchema: SchemaProjector
):
  | {
      readonly marker: string;
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

  const currentMarker = deriveCurrentTrailVersionMarker(trail);
  deriveTrailVersionMarkers(trail);

  return {
    marker: currentMarker,
    supports: deriveSupportedTrailVersions(trail),
    version: trail.version,
    ...(Object.keys(projectedEntries).length > 0
      ? { versions: projectedEntries }
      : {}),
  };
};
