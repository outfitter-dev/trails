import { z } from 'zod';

import { matchesAnyTrailIdGlob } from '@ontrails/core';
import type {
  TopoGraph,
  TopoGraphEntry,
  TopoGraphTrailheadEntry,
  TopoGraphVersionEntry,
} from '@ontrails/topographer';

export const wayfinderEntityKindSchema = z.enum([
  'contour',
  'trailhead',
  'resource',
  'signal',
  'surface',
  'trail',
  'version',
]);

export type WayfinderEntityKind = z.infer<typeof wayfinderEntityKindSchema>;

export const wayfinderIntentSchema = z.enum(['destroy', 'read', 'write']);

export type WayfinderIntent = z.infer<typeof wayfinderIntentSchema>;

const stringListSchema = z.union([z.string(), z.array(z.string()).readonly()]);

const entityKindListSchema = z.union([
  wayfinderEntityKindSchema,
  z.array(wayfinderEntityKindSchema).readonly(),
]);

const intentListSchema = z.union([
  wayfinderIntentSchema,
  z.array(wayfinderIntentSchema).readonly(),
]);

export const wayfinderEntityFilterSchema = z
  .object({
    exampleCoverage: z.boolean().optional(),
    id: stringListSchema.optional(),
    idGlob: stringListSchema.optional(),
    idPrefix: stringListSchema.optional(),
    intent: intentListSchema.optional(),
    kind: entityKindListSchema.optional(),
    namespace: stringListSchema.optional(),
    query: z.string().optional(),
    surface: stringListSchema.optional(),
    trailhead: stringListSchema.optional(),
    usesResource: stringListSchema.optional(),
    usesSignal: stringListSchema.optional(),
    versioned: z.boolean().optional(),
  })
  .strict();

export type WayfinderEntityFilterInput = z.input<
  typeof wayfinderEntityFilterSchema
>;

export type WayfinderEntityFilters = z.output<
  typeof wayfinderEntityFilterSchema
>;

export interface WayfinderEntityRef {
  readonly entry?: TopoGraphEntry | undefined;
  readonly trailhead?: TopoGraphTrailheadEntry | undefined;
  readonly id: string;
  readonly kind: WayfinderEntityKind;
  readonly trailId?: string | undefined;
  readonly version?: TopoGraphVersionEntry | undefined;
  readonly versionKey?: string | undefined;
}

export interface WayfinderFilterContext {
  readonly trailheadsById: ReadonlyMap<string, TopoGraphTrailheadEntry>;
  readonly trailheadIdsByTrailId: ReadonlyMap<string, readonly string[]>;
  readonly trailheadSurfacesByTrailId: ReadonlyMap<string, readonly string[]>;
}

const toArray = <TValue>(
  value: TValue | readonly TValue[] | undefined
): readonly TValue[] => {
  if (value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value as readonly TValue[];
  }
  return [value as TValue];
};

const includesAny = (
  values: readonly string[] | undefined,
  expected: readonly string[]
): boolean =>
  expected.length === 0 ||
  (values ?? []).some((value) => expected.includes(value));

const namespaceMatches = (id: string, namespace: string): boolean =>
  id === namespace || id.startsWith(`${namespace}.`);

const entryHasVersioning = (entry: TopoGraphEntry): boolean =>
  entry.version !== undefined ||
  entry.versions !== undefined ||
  (entry.supports?.length ?? 0) > 0;

const entryHasExamples = (entry: TopoGraphEntry): boolean =>
  entry.exampleCount > 0 || (entry.examples?.length ?? 0) > 0;

const versionHasExamples = (version: TopoGraphVersionEntry): boolean =>
  version.exampleCount > 0 || (version.examples?.length ?? 0) > 0;

const entrySignalIds = (entry: TopoGraphEntry): readonly string[] => [
  ...(entry.fires ?? []),
  ...(entry.on ?? []),
  ...(entry.from ?? []),
  ...(entry.producers ?? []),
  ...(entry.consumers ?? []),
];

const entrySurfaces = (
  ref: WayfinderEntityRef,
  context: WayfinderFilterContext
): readonly string[] => {
  if (ref.kind === 'trailhead') {
    return ref.trailhead?.surfaces ?? [];
  }
  if (ref.kind === 'surface') {
    return [ref.id];
  }
  return [
    ...(ref.entry?.surfaces ??
      context.trailheadsById.get(ref.id)?.surfaces ??
      []),
    ...(context.trailheadSurfacesByTrailId.get(ref.trailId ?? ref.id) ?? []),
  ];
};

