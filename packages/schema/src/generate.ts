/**
 * Generate a deterministic trailhead map from a Topo.
 */

import {
  deriveCliPath,
  validateDraftFreeTopo,
  zodToJsonSchema,
} from '@ontrails/core';
import type { AnyResource, Signal, Topo, Trail } from '@ontrails/core';

import type { JsonSchema, TrailheadMap, TrailheadMapEntry } from './types.js';

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
  t: Trail<unknown, unknown>
): void => {
  if (t.input) {
    entry['input'] = toSortedJsonSchema(t.input);
  }
  if (t.output) {
    entry['output'] = toSortedJsonSchema(t.output);
  }
};

/** Add safety markers to an entry. */
const addSafetyMarkers = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown>
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
  t: Trail<unknown, unknown>,
  raw: Record<string, unknown>
): void => {
  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }
  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }
  if (t.detours) {
    const detoursSorted: Record<string, readonly string[]> = {};
    for (const key of Object.keys(t.detours).toSorted()) {
      detoursSorted[key] = (t.detours[key] ?? []).toSorted();
    }
    entry['detours'] = detoursSorted;
  }
};

/** Add optional meta fields to an entry. */
const addMetadata = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown>,
  raw: Record<string, unknown>
): void => {
  if (t.description !== undefined) {
    entry['description'] = t.description;
  }
  addSafetyMarkers(entry, t);
  addExtendedMetadata(entry, t, raw);
};

const trailToEntry = (t: Trail<unknown, unknown>): TrailheadMapEntry => {
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

  if (t.crosses.length > 0) {
    entry['crosses'] = t.crosses.toSorted();
  }
  if (t.resources.length > 0) {
    entry['resources'] = t.resources.map((resource) => resource.id).toSorted();
  }

  return sortKeys(entry) as unknown as TrailheadMapEntry;
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

const signalToEntry = (e: Signal<unknown>): TrailheadMapEntry => {
  const raw = e as unknown as Record<string, unknown>;
  const trailheads = extractTrailheads(raw);
  const entry: Record<string, unknown> = {
    exampleCount: 0,
    id: e.id,
    kind: 'signal',
    trailheads,
  };
  addEventFields(entry, e, raw);
  return sortKeys(entry) as unknown as TrailheadMapEntry;
};

const resourceToEntry = (resource: AnyResource): TrailheadMapEntry => {
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

  return sortKeys(entry) as unknown as TrailheadMapEntry;
};

const assertEstablishedTopo = (topo: Topo): void => {
  const validated = validateDraftFreeTopo(topo);
  if (validated.isErr()) {
    throw validated.error;
  }
};

const collectEntries = (topo: Topo): TrailheadMapEntry[] => [
  ...[...topo.trails.values()].map((trail) =>
    trailToEntry(trail as Trail<unknown, unknown>)
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
 * Generate a deterministic trailhead map from a Topo.
 *
 * Entries are sorted alphabetically by id. Object keys within each entry
 * are sorted lexicographically for stable serialization.
 */
export const generateTrailheadMap = (topo: Topo): TrailheadMap => {
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
