import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { getContourReferences } from '../contour.js';
import { deriveCliPath } from '../derive.js';
import { Result } from '../result.js';
import type { AnyContour } from '../contour.js';
import type { AnyResource } from '../resource.js';
import type { AnySignal } from '../signal.js';
import type { Topo } from '../topo.js';
import type { AnyTrail } from '../trail.js';
import { validateEstablishedTopo } from '../validate-established-topo.js';
import { zodToJsonSchema } from '../validation.js';
import type {
  CreateTopoSnapshotInput,
  TopoSnapshot,
} from './topo-snapshots.js';
import {
  ensureTopoSnapshotSchema,
  insertTopoSnapshotRecord,
} from './topo-snapshots.js';

type SurfaceMapEntryRecord = Readonly<Record<string, unknown>> & {
  readonly id: string;
  readonly kind: 'contour' | 'resource' | 'signal' | 'trail';
};

type SurfaceMapRecord = Readonly<{
  readonly entries: readonly SurfaceMapEntryRecord[];
  readonly generatedAt: string;
  readonly version: '1.0';
}>;

type JsonRecord = Readonly<Record<string, unknown>>;
type ZodSchemaInput = Parameters<typeof zodToJsonSchema>[0];

interface TopoTrailRow {
  readonly description: string | null;
  readonly exampleCount: number;
  readonly hasExamples: number;
  readonly hasOutput: number;
  readonly id: string;
  readonly idempotent: number;
  readonly intent: string;
  readonly meta: string | null;
  readonly pattern: string | null;
  readonly snapshotId: string;
}

interface TopoCrossingRow {
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly targetId: string;
}

interface TopoFiresRow {
  readonly snapshotId: string;
  readonly signalId: string;
  readonly trailId: string;
}

interface TopoOnRow {
  readonly snapshotId: string;
  readonly signalId: string;
  readonly trailId: string;
}

interface TopoTrailResourceRow {
  readonly resourceId: string;
  readonly snapshotId: string;
  readonly trailId: string;
}

interface TopoResourceRow {
  readonly hasHealth: number;
  readonly hasMock: number;
  readonly id: string;
  readonly snapshotId: string;
}

interface TopoSignalRow {
  readonly description: string | null;
  readonly id: string;
  readonly snapshotId: string;
}

interface TopoTrailSignalRow {
  readonly snapshotId: string;
  readonly signalId: string;
  readonly trailId: string;
}

interface TopoSurfaceRow {
  readonly derivedName: string;
  readonly method: string | null;
  readonly snapshotId: string;
  readonly trailId: string;
  readonly surface: string;
}

interface TopoExampleRow {
  readonly description: string | null;
  readonly error: string | null;
  readonly expected: string | null;
  readonly expectedMatch: string | null;
  readonly id: string;
  readonly input: string;
  readonly name: string;
  readonly ordinal: number;
  readonly snapshotId: string;
  readonly trailId: string;
}

interface TopoSchemaRow {
  readonly jsonSchema: string;
  readonly ownerId: string;
  readonly ownerKind: 'signal' | 'trail';
  readonly snapshotId: string;
  readonly schemaKind: 'input' | 'output' | 'payload';
  readonly zodHash: string;
}

interface StoredTopoExportRow {
  readonly snapshotId: string;
  readonly serializedLock: string;
  readonly surfaceHash: string;
  readonly surfaceMap: string;
}

interface StoredTopoExportDbRow {
  readonly serialized_lock: string;
  readonly surface_hash: string;
  readonly surface_map: string;
}

export interface StoredTopoExport {
  readonly lockContent: string;
  readonly surfaceHash: string;
  readonly surfaceMapJson: string;
}

interface MaterializedSchemas {
  readonly rows: readonly TopoSchemaRow[];
  readonly signalPayloads: ReadonlyMap<string, JsonRecord>;
  readonly trailSchemas: ReadonlyMap<
    string,
    Readonly<{
      readonly input: JsonRecord;
      readonly output?: JsonRecord;
    }>
  >;
}

