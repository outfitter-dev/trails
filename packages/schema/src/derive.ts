/**
 * Derive a deterministic surface map from a Topo.
 */

import {
  deriveCliPath,
  getContourReferences,
  validateDraftFreeTopo,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  AnyContour,
  AnyResource,
  Signal,
  Topo,
  Trail,
} from '@ontrails/core';

import type { JsonSchema, SurfaceMap, SurfaceMapEntry } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort object keys lexicographically (shallow). */
const sortKeys = <T extends Record<string, unknown>>(obj: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).toSorted()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
};

/** Sort object keys recursively for deterministic JSON Schema output. */
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

/** Convert a Zod schema to a deterministically-keyed JSON Schema. */
const toSortedJsonSchema = (schema: unknown): JsonSchema => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = zodToJsonSchema(schema as any);
  return deepSortKeys(raw) as JsonSchema;
};

// ---------------------------------------------------------------------------
// Entry builders
// ---------------------------------------------------------------------------

/** Extract trailheads from a raw object. */
const extractTrailheads = (raw: Record<string, unknown>): string[] =>
  Array.isArray(raw['trailheads'])
    ? (raw['trailheads'] as string[]).toSorted()
    : [];

/** Add optional schemas to an entry. */
const addSchemas = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>
): void => {
  if (t.input) {
    entry['input'] = toSortedJsonSchema(t.input);
  }
  if (t.output) {
    entry['output'] = toSortedJsonSchema(t.output);
  }
};

const addContourSchema = (
  entry: Record<string, unknown>,
  contour: AnyContour
): void => {
  entry['schema'] = toSortedJsonSchema(contour);
};

/** Add safety markers to an entry. */
const addSafetyMarkers = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>
): void => {
  if (t.intent !== 'write') {
    entry['intent'] = t.intent;
  }
  if (t.idempotent === true) {
    entry['idempotent'] = true;
  }
};

/** Add deprecation and detours to an entry. */
const addExtendedMetadata = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>,
  raw: Record<string, unknown>
): void => {
  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }
  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }
  if (t.detours.length > 0) {
    entry['detours'] = t.detours.map((d) => ({
      maxAttempts: Math.max(1, Math.min(d.maxAttempts ?? 1, 5)),
      on: d.on.name,
    }));
  }
};

/** Add optional meta fields to an entry. */
const addMetadata = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>,
  raw: Record<string, unknown>
): void => {
  if (t.description !== undefined) {
    entry['description'] = t.description;
  }
  if (t.pattern !== undefined) {
    entry['pattern'] = t.pattern;
  }
  addSafetyMarkers(entry, t);
  addExtendedMetadata(entry, t, raw);
};

const addTrailRelations = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>
): void => {
  if (t.crosses.length > 0) {
    entry['crosses'] = t.crosses.toSorted();
  }
  if (t.contours.length > 0) {
    entry['contours'] = t.contours.map((contour) => contour.name).toSorted();
  }
  if (t.resources.length > 0) {
    entry['resources'] = t.resources.map((resource) => resource.id).toSorted();
  }
};

const trailToEntry = (t: Trail<unknown, unknown, unknown>): SurfaceMapEntry => {
  const raw = t as unknown as Record<string, unknown>;
  const trailheads = extractTrailheads(raw);
  const entry: Record<string, unknown> = {
    cli: { path: deriveCliPath(t.id) },
    exampleCount: Array.isArray(t.examples) ? t.examples.length : 0,
    id: t.id,
    kind: t.kind,
    trailheads,
  };

  addSchemas(entry, t);
  addMetadata(entry, t, raw);
  addTrailRelations(entry, t);

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

/** Add optional event-specific fields. */
const addEventFields = (
  entry: Record<string, unknown>,
  e: Signal<unknown>,
  raw: Record<string, unknown>
): void => {
  if (e.payload) {
    entry['input'] = toSortedJsonSchema(e.payload);
  }
  if (e.description !== undefined) {
    entry['description'] = e.description;
  }
  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }
  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }
};

const signalToEntry = (e: Signal<unknown>): SurfaceMapEntry => {
  const raw = e as unknown as Record<string, unknown>;
  const trailheads = extractTrailheads(raw);
  const entry: Record<string, unknown> = {
    exampleCount: 0,
    id: e.id,
    kind: 'signal',
    trailheads,
  };
  addEventFields(entry, e, raw);
  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

const resourceToEntry = (resource: AnyResource): SurfaceMapEntry => {
  const entry: Record<string, unknown> = {
    exampleCount: 0,
    id: resource.id,
    kind: 'resource',
    trailheads: [],
  };

  if (resource.description !== undefined) {
    entry['description'] = resource.description;
  }
  if (resource.health !== undefined) {
    entry['healthcheck'] = true;
  }

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

const contourToEntry = (contour: AnyContour): SurfaceMapEntry => {
  const entry: Record<string, unknown> = {
    exampleCount: contour.examples?.length ?? 0,
    id: contour.name,
    identity: contour.identity,
    kind: 'contour',
    trailheads: [],
  };

  addContourSchema(entry, contour);

  const references = getContourReferences(contour);
  if (references.length > 0) {
    entry['references'] = references;
  }

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

const assertEstablishedTopo = (topo: Topo): void => {
  const validated = validateDraftFreeTopo(topo);
  if (validated.isErr()) {
    throw validated.error;
  }
};

const collectEntries = (topo: Topo): SurfaceMapEntry[] => [
  ...[...topo.contours.values()].map((contour) => contourToEntry(contour)),
  ...[...topo.trails.values()].map((trail) =>
    trailToEntry(trail as Trail<unknown, unknown, unknown>)
  ),
  ...[...topo.signals.values()].map((signal) =>
    signalToEntry(signal as Signal<unknown>)
  ),
  ...[...topo.resources.values()].map((resource) => resourceToEntry(resource)),
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic surface map from a Topo.
 *
 * Entries are sorted alphabetically by id. Object keys within each entry
 * are sorted lexicographically for stable serialization.
 */
export const deriveSurfaceMap = (topo: Topo): SurfaceMap => {
  assertEstablishedTopo(topo);
  const sorted = collectEntries(topo).toSorted((a, b) =>
    a.id.localeCompare(b.id)
  );

  return {
    entries: sorted,
    generatedAt: new Date().toISOString(),
    version: '1.0',
  };
};
