/**
 * Derive a deterministic surface map from a Topo.
 */

import {
  DETOUR_MAX_ATTEMPTS_CAP,
  deriveCliPath,
  deriveStructuredSignalExamples,
  deriveStructuredTrailExamples,
  getContourReferences,
  validateEstablishedTopo,
  signalDiagnosticDefinitions,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  AnyContour,
  AnyResource,
  FieldOverride,
  Signal,
  Topo,
  Trail,
} from '@ontrails/core';

import type {
  JsonSchema,
  SurfaceMap,
  SurfaceMapEntry,
  SurfaceMapFieldOverride,
  SurfaceMapFieldOverrideKey,
} from './types.js';

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

interface SignalGraphRelations {
  readonly consumers: readonly string[];
  readonly producers: readonly string[];
}

const EMPTY_SIGNAL_RELATIONS: SignalGraphRelations = {
  consumers: [],
  producers: [],
};

const SIGNAL_DIAGNOSTIC_CODES = Object.keys(
  signalDiagnosticDefinitions
).toSorted();

const SIGNAL_DIAGNOSTIC_HOOKS = {
  codes: SIGNAL_DIAGNOSTIC_CODES,
  strictMode: true,
} as const;

const SIGNAL_GOVERNANCE_HOOKS = {
  consumers: 'trail.on',
  payload: 'signal.payload',
  producers: 'trail.fires',
} as const;

const collectSignalGraphRelations = (
  topo: Topo
): ReadonlyMap<string, SignalGraphRelations> => {
  const producers = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();

  for (const trail of topo.trails.values()) {
    for (const signalId of trail.fires) {
      const current = producers.get(signalId) ?? new Set<string>();
      current.add(trail.id);
      producers.set(signalId, current);
    }
    for (const signalId of trail.on) {
      const current = consumers.get(signalId) ?? new Set<string>();
      current.add(trail.id);
      consumers.set(signalId, current);
    }
  }

  return new Map(
    [...topo.signals.keys()].map((signalId) => [
      signalId,
      {
        consumers: [...(consumers.get(signalId) ?? [])].toSorted(),
        producers: [...(producers.get(signalId) ?? [])].toSorted(),
      },
    ])
  );
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
      maxAttempts: Math.max(
        1,
        Math.min(d.maxAttempts ?? 1, DETOUR_MAX_ATTEMPTS_CAP)
      ),
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

const FIELD_OVERRIDE_KEYS: readonly SurfaceMapFieldOverrideKey[] = [
  'hint',
  'label',
  'message',
  'options',
];

const collectFieldOverrideKeys = (
  override: FieldOverride
): readonly SurfaceMapFieldOverrideKey[] =>
  FIELD_OVERRIDE_KEYS.filter((key) => override[key] !== undefined);

const deriveFieldOverrides = (
  fields: Readonly<Record<string, FieldOverride>> | undefined
): readonly SurfaceMapFieldOverride[] | undefined => {
  if (fields === undefined) {
    return undefined;
  }

  const overrides = Object.entries(fields)
    .flatMap(([field, override]) => {
      const overrideKeys = collectFieldOverrideKeys(override);
      if (overrideKeys.length === 0) {
        return [];
      }
      return [
        {
          field,
          overrides: overrideKeys,
          provenance: { source: 'trail.fields' as const },
        },
      ];
    })
    .toSorted((a, b) => a.field.localeCompare(b.field));

  return overrides.length > 0 ? overrides : undefined;
};

const addFieldOverrides = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>
): void => {
  const fieldOverrides = deriveFieldOverrides(t.fields);
  if (fieldOverrides !== undefined) {
    entry['fieldOverrides'] = fieldOverrides;
  }
};

const addExamples = (
  entry: Record<string, unknown>,
  t: Trail<unknown, unknown, unknown>
): void => {
  const examples = deriveStructuredTrailExamples(t.examples);
  if (examples !== undefined) {
    entry['examples'] = examples;
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
  addFieldOverrides(entry, t);
  addExamples(entry, t);

  return sortKeys(entry) as unknown as SurfaceMapEntry;
};

/** Add optional signal-specific fields. */
const addSignalFields = (
  entry: Record<string, unknown>,
  e: Signal<unknown>,
  raw: Record<string, unknown>,
  relations: SignalGraphRelations
): void => {
  if (e.payload) {
    const payload = toSortedJsonSchema(e.payload);
    entry['input'] = payload;
    entry['payload'] = payload;
  }
  if (e.description !== undefined) {
    entry['description'] = e.description;
  }
  if (e.meta !== undefined) {
    entry['meta'] = e.meta;
  }
  if (e.from !== undefined && e.from.length > 0) {
    entry['from'] = e.from.toSorted();
  }
  entry['consumers'] = relations.consumers;
  entry['diagnostics'] = SIGNAL_DIAGNOSTIC_HOOKS;
  entry['governance'] = SIGNAL_GOVERNANCE_HOOKS;
  entry['producers'] = relations.producers;
  const examples = deriveStructuredSignalExamples(e.examples);
  if (examples !== undefined) {
    entry['examples'] = examples;
  }
  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }
  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }
};

const signalToEntry = (
  e: Signal<unknown>,
  relations: SignalGraphRelations
): SurfaceMapEntry => {
  const raw = e as unknown as Record<string, unknown>;
  const trailheads = extractTrailheads(raw);
  const entry: Record<string, unknown> = {
    exampleCount: e.examples?.length ?? 0,
    id: e.id,
    kind: 'signal',
    trailheads,
  };
  addSignalFields(entry, e, raw, relations);
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
  const validated = validateEstablishedTopo(topo);
  if (validated.isErr()) {
    throw validated.error;
  }
};

const collectEntries = (topo: Topo): SurfaceMapEntry[] => {
  const signalRelations = collectSignalGraphRelations(topo);
  return [
    ...[...topo.contours.values()].map((contour) => contourToEntry(contour)),
    ...[...topo.trails.values()].map((trail) =>
      trailToEntry(trail as Trail<unknown, unknown, unknown>)
    ),
    ...[...topo.signals.values()].map((signal) =>
      signalToEntry(
        signal as Signal<unknown>,
        signalRelations.get(signal.id) ?? EMPTY_SIGNAL_RELATIONS
      )
    ),
    ...[...topo.resources.values()].map((resource) =>
      resourceToEntry(resource)
    ),
  ];
};

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