interface MaterializedTopoArtifacts {
  readonly exportRow: StoredTopoExportRow;
  readonly schemaRows: readonly TopoSchemaRow[];
}

interface NormalizedTopoProjection {
  readonly crossings: readonly TopoCrossingRow[];
  readonly examples: readonly TopoExampleRow[];
  readonly fires: readonly TopoFiresRow[];
  readonly on: readonly TopoOnRow[];
  readonly resources: readonly TopoResourceRow[];
  readonly signals: readonly TopoSignalRow[];
  readonly surfaces: readonly TopoSurfaceRow[];
  readonly trailResources: readonly TopoTrailResourceRow[];
  readonly trailSignals: readonly TopoTrailSignalRow[];
  readonly trails: readonly TopoTrailRow[];
}

const canonicalLeaf = (value: unknown): unknown => {
  switch (typeof value) {
    case 'bigint': {
      return value.toString();
    }
    case 'function': {
      return `[Function:${value.name || 'anonymous'}]`;
    }
    case 'symbol': {
      return `[Symbol:${value.description ?? ''}]`;
    }
    case 'undefined': {
      return '[Undefined]';
    }
    default: {
      return value;
    }
  }
};

const canonicalObject = (
  value: Record<string, unknown>,
  visit: (value: unknown) => unknown
): Record<string, unknown> => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const next = value[key];
    sorted[key] = next === undefined ? '[Undefined]' : visit(next);
  }
  return sorted;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (value !== null && typeof value === 'object') {
    return canonicalObject(value as Record<string, unknown>, canonicalize);
  }
  return canonicalLeaf(value);
};

/**
 * Canonicalize a value for schema definition hashing.
 *
 * Matches the canonicalization logic used in `@ontrails/schema` so that
 * schema hashes are consistent regardless of which code path computes them.
 * Unlike the general `canonicalize`, this does not convert `Date`, `RegExp`,
 * or `undefined` to sentinel strings — Zod `_zod.def` objects are plain
 * JSON-serializable structures and both paths must agree on the same encoding.
 */
const schemaCanonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(schemaCanonical);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = schemaCanonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const stableJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

const hashText = (text: string): string => {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(text);
  return hasher.digest('hex');
};

const hashValue = (value: unknown): string => hashText(stableJson(value));

const parseJsonRecord = (value: string): JsonRecord =>
  JSON.parse(value) as JsonRecord;

const schemaDefinitionHash = (schema: unknown): string => {
  const def =
    typeof schema === 'object' &&
    schema !== null &&
    '_zod' in schema &&
    typeof (schema as { readonly _zod: unknown })._zod === 'object' &&
    (schema as { readonly _zod: Record<string, unknown> })._zod !== null &&
    'def' in (schema as { readonly _zod: Record<string, unknown> })._zod
      ? (schema as { readonly _zod: { readonly def: unknown } })._zod.def
      : schema;
  return hashText(JSON.stringify(schemaCanonical(def)));
};

const sortedJsonSchema = (
  schema: ZodSchemaInput
): { readonly json: string; readonly value: JsonRecord } => {
  const json = stableJson(zodToJsonSchema(schema));
  return {
    json,
    value: parseJsonRecord(json),
  };
};

const sortKeys = <T extends Record<string, unknown>>(value: T): T => {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    sorted[key] = value[key];
  }
  return sorted as T;
};

const normalizeTrailRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoTrailRow[] =>
  trails.map((trail) => ({
    description: trail.description ?? null,
    exampleCount: trail.examples?.length ?? 0,
    hasExamples: (trail.examples?.length ?? 0) > 0 ? 1 : 0,
    hasOutput: trail.output === undefined ? 0 : 1,
    id: trail.id,
    idempotent: trail.idempotent === true ? 1 : 0,
    intent: trail.intent,
    meta: trail.meta === undefined ? null : stableJson(trail.meta),
    pattern: trail.pattern ?? null,
    snapshotId,
  }));

const normalizeCrossingRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoCrossingRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.crosses)].toSorted().map((targetId) => ({
      snapshotId,
      sourceId: trail.id,
      targetId,
    }))
  );

export const normalizeFiresRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoFiresRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.fires)].toSorted().map((signalId) => ({
      signalId,
      snapshotId,
      trailId: trail.id,
    }))
  );

export const normalizeOnRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoOnRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.on)].toSorted().map((signalId) => ({
      signalId,
      snapshotId,
      trailId: trail.id,
    }))
  );

const normalizeTrailResourceRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoTrailResourceRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.resources.map((resource) => resource.id))]
      .toSorted()
      .map((resourceId) => ({
        resourceId,
        snapshotId,
        trailId: trail.id,
      }))
  );

const normalizeResourceRows = (
  resources: readonly AnyResource[],
  snapshotId: string
): readonly TopoResourceRow[] =>
  resources.map((resource) => ({
    hasHealth: resource.health === undefined ? 0 : 1,
    hasMock: resource.mock === undefined ? 0 : 1,
    id: resource.id,
    snapshotId,
  }));

const normalizeSignalRows = (
  signals: readonly AnySignal[],
  snapshotId: string
): readonly TopoSignalRow[] =>
  signals.map((signal) => ({
    description: signal.description ?? null,
    id: signal.id,
    snapshotId,
  }));

const normalizeTrailSignalRows = (
  signals: readonly AnySignal[],
  snapshotId: string
): readonly TopoTrailSignalRow[] =>
  signals.flatMap((signal) =>
    [...new Set(signal.from)].toSorted().map((trailId) => ({
      signalId: signal.id,
      snapshotId,
      trailId,
    }))
  );

/**
 * Project surface rows for stored topo.
 *
 * Currently records only CLI-derived rows. MCP, HTTP, and other surface
 * projections are intentionally deferred until the topo-store schema supports
 * multi-surface representation. The JSON export (`surface_map` in
 * `topo_exports`) is more faithful for now. See ADR-0015 for the target shape.
 */
const normalizeSurfaceRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoSurfaceRow[] =>
  trails.map((trail) => ({
    derivedName: deriveCliPath(trail.id).join(' '),
    method: null,
    snapshotId,
    surface: 'cli',
    trailId: trail.id,
  }));

const buildExampleId = (
  snapshotId: string,
  trailId: string,
  ordinal: number
): string => `${snapshotId}:${trailId}:${ordinal.toString().padStart(4, '0')}`;

const normalizeExampleRows = (
  trails: readonly AnyTrail[],
  snapshotId: string
): readonly TopoExampleRow[] =>
  trails.flatMap((trail) =>
    (trail.examples ?? []).map((example, index) => ({
      description: example.description ?? null,
      error: example.error ?? null,
      expected:
        example.expected === undefined ? null : stableJson(example.expected),
      expectedMatch:
        example.expectedMatch === undefined
          ? null
          : stableJson(example.expectedMatch),
      id: buildExampleId(snapshotId, trail.id, index),
      input: stableJson(example.input),
      name: example.name,
      ordinal: index,
      snapshotId,
      trailId: trail.id,
    }))
  );

const normalizeTopoProjection = (
  topo: Topo,
  snapshotId: string
): NormalizedTopoProjection => {
  const trails = topo.list().toSorted((a, b) => a.id.localeCompare(b.id));
  const resources = topo
    .listResources()
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const signals = topo
    .listSignals()
    .toSorted((a, b) => a.id.localeCompare(b.id));

  return {
    crossings: normalizeCrossingRows(trails, snapshotId),
    examples: normalizeExampleRows(trails, snapshotId),
    fires: normalizeFiresRows(trails, snapshotId),
    on: normalizeOnRows(trails, snapshotId),
    resources: normalizeResourceRows(resources, snapshotId),
    signals: normalizeSignalRows(signals, snapshotId),
    surfaces: normalizeSurfaceRows(trails, snapshotId),
    trailResources: normalizeTrailResourceRows(trails, snapshotId),
    trailSignals: normalizeTrailSignalRows(signals, snapshotId),
    trails: normalizeTrailRows(trails, snapshotId),
  };
};