const refHasExamples = (ref: WayfinderEntityRef): boolean => {
  if (ref.version !== undefined) {
    return versionHasExamples(ref.version);
  }
  return ref.entry === undefined ? false : entryHasExamples(ref.entry);
};

const refHasVersioning = (ref: WayfinderEntityRef): boolean => {
  if (ref.kind === 'version') {
    return true;
  }
  return ref.entry === undefined ? false : entryHasVersioning(ref.entry);
};

const refResourceIds = (ref: WayfinderEntityRef): readonly string[] =>
  [
    ...(ref.entry?.resources ?? []),
    ...(ref.version?.resources ?? []),
    ...(ref.kind === 'resource' ? [ref.id] : []),
  ].toSorted();

const refSignalIds = (ref: WayfinderEntityRef): readonly string[] => {
  if (ref.entry !== undefined) {
    return entrySignalIds(ref.entry);
  }
  return ref.kind === 'signal' ? [ref.id] : [];
};

const refTrailheadIds = (
  ref: WayfinderEntityRef,
  context: WayfinderFilterContext
): readonly string[] => {
  if (ref.kind === 'trailhead') {
    return [ref.id];
  }
  return context.trailheadIdsByTrailId.get(ref.trailId ?? ref.id) ?? [];
};

export const createWayfinderFilterContext = (
  topoGraph: TopoGraph
): WayfinderFilterContext => {
  const trailheadsById = new Map<string, TopoGraphTrailheadEntry>();
  const trailheadIdsByTrailId = new Map<string, string[]>();
  const trailheadSurfacesByTrailId = new Map<string, string[]>();

  for (const trailhead of topoGraph.trailheads ?? []) {
    trailheadsById.set(trailhead.id, trailhead);
    for (const memberId of trailhead.memberIds) {
      const current = trailheadIdsByTrailId.get(memberId) ?? [];
      current.push(trailhead.id);
      trailheadIdsByTrailId.set(memberId, current);

      const currentSurfaces = trailheadSurfacesByTrailId.get(memberId) ?? [];
      currentSurfaces.push(...trailhead.surfaces);
      trailheadSurfacesByTrailId.set(
        memberId,
        [...new Set(currentSurfaces)].toSorted()
      );
    }
  }

  return {
    trailheadIdsByTrailId,
    trailheadSurfacesByTrailId,
    trailheadsById,
  };
};

export const listWayfinderEntityRefs = (
  topoGraph: TopoGraph
): readonly WayfinderEntityRef[] => {
  const refs: WayfinderEntityRef[] = topoGraph.entries.map((entry) => ({
    entry,
    id: entry.id,
    kind: entry.kind,
  }));

  for (const trailhead of topoGraph.trailheads ?? []) {
    refs.push({ id: trailhead.id, kind: 'trailhead', trailhead });
  }

  const surfaceIds = new Set<string>();
  for (const entry of topoGraph.entries) {
    for (const surface of entry.surfaces) {
      surfaceIds.add(surface);
    }
  }
  for (const trailhead of topoGraph.trailheads ?? []) {
    for (const surface of trailhead.surfaces) {
      surfaceIds.add(surface);
    }
  }
  for (const surface of [...surfaceIds].toSorted()) {
    refs.push({ id: surface, kind: 'surface' });
  }

  for (const entry of topoGraph.entries) {
    if (entry.kind !== 'trail') {
      continue;
    }
    const versionRefs: WayfinderEntityRef[] =
      entry.version === undefined
        ? []
        : [
            {
              entry,
              id: `${entry.id}@${entry.version}`,
              kind: 'version',
              trailId: entry.id,
              versionKey: String(entry.version),
            },
          ];
    for (const [versionKey, version] of Object.entries(entry.versions ?? {})) {
      versionRefs.push({
        entry,
        id: `${entry.id}@${versionKey}`,
        kind: 'version',
        trailId: entry.id,
        version,
        versionKey,
      });
    }
    refs.push(...versionRefs.toSorted((a, b) => a.id.localeCompare(b.id)));
  }

  return refs;
};

