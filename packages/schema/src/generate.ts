/**
 * Generate a deterministic surface map from a Topo.
 */

import { zodToJsonSchema } from '@ontrails/core';
import type { Event, Hike, Topo, Trail } from '@ontrails/core';

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

/** Extract surfaces from a raw object. */
const extractSurfaces = (raw: Record<string, unknown>): string[] =>
  Array.isArray(raw['surfaces'])
    ? (raw['surfaces'] as string[]).toSorted()
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
  if (t.readOnly === true) {
    entry['readOnly'] = true;
  }
  if (t.destructive === true) {
    entry['destructive'] = true;
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

/** Add optional metadata fields to an entry. */
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

const trailToEntry = (t: Trail<unknown, unknown>): SurfaceMapEntry => {
  const raw = t as unknown as Record<string, unknown>;
  const entry: Record<string, unknown> = {
    exampleCount: Array.isArray(t.examples) ? t.examples.length : 0,
    id: t.id,
    kind: t.kind,
    surfaces: extractSurfaces(raw),
  };

  addSchemas(entry, t);
  addMetadata(entry, t, raw);

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

const hikeToEntry = (r: Hike<unknown, unknown>): SurfaceMapEntry => {
  const base = trailToEntry(r as unknown as Trail<unknown, unknown>);
  const raw = r as unknown as Record<string, unknown>;

  const entry: Record<string, unknown> = {
    ...base,
    follows: r.follows.toSorted(),
    kind: 'hike',
  };

  // Re-check surfaces on the route itself
  if (Array.isArray(raw['surfaces'])) {
    entry['surfaces'] = (raw['surfaces'] as string[]).toSorted();
  }

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

/** Add optional event-specific fields. */
const addEventFields = (
  entry: Record<string, unknown>,
  e: Event<unknown>,
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

const eventToEntry = (e: Event<unknown>): SurfaceMapEntry => {
  const raw = e as unknown as Record<string, unknown>;
  const entry: Record<string, unknown> = {
    exampleCount: 0,
    id: e.id,
    kind: 'event',
    surfaces: extractSurfaces(raw),
  };
  addEventFields(entry, e, raw);
  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic surface map from a Topo.
 *
 * Entries are sorted alphabetically by id. Object keys within each entry
 * are sorted lexicographically for stable serialization.
 */
export const generateSurfaceMap = (topo: Topo): SurfaceMap => {
  const entries: SurfaceMapEntry[] = [];

  // Collect all trails
  for (const t of topo.trails.values()) {
    entries.push(trailToEntry(t as Trail<unknown, unknown>));
  }

  // Collect all hikes
  for (const r of topo.hikes.values()) {
    entries.push(hikeToEntry(r as Hike<unknown, unknown>));
  }

  // Collect all events
  for (const e of topo.events.values()) {
    entries.push(eventToEntry(e as Event<unknown>));
  }

  // Sort alphabetically by id
  const sorted = entries.toSorted((a, b) => a.id.localeCompare(b.id));

  return {
    entries: sorted,
    generatedAt: new Date().toISOString(),
    version: '1.0',
  };
};