/**
 * Look up a cached JSON schema by content hash.
 *
 * The query matches on `zod_hash` without filtering by `snapshot_id` because the
 * cache is intentionally cross-snapshot: if the Zod schema definition has not
 * changed (same hash), the serialized JSON Schema is reused regardless of
 * which snapshot produced it. This is safe as long as `zodToJsonSchema` is
 * deterministic for a given `_def` hash — the `schemaDefinitionHash` pipeline
 * guarantees that structurally identical schemas produce the same hash.
 */
const readCachedJsonSchema = (
  db: Database,
  ownerId: string,
  ownerKind: TopoSchemaRow['ownerKind'],
  schemaKind: TopoSchemaRow['schemaKind'],
  zodHash: string
): string | undefined => {
  const row = db
    .query<
      {
        readonly json_schema: string;
      },
      [string, string, string, string]
    >(
      `SELECT json_schema
       FROM topo_schemas
       WHERE owner_id = ?
         AND owner_kind = ?
         AND schema_kind = ?
         AND zod_hash = ?
       LIMIT 1`
    )
    .get(ownerId, ownerKind, schemaKind, zodHash);

  return row?.json_schema;
};

const resolveSchemaRow = (
  db: Database,
  ownerId: string,
  ownerKind: TopoSchemaRow['ownerKind'],
  snapshotId: string,
  schemaKind: TopoSchemaRow['schemaKind'],
  schema: ZodSchemaInput
): {
  readonly row: TopoSchemaRow;
  readonly value: JsonRecord;
} => {
  const zodHash = schemaDefinitionHash(schema);
  const cachedJson = readCachedJsonSchema(
    db,
    ownerId,
    ownerKind,
    schemaKind,
    zodHash
  );

  if (cachedJson !== undefined) {
    return {
      row: {
        jsonSchema: cachedJson,
        ownerId,
        ownerKind,
        schemaKind,
        snapshotId,
        zodHash,
      },
      value: parseJsonRecord(cachedJson),
    };
  }

  const generated = sortedJsonSchema(schema);
  return {
    row: {
      jsonSchema: generated.json,
      ownerId,
      ownerKind,
      schemaKind,
      snapshotId,
      zodHash,
    },
    value: generated.value,
  };
};

const materializeTrailSchema = (
  db: Database,
  snapshotId: string,
  trail: AnyTrail
): {
  readonly rows: readonly TopoSchemaRow[];
  readonly value: Readonly<{
    readonly input: JsonRecord;
    readonly output?: JsonRecord;
  }>;
} => {
  const inputSchema = resolveSchemaRow(
    db,
    trail.id,
    'trail',
    snapshotId,
    'input',
    trail.input as ZodSchemaInput
  );

  if (trail.output === undefined) {
    return {
      rows: [inputSchema.row],
      value: {
        input: inputSchema.value,
      },
    };
  }

  const outputSchema = resolveSchemaRow(
    db,
    trail.id,
    'trail',
    snapshotId,
    'output',
    trail.output as ZodSchemaInput
  );

  return {
    rows: [inputSchema.row, outputSchema.row],
    value: {
      input: inputSchema.value,
      output: outputSchema.value,
    },
  };
};

const materializeTrailSchemas = (
  db: Database,
  snapshotId: string,
  trails: readonly AnyTrail[]
): Pick<MaterializedSchemas, 'rows' | 'trailSchemas'> => {
  const rows: TopoSchemaRow[] = [];
  const trailSchemas = new Map<
    string,
    Readonly<{
      readonly input: JsonRecord;
      readonly output?: JsonRecord;
    }>
  >();

  for (const trail of trails) {
    const materialized = materializeTrailSchema(db, snapshotId, trail);
    rows.push(...materialized.rows);
    trailSchemas.set(trail.id, materialized.value);
  }

  return {
    rows,
    trailSchemas,
  };
};