const matchesIdentityFilters = (
  ref: WayfinderEntityRef,
  filters: {
    readonly idPrefixes: readonly string[];
    readonly idGlobs: readonly string[];
    readonly ids: readonly string[];
    readonly namespaces: readonly string[];
  }
): boolean => {
  if (filters.ids.length > 0 && !filters.ids.includes(ref.id)) {
    return false;
  }
  if (
    filters.idPrefixes.length > 0 &&
    !filters.idPrefixes.some((prefix) => ref.id.startsWith(prefix))
  ) {
    return false;
  }
  if (
    filters.idGlobs.length > 0 &&
    !matchesAnyTrailIdGlob(ref.id, filters.idGlobs)
  ) {
    return false;
  }
  return (
    filters.namespaces.length === 0 ||
    filters.namespaces.some((namespace) => namespaceMatches(ref.id, namespace))
  );
};

const matchesTrailFilters = (
  ref: WayfinderEntityRef,
  filters: {
    readonly exampleCoverage?: boolean | undefined;
    readonly intents: readonly WayfinderIntent[];
    readonly versioned?: boolean | undefined;
  }
): boolean => {
  if (
    filters.intents.length > 0 &&
    (ref.entry?.kind !== 'trail' ||
      !filters.intents.includes(ref.entry.intent ?? 'write'))
  ) {
    return false;
  }
  if (
    filters.versioned !== undefined &&
    refHasVersioning(ref) !== filters.versioned
  ) {
    return false;
  }
  return (
    filters.exampleCoverage === undefined ||
    refHasExamples(ref) === filters.exampleCoverage
  );
};

const matchesRelationshipFilters = (
  ref: WayfinderEntityRef,
  context: WayfinderFilterContext,
  filters: {
    readonly trailheads: readonly string[];
    readonly resources: readonly string[];
    readonly signals: readonly string[];
    readonly surfaces: readonly string[];
  }
): boolean =>
  includesAny(entrySurfaces(ref, context), filters.surfaces) &&
  includesAny(refTrailheadIds(ref, context), filters.trailheads) &&
  includesAny(refResourceIds(ref), filters.resources) &&
  includesAny(refSignalIds(ref), filters.signals);

const matchesQueryFilter = (
  ref: WayfinderEntityRef,
  context: WayfinderFilterContext,
  query: string | undefined
): boolean => {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    ref.id,
    ref.kind,
    ref.trailId,
    ref.entry?.intent,
    ...entrySurfaces(ref, context),
    ...refTrailheadIds(ref, context),
    ...refResourceIds(ref),
    ...refSignalIds(ref),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
};

export const createWayfinderEntityPredicate = (
  context: WayfinderFilterContext,
  filters: WayfinderEntityFilterInput = {}
): ((ref: WayfinderEntityRef) => boolean) => {
  const parsed = wayfinderEntityFilterSchema.parse(filters);
  const kinds = toArray(parsed.kind);
  const ids = toArray(parsed.id);
  const idGlobs = toArray(parsed.idGlob);
  const idPrefixes = toArray(parsed.idPrefix);
  const namespaces = toArray(parsed.namespace);
  const intents = toArray(parsed.intent);
  const surfaces = toArray(parsed.surface);
  const trailheads = toArray(parsed.trailhead);
  const resources = toArray(parsed.usesResource);
  const signals = toArray(parsed.usesSignal);
  return (ref) => {
    if (kinds.length > 0 && !kinds.includes(ref.kind)) {
      return false;
    }
    if (
      !matchesIdentityFilters(ref, { idGlobs, idPrefixes, ids, namespaces })
    ) {
      return false;
    }
    if (
      !matchesTrailFilters(ref, {
        exampleCoverage: parsed.exampleCoverage,
        intents,
        versioned: parsed.versioned,
      })
    ) {
      return false;
    }
    if (
      !matchesRelationshipFilters(ref, context, {
        resources,
        signals,
        surfaces,
        trailheads,
      })
    ) {
      return false;
    }
    if (!matchesQueryFilter(ref, context, parsed.query)) {
      return false;
    }
    return true;
  };
};

export const createWayfinderGraphEntityPredicate = (
  topoGraph: TopoGraph,
  filters: WayfinderEntityFilterInput = {}
): ((ref: WayfinderEntityRef) => boolean) =>
  createWayfinderEntityPredicate(
    createWayfinderFilterContext(topoGraph),
    filters
  );

export const filterWayfinderEntityRefs = (
  topoGraph: TopoGraph,
  filters: WayfinderEntityFilterInput = {}
): readonly WayfinderEntityRef[] =>
  listWayfinderEntityRefs(topoGraph).filter(
    createWayfinderGraphEntityPredicate(topoGraph, filters)
  );