const materializeSignalSchemas = (
  db: Database,
  snapshotId: string,
  signals: readonly AnySignal[]
): Pick<MaterializedSchemas, 'rows' | 'signalPayloads'> => {
  const rows: TopoSchemaRow[] = [];
  const signalPayloads = new Map<string, JsonRecord>();

  for (const signal of signals) {
    const payloadSchema = resolveSchemaRow(
      db,
      signal.id,
      'signal',
      snapshotId,
      'payload',
      signal.payload as ZodSchemaInput
    );
    rows.push(payloadSchema.row);
    signalPayloads.set(signal.id, payloadSchema.value);
  }

  return {
    rows,
    signalPayloads,
  };
};

const materializeSchemas = (
  db: Database,
  snapshotId: string,
  signals: readonly AnySignal[],
  trails: readonly AnyTrail[]
): MaterializedSchemas => {
  const trailMaterial = materializeTrailSchemas(db, snapshotId, trails);
  const signalMaterial = materializeSignalSchemas(db, snapshotId, signals);

  return {
    rows: [...trailMaterial.rows, ...signalMaterial.rows],
    signalPayloads: signalMaterial.signalPayloads,
    trailSchemas: trailMaterial.trailSchemas,
  };
};

const extractTrailheads = (raw: Record<string, unknown>): string[] =>
  Array.isArray(raw['trailheads'])
    ? (raw['trailheads'] as string[]).toSorted()
    : [];

const addSafetyMarkers = (
  entry: Record<string, unknown>,
  trail: AnyTrail
): void => {
  if (trail.intent !== 'write') {
    entry['intent'] = trail.intent;
  }

  if (trail.idempotent === true) {
    entry['idempotent'] = true;
  }
};

const addExtendedMetadata = (
  entry: Record<string, unknown>,
  raw: Record<string, unknown>,
  trail: AnyTrail
): void => {
  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }

  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }

  if (trail.detours.length > 0) {
    entry['detours'] = trail.detours.map((d) => ({
      maxAttempts: Math.max(1, Math.min(d.maxAttempts ?? 1, 5)),
      on: d.on.name,
    }));
  }
};

const addTrailRelations = (
  entry: Record<string, unknown>,
  trail: AnyTrail
): void => {
  if (trail.crosses.length > 0) {
    entry['crosses'] = trail.crosses.toSorted();
  }

  if (trail.contours.length > 0) {
    entry['contours'] = trail.contours
      .map((contour) => contour.name)
      .toSorted();
  }

  if (trail.resources.length > 0) {
    entry['resources'] = trail.resources
      .map((resource) => resource.id)
      .toSorted();
  }
};

const buildTrailEntryBase = (
  trail: AnyTrail,
  trailSchema: Readonly<{
    readonly input: JsonRecord;
    readonly output?: JsonRecord;
  }>
): {
  readonly entry: Record<string, unknown>;
  readonly raw: Record<string, unknown>;
} => {
  const raw = trail as unknown as Record<string, unknown>;
  const entry: Record<string, unknown> = {
    cli: { path: deriveCliPath(trail.id) },
    exampleCount: trail.examples?.length ?? 0,
    id: trail.id,
    input: trailSchema.input,
    kind: trail.kind,
    trailheads: extractTrailheads(raw),
  };

  if (trailSchema.output !== undefined) {
    entry['output'] = trailSchema.output;
  }

  if (trail.description !== undefined) {
    entry['description'] = trail.description;
  }

  if (trail.pattern !== undefined) {
    entry['pattern'] = trail.pattern;
  }

  return {
    entry,
    raw,
  };
};

const trailToEntryRecord = (
  trail: AnyTrail,
  trailSchema: Readonly<{
    readonly input: JsonRecord;
    readonly output?: JsonRecord;
  }>
): SurfaceMapEntryRecord => {
  const { entry, raw } = buildTrailEntryBase(trail, trailSchema);
  addSafetyMarkers(entry, trail);
  addExtendedMetadata(entry, raw, trail);
  addTrailRelations(entry, trail);
  return sortKeys(entry) as SurfaceMapEntryRecord;
};

const signalToEntryRecord = (
  signal: AnySignal,
  payloadSchema: JsonRecord
): SurfaceMapEntryRecord => {
  const raw = signal as unknown as Record<string, unknown>;
  const entry: Record<string, unknown> = {
    exampleCount: 0,
    id: signal.id,
    input: payloadSchema,
    kind: 'signal',
    trailheads: extractTrailheads(raw),
  };

  if (signal.description !== undefined) {
    entry['description'] = signal.description;
  }

  if (raw['deprecated'] === true) {
    entry['deprecated'] = true;
  }

  if (typeof raw['replacedBy'] === 'string') {
    entry['replacedBy'] = raw['replacedBy'];
  }

  return sortKeys(entry) as SurfaceMapEntryRecord;
};

const resourceToEntryRecord = (
  resource: AnyResource
): SurfaceMapEntryRecord => {
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

  return sortKeys(entry) as SurfaceMapEntryRecord;
};

const contourToEntryRecord = (contour: AnyContour): SurfaceMapEntryRecord => {
  const schema = sortedJsonSchema(contour);
  const entry: Record<string, unknown> = {
    exampleCount: contour.examples?.length ?? 0,
    id: contour.name,
    identity: contour.identity,
    kind: 'contour',
    schema: schema.value,
    trailheads: [],
  };

  const references = getContourReferences(contour);
  if (references.length > 0) {
    entry['references'] = references;
  }

  return sortKeys(entry) as SurfaceMapEntryRecord;
};

const requireTrailSchema = (
  trailSchemas: MaterializedSchemas['trailSchemas'],
  trailId: string
): Readonly<{
  readonly input: JsonRecord;
  readonly output?: JsonRecord;
}> => {
  const schema = trailSchemas.get(trailId);
  if (schema === undefined) {
    throw new Error(`Missing cached trail schema for "${trailId}"`);
  }
  return schema;
};

const requireSignalPayload = (
  signalPayloads: MaterializedSchemas['signalPayloads'],
  signalId: string
): JsonRecord => {
  const payload = signalPayloads.get(signalId);
  if (payload === undefined) {
    throw new Error(`Missing cached signal schema for "${signalId}"`);
  }
  return payload;
};

const buildSurfaceMap = (
  contours: readonly AnyContour[],
  generatedAt: string,
  resources: readonly AnyResource[],
  signalPayloads: ReadonlyMap<string, JsonRecord>,
  signals: readonly AnySignal[],
  trailSchemas: ReadonlyMap<
    string,
    Readonly<{
      readonly input: JsonRecord;
      readonly output?: JsonRecord;
    }>
  >,
  trails: readonly AnyTrail[]
): SurfaceMapRecord => {
  const entries = [
    ...contours.map((contour) => contourToEntryRecord(contour)),
    ...trails.map((trail) =>
      trailToEntryRecord(trail, requireTrailSchema(trailSchemas, trail.id))
    ),
    ...signals.map((signal) =>
      signalToEntryRecord(
        signal,
        requireSignalPayload(signalPayloads, signal.id)
      )
    ),
    ...resources.map((resource) => resourceToEntryRecord(resource)),
  ].toSorted((a, b) => a.id.localeCompare(b.id));

  return {
    entries,
    generatedAt,
    version: '1.0',
  };
};

const hashSurfaceMapRecord = (surfaceMap: SurfaceMapRecord): string => {
  const { generatedAt: _unused, ...rest } = surfaceMap;
  return hashValue(rest);
};

const entryPayload = (
  entry: SurfaceMapEntryRecord
): Readonly<Record<string, unknown>> => {
  const { id: _unusedId, kind: _unusedKind, ...rest } = entry;
  return sortKeys(rest);
};

const entriesForKind = (
  entries: readonly SurfaceMapEntryRecord[],
  kind: SurfaceMapEntryRecord['kind']
): Readonly<Record<string, Readonly<Record<string, unknown>>>> =>
  Object.fromEntries(
    entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => [entry.id, entryPayload(entry)])
  );

const buildSerializedLock = (
  hash: string,
  topo: Topo,
  surfaceMap: SurfaceMapRecord
): Readonly<Record<string, unknown>> =>
  sortKeys({
    apps: sortKeys({
      [topo.name]: sortKeys({
        contours: entriesForKind(surfaceMap.entries, 'contour'),
        resources: entriesForKind(surfaceMap.entries, 'resource'),
        signals: entriesForKind(surfaceMap.entries, 'signal'),
        trails: entriesForKind(surfaceMap.entries, 'trail'),
      }),
    }),
    generatedAt: surfaceMap.generatedAt,
    hash,
    version: 1,
  });

const buildStoredTopoExport = (
  db: Database,
  snapshot: TopoSnapshot,
  topo: Topo
): MaterializedTopoArtifacts => {
  const contours = topo
    .listContours()
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const trails = topo.list().toSorted((a, b) => a.id.localeCompare(b.id));
  const resources = topo
    .listResources()
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const signals = topo
    .listSignals()
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const schemas = materializeSchemas(db, snapshot.id, signals, trails);
  const surfaceMap = buildSurfaceMap(
    contours,
    snapshot.createdAt,
    resources,
    schemas.signalPayloads,
    signals,
    schemas.trailSchemas,
    trails
  );
  const surfaceHash = hashSurfaceMapRecord(surfaceMap);
  const serializedLock = `${JSON.stringify(
    buildSerializedLock(surfaceHash, topo, surfaceMap),
    null,
    2
  )}\n`;

  return {
    exportRow: {
      serializedLock,
      snapshotId: snapshot.id,
      surfaceHash,
      surfaceMap: `${JSON.stringify(surfaceMap, null, 2)}\n`,
    },
    schemaRows: schemas.rows,
  };
};

const insertRows = <TRow>(
  db: Database,
  rows: readonly TRow[],
  statement: string,
  toParams: (row: TRow) => SQLQueryBindings[]
): void => {
  for (const row of rows) {
    db.run(statement, toParams(row));
  }
};

const insertProjectedRows = (
  db: Database,
  projection: NormalizedTopoProjection
): void => {
  insertRows(
    db,
    projection.trails,
    `INSERT INTO topo_trails (
      id, intent, idempotent, has_output, has_examples, example_count, description, pattern, meta, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (row) => [
      row.id,
      row.intent,
      row.idempotent,
      row.hasOutput,
      row.hasExamples,
      row.exampleCount,
      row.description,
      row.pattern,
      row.meta,
      row.snapshotId,
    ]
  );
  insertRows(
    db,
    projection.crossings,
    'INSERT INTO topo_crossings (source_id, target_id, snapshot_id) VALUES (?, ?, ?)',
    (row) => [row.sourceId, row.targetId, row.snapshotId]
  );
  insertRows(
    db,
    projection.trailResources,
    `INSERT INTO topo_trail_resources (trail_id, resource_id, snapshot_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.resourceId, row.snapshotId]
  );
  insertRows(
    db,
    projection.resources,
    `INSERT INTO topo_resources (id, has_mock, has_health, snapshot_id)
     VALUES (?, ?, ?, ?)`,
    (row) => [row.id, row.hasMock, row.hasHealth, row.snapshotId]
  );
  insertRows(
    db,
    projection.signals,
    'INSERT INTO topo_signals (id, description, snapshot_id) VALUES (?, ?, ?)',
    (row) => [row.id, row.description, row.snapshotId]
  );
  insertRows(
    db,
    projection.trailSignals,
    `INSERT INTO topo_trail_signals (trail_id, signal_id, snapshot_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.signalId, row.snapshotId]
  );
  insertRows(
    db,
    projection.fires,
    `INSERT INTO topo_trail_fires (trail_id, signal_id, snapshot_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.signalId, row.snapshotId]
  );
  insertRows(
    db,
    projection.on,
    `INSERT INTO topo_trail_on (trail_id, signal_id, snapshot_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.signalId, row.snapshotId]
  );
  insertRows(
    db,
    projection.surfaces,
    `INSERT INTO topo_surfaces (trail_id, surface, derived_name, method, snapshot_id)
     VALUES (?, ?, ?, ?, ?)`,
    (row) => [
      row.trailId,
      row.surface,
      row.derivedName,
      row.method,
      row.snapshotId,
    ]
  );
  insertRows(
    db,
    projection.examples,
    `INSERT INTO topo_examples (
      id, trail_id, ordinal, name, description, input, expected, error, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (row) => [
      row.id,
      row.trailId,
      row.ordinal,
      row.name,
      row.description,
      row.input,
      row.expected,
      row.error,
      row.snapshotId,
    ]
  );
};

const insertSchemaRows = (
  db: Database,
  rows: readonly TopoSchemaRow[]
): void => {
  insertRows(
    db,
    rows,
    `INSERT INTO topo_schemas (
      owner_id, owner_kind, schema_kind, zod_hash, json_schema, snapshot_id
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    (row) => [
      row.ownerId,
      row.ownerKind,
      row.schemaKind,
      row.zodHash,
      row.jsonSchema,
      row.snapshotId,
    ]
  );
};

const insertStoredExport = (
  db: Database,
  exportRow: StoredTopoExportRow
): void => {
  db.run(
    `INSERT INTO topo_exports (
      snapshot_id, surface_map, surface_hash, serialized_lock
    ) VALUES (?, ?, ?, ?)`,
    [
      exportRow.snapshotId,
      exportRow.surfaceMap,
      exportRow.surfaceHash,
      exportRow.serializedLock,
    ]
  );
};

export const getStoredTopoExport = (
  db: Database,
  snapshotId: string
): StoredTopoExport | undefined => {
  const row = db
    .query<StoredTopoExportDbRow, [string]>(
      `SELECT surface_map, surface_hash, serialized_lock
       FROM topo_exports
       WHERE snapshot_id = ?`
    )
    .get(snapshotId);

  if (row === undefined || row === null) {
    return undefined;
  }

  return {
    lockContent: row.serialized_lock,
    surfaceHash: row.surface_hash,
    surfaceMapJson: row.surface_map,
  };
};

export const createTopoSnapshot = (
  db: Database,
  topo: Topo,
  input?: CreateTopoSnapshotInput
): Result<TopoSnapshot, Error> => {
  const validated = validateEstablishedTopo(topo);
  if (validated.isErr()) {
    return Result.err(validated.error);
  }

  ensureTopoSnapshotSchema(db);

  const snapshotInput: CreateTopoSnapshotInput = {
    ...input,
    resourceCount: input?.resourceCount ?? topo.resources.size,
    signalCount: input?.signalCount ?? topo.signals.size,
    trailCount: input?.trailCount ?? topo.trails.size,
  };

  const snapshot = db.transaction(() => {
    const record = insertTopoSnapshotRecord(db, snapshotInput);
    const artifacts = buildStoredTopoExport(db, record, topo);
    insertProjectedRows(db, normalizeTopoProjection(topo, record.id));
    insertSchemaRows(db, artifacts.schemaRows);
    insertStoredExport(db, artifacts.exportRow);
    return record;
  })();

  return Result.ok(snapshot);
};
