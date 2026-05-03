import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { ValidationError } from '@ontrails/core';

import type {
  ListTopoSnapshotsOptions,
  TopoSnapshot,
} from './topo-snapshots.js';
import {
  listTopoSnapshots,
  readPinnedTopoSnapshot,
  readTopoSnapshot,
} from './topo-snapshots.js';
import type { StoredTopoExport } from './topo-store.js';
import { getStoredTopoExport } from './topo-store.js';

export interface TopoStoreRef {
  readonly pin?: string;
  readonly snapshotId?: string;
}

export interface TopoStoreTrailRecord {
  readonly description: string | null;
  readonly exampleCount: number;
  readonly hasExamples: boolean;
  readonly hasOutput: boolean;
  readonly id: string;
  readonly idempotent: boolean;
  readonly intent: 'destroy' | 'read' | 'write';
  readonly kind: 'trail';
  readonly meta: Readonly<Record<string, unknown>> | null;
  readonly pattern: string | null;
  readonly safety: '-' | 'destroy' | 'read' | 'write';
  readonly snapshotId: string;
}

export interface TopoStoreExampleRecord {
  readonly description: string | null;
  readonly error: string | null;
  readonly expected: unknown;
  readonly expectedMatch: unknown;
  readonly input: unknown;
  readonly name: string;
  readonly ordinal: number;
  readonly signals: unknown;
}

export interface TopoStoreTrailDetailRecord extends TopoStoreTrailRecord {
  readonly crosses: readonly string[];
  readonly detours:
    | readonly { readonly on: string; readonly maxAttempts: number }[]
    | null;
  readonly examples: readonly TopoStoreExampleRecord[];
  readonly resources: readonly string[];
}

export interface TopoStoreResourceRecord {
  readonly description: string | null;
  readonly hasHealth: boolean;
  readonly hasMock: boolean;
  readonly health: 'available' | 'none';
  readonly id: string;
  readonly kind: 'resource';
  readonly lifetime: 'singleton';
  readonly snapshotId: string;
  readonly usedBy: readonly string[];
}

export interface TopoStoreSignalRecord {
  readonly consumers: readonly string[];
  readonly description: string | null;
  readonly exampleCount: number;
  readonly from: readonly string[];
  readonly hasExamples: boolean;
  readonly id: string;
  readonly kind: 'signal';
  readonly payloadSchema: boolean;
  readonly producers: readonly string[];
  readonly snapshotId: string;
}

export interface TopoStoreSignalDetailRecord extends TopoStoreSignalRecord {
  readonly examples: readonly unknown[];
  readonly payload: Readonly<Record<string, unknown>> | null;
}

export interface TopoStoreExportRecord extends StoredTopoExport {
  readonly snapshot: TopoSnapshot;
}

interface TopoTrailRow {
  readonly description: string | null;
  readonly example_count: number;
  readonly has_examples: number;
  readonly has_output: number;
  readonly id: string;
  readonly idempotent: number;
  readonly intent: string | null;
  readonly meta: string | null;
  readonly pattern: string | null;
  readonly snapshot_id: string;
}

interface TopoCrossingRow {
  readonly target_id: string;
}

interface TopoTrailResourceRow {
  readonly resource_id: string;
}

interface TopoExampleRow {
  readonly description: string | null;
  readonly error: string | null;
  readonly expected: string | null;
  readonly expected_match: string | null;
  readonly input: string;
  readonly name: string;
  readonly ordinal: number;
  readonly signals: string | null;
}

interface TopoResourceRow {
  readonly has_health: number;
  readonly has_mock: number;
  readonly id: string;
  readonly snapshot_id: string;
}

interface TopoSignalRow {
  readonly description: string | null;
  readonly id: string;
  readonly snapshot_id: string;
}

interface TopoSignalRelationRow {
  readonly trail_id: string;
}

interface StoredSurfaceMapEntry {
  readonly description?: string;
  readonly detours?: readonly {
    readonly on: string;
    readonly maxAttempts: number;
  }[];
  readonly exampleCount?: number;
  readonly examples?: readonly unknown[];
  readonly from?: readonly string[];
  readonly healthcheck?: boolean;
  readonly id: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly kind: 'contour' | 'resource' | 'signal' | 'trail';
}

interface StoredSurfaceMap {
  readonly entries: readonly StoredSurfaceMapEntry[];
}

const ensureSingleRefSelector = (ref?: TopoStoreRef): void => {
  if (ref?.pin !== undefined && ref.snapshotId !== undefined) {
    throw new ValidationError(
      'Topo store references may use pin or snapshotId, not both'
    );
  }
};

const normalizeIntent = (
  intent: string | null
): TopoStoreTrailRecord['intent'] => {
  if (intent === 'destroy' || intent === 'read') {
    return intent;
  }
  return 'write';
};

const safetyForIntent = (
  intent: TopoStoreTrailRecord['intent']
): TopoStoreTrailRecord['safety'] => {
  if (intent === 'destroy') {
    return 'destroy';
  }
  if (intent === 'read') {
    return 'read';
  }
  return 'write';
};

const parseMeta = (
  value: string | null
): Readonly<Record<string, unknown>> | null =>
  value === null
    ? null
    : (JSON.parse(value) as Readonly<Record<string, unknown>>);

const parseJson = (value: string): unknown => JSON.parse(value) as unknown;

const readSnapshotRef = (
  db: Database,
  ref?: TopoStoreRef
): TopoSnapshot | undefined => {
  ensureSingleRefSelector(ref);

  if (ref?.snapshotId !== undefined) {
    return readTopoSnapshot(db, ref.snapshotId);
  }

  if (ref?.pin !== undefined) {
    return readPinnedTopoSnapshot(db, ref.pin);
  }

  return listTopoSnapshots(db, { limit: 1 })[0];
};

const readStoredEntry = (
  db: Database,
  snapshotId: string,
  kind: StoredSurfaceMapEntry['kind'],
  id: string
): StoredSurfaceMapEntry | undefined => {
  const stored = getStoredTopoExport(db, snapshotId);
  if (stored === undefined) {
    return undefined;
  }

  const map = JSON.parse(stored.surfaceMapJson) as StoredSurfaceMap;
  return map.entries.find((entry) => entry.id === id && entry.kind === kind);
};

const mapTrailRow = (row: TopoTrailRow): TopoStoreTrailRecord => {
  const intent = normalizeIntent(row.intent);

  return {
    description: row.description,
    exampleCount: row.example_count,
    hasExamples: row.has_examples === 1,
    hasOutput: row.has_output === 1,
    id: row.id,
    idempotent: row.idempotent === 1,
    intent,
    kind: 'trail',
    meta: parseMeta(row.meta),
    pattern: row.pattern,
    safety: safetyForIntent(intent),
    snapshotId: row.snapshot_id,
  };
};

const readTrailCrossings = (
  db: Database,
  snapshotId: string,
  trailId: string
): readonly string[] =>
  db
    .query<TopoCrossingRow, [string, string]>(
      `SELECT target_id
       FROM topo_crossings
       WHERE snapshot_id = ? AND source_id = ?
       ORDER BY target_id ASC`
    )
    .all(snapshotId, trailId)
    .map((row) => row.target_id);

const readTrailResourceIds = (
  db: Database,
  snapshotId: string,
  trailId: string
): readonly string[] =>
  db
    .query<TopoTrailResourceRow, [string, string]>(
      `SELECT resource_id
       FROM topo_trail_resources
       WHERE snapshot_id = ? AND trail_id = ?
       ORDER BY resource_id ASC`
    )
    .all(snapshotId, trailId)
    .map((row) => row.resource_id);

const readTrailExamples = (
  db: Database,
  snapshotId: string,
  trailId: string
): readonly TopoStoreExampleRecord[] =>
  db
    .query<TopoExampleRow, [string, string]>(
      `SELECT ordinal, name, description, input, expected, expected_match, error, signals
       FROM topo_examples
       WHERE snapshot_id = ? AND trail_id = ?
       ORDER BY ordinal ASC`
    )
    .all(snapshotId, trailId)
    .map((row) => ({
      description: row.description,
      error: row.error,
      expected: row.expected === null ? null : parseJson(row.expected),
      expectedMatch:
        row.expected_match === null ? null : parseJson(row.expected_match),
      input: parseJson(row.input),
      name: row.name,
      ordinal: row.ordinal,
      signals: row.signals === null ? null : parseJson(row.signals),
    }));

const readResourceUsage = (
  db: Database,
  snapshotId: string
): ReadonlyMap<string, readonly string[]> => {
  const rows = db
    .query<{ resource_id: string; trail_id: string }, [string]>(
      `SELECT resource_id, trail_id
       FROM topo_trail_resources
       WHERE snapshot_id = ?
       ORDER BY resource_id ASC, trail_id ASC`
    )
    .all(snapshotId);

  const usage = new Map<string, string[]>();
  for (const row of rows) {
    const trails = usage.get(row.resource_id) ?? [];
    trails.push(row.trail_id);
    usage.set(row.resource_id, trails);
  }

  return new Map(
    [...usage.entries()].map(([id, trails]) => [id, trails] as const)
  );
};

type SignalRelationTable =
  | 'topo_trail_fires'
  | 'topo_trail_on'
  | 'topo_trail_signals';

// Hard-coded query strings keyed by the union variant. The TypeScript union
// already constrains callers, but holding the literal SQL here removes any
// runtime path where `${table}` could be substituted from an unconstrained
// string.
const SIGNAL_RELATION_QUERIES = {
  topo_trail_fires: `SELECT trail_id
       FROM topo_trail_fires
       WHERE snapshot_id = ? AND signal_id = ?
       ORDER BY trail_id ASC`,
  topo_trail_on: `SELECT trail_id
       FROM topo_trail_on
       WHERE snapshot_id = ? AND signal_id = ?
       ORDER BY trail_id ASC`,
  topo_trail_signals: `SELECT trail_id
       FROM topo_trail_signals
       WHERE snapshot_id = ? AND signal_id = ?
       ORDER BY trail_id ASC`,
} as const satisfies Record<SignalRelationTable, string>;

const readSignalTrailIds = (
  db: Database,
  table: SignalRelationTable,
  snapshotId: string,
  signalId: string
): readonly string[] =>
  db
    .query<TopoSignalRelationRow, [string, string]>(
      SIGNAL_RELATION_QUERIES[table]
    )
    .all(snapshotId, signalId)
    .map((row) => row.trail_id);

const signalExamplePayload = (example: unknown): unknown => {
  if (typeof example !== 'object' || example === null) {
    return example;
  }
  const candidate = example as {
    readonly kind?: unknown;
    readonly payload?: unknown;
  };
  return candidate.kind === 'payload' && 'payload' in candidate
    ? candidate.payload
    : example;
};

const signalExamplesFromEntry = (
  storedEntry: StoredSurfaceMapEntry | undefined
): readonly unknown[] =>
  storedEntry?.examples?.map((example) => signalExamplePayload(example)) ?? [];

export const readTopoStoreSnapshot = (
  db: Database,
  ref?: TopoStoreRef
): TopoSnapshot | undefined => readSnapshotRef(db, ref);

export const listTopoStoreSnapshots = (
  db: Database,
  options?: ListTopoSnapshotsOptions
): readonly TopoSnapshot[] => listTopoSnapshots(db, options);

export const getTopoStoreExport = (
  db: Database,
  ref?: TopoStoreRef
): TopoStoreExportRecord | undefined => {
  const snapshot = readSnapshotRef(db, ref);
  if (snapshot === undefined) {
    return undefined;
  }

  const stored = getStoredTopoExport(db, snapshot.id);
  if (stored === undefined) {
    return undefined;
  }

  return {
    ...stored,
    snapshot,
  };
};

export const listTopoStoreTrails = (
  db: Database,
  options?: {
    readonly intent?: TopoStoreTrailRecord['intent'];
    readonly snapshot?: TopoStoreRef;
  }
): readonly TopoStoreTrailRecord[] => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return [];
  }

  const baseQuery = `SELECT id, intent, idempotent, has_output, has_examples, example_count, description, pattern, meta, snapshot_id
             FROM topo_trails`;

  let rows: TopoTrailRow[];
  if (options?.intent === undefined) {
    rows = db
      .query<TopoTrailRow, [string]>(
        `${baseQuery} WHERE snapshot_id = ? ORDER BY id ASC`
      )
      .all(snapshot.id);
  } else if (options.intent === 'write') {
    rows = db
      .query<TopoTrailRow, [string]>(
        `${baseQuery} WHERE snapshot_id = ? AND intent = 'write' ORDER BY id ASC`
      )
      .all(snapshot.id);
  } else {
    rows = db
      .query<TopoTrailRow, [string, string]>(
        `${baseQuery} WHERE snapshot_id = ? AND intent = ? ORDER BY id ASC`
      )
      .all(snapshot.id, options.intent);
  }

  return rows.map(mapTrailRow);
};

export const getTopoStoreTrail = (
  db: Database,
  trailId: string,
  options?: { readonly snapshot?: TopoStoreRef }
): TopoStoreTrailDetailRecord | undefined => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return undefined;
  }

  const row = db
    .query<TopoTrailRow, [string, string]>(
      `SELECT id, intent, idempotent, has_output, has_examples, example_count, description, pattern, meta, snapshot_id
       FROM topo_trails
       WHERE snapshot_id = ? AND id = ?
       LIMIT 1`
    )
    .get(snapshot.id, trailId);

  if (row === null || row === undefined) {
    return undefined;
  }

  const storedEntry = readStoredEntry(db, snapshot.id, 'trail', trailId);

  return {
    ...mapTrailRow(row),
    crosses: readTrailCrossings(db, snapshot.id, trailId),
    detours: storedEntry?.detours ?? null,
    examples: readTrailExamples(db, snapshot.id, trailId),
    resources: readTrailResourceIds(db, snapshot.id, trailId),
  };
};

const mapResourceRow = (
  row: TopoResourceRow,
  usedBy: readonly string[],
  storedEntry?: StoredSurfaceMapEntry
): TopoStoreResourceRecord => ({
  description: storedEntry?.description ?? null,
  hasHealth: row.has_health === 1,
  hasMock: row.has_mock === 1,
  health:
    row.has_health === 1 || storedEntry?.healthcheck === true
      ? 'available'
      : 'none',
  id: row.id,
  kind: 'resource',
  lifetime: 'singleton',
  snapshotId: row.snapshot_id,
  usedBy,
});

export const listTopoStoreResources = (
  db: Database,
  options?: { readonly snapshot?: TopoStoreRef }
): readonly TopoStoreResourceRecord[] => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return [];
  }

  const usage = readResourceUsage(db, snapshot.id);
  const rows = db
    .query<TopoResourceRow, [string]>(
      `SELECT id, has_mock, has_health, snapshot_id
       FROM topo_resources
       WHERE snapshot_id = ?
       ORDER BY id ASC`
    )
    .all(snapshot.id);

  const stored = getStoredTopoExport(db, snapshot.id);
  const entries = stored
    ? (JSON.parse(stored.surfaceMapJson) as StoredSurfaceMap).entries
    : [];

  return rows.map((row) =>
    mapResourceRow(
      row,
      usage.get(row.id) ?? [],
      entries.find((entry) => entry.id === row.id && entry.kind === 'resource')
    )
  );
};

export const getTopoStoreResource = (
  db: Database,
  resourceId: string,
  options?: { readonly snapshot?: TopoStoreRef }
): TopoStoreResourceRecord | undefined => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return undefined;
  }

  const row = db
    .query<TopoResourceRow, [string, string]>(
      `SELECT id, has_mock, has_health, snapshot_id
       FROM topo_resources
       WHERE snapshot_id = ? AND id = ?
       LIMIT 1`
    )
    .get(snapshot.id, resourceId);

  if (row === null || row === undefined) {
    return undefined;
  }

  const usage = readResourceUsage(db, snapshot.id);
  return mapResourceRow(
    row,
    usage.get(resourceId) ?? [],
    readStoredEntry(db, snapshot.id, 'resource', resourceId)
  );
};

const mapSignalRow = (
  row: TopoSignalRow,
  storedEntry: StoredSurfaceMapEntry | undefined,
  relations: {
    readonly consumers: readonly string[];
    readonly from: readonly string[];
    readonly producers: readonly string[];
  }
): TopoStoreSignalRecord => {
  const exampleCount =
    storedEntry?.exampleCount ?? storedEntry?.examples?.length ?? 0;

  return {
    consumers: relations.consumers,
    description: storedEntry?.description ?? row.description,
    exampleCount,
    from: relations.from,
    hasExamples: exampleCount > 0,
    id: row.id,
    kind: 'signal',
    // Derived from the stored surface-map entry rather than hard-coded so the
    // list flag stays coherent with the detail record's `payload` field. If the
    // surface-map entry is missing for a signal row (e.g. partial import or
    // schema migration), `payload` would be null in the detail; signaling
    // `payloadSchema: true` here would mislead consumers into skipping the
    // detail call.
    payloadSchema:
      storedEntry?.payload !== undefined || storedEntry?.input !== undefined,
    producers: relations.producers,
    snapshotId: row.snapshot_id,
  };
};

const readSignalRelations = (
  db: Database,
  snapshotId: string,
  signalId: string
) => ({
  consumers: readSignalTrailIds(db, 'topo_trail_on', snapshotId, signalId),
  from: readSignalTrailIds(db, 'topo_trail_signals', snapshotId, signalId),
  producers: readSignalTrailIds(db, 'topo_trail_fires', snapshotId, signalId),
});

export const listTopoStoreSignals = (
  db: Database,
  options?: { readonly snapshot?: TopoStoreRef }
): readonly TopoStoreSignalRecord[] => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return [];
  }

  const rows = db
    .query<TopoSignalRow, [string]>(
      `SELECT id, description, snapshot_id
       FROM topo_signals
       WHERE snapshot_id = ?
       ORDER BY id ASC`
    )
    .all(snapshot.id);

  const stored = getStoredTopoExport(db, snapshot.id);
  const entries = stored
    ? (JSON.parse(stored.surfaceMapJson) as StoredSurfaceMap).entries
    : [];

  return rows.map((row) =>
    mapSignalRow(
      row,
      entries.find((entry) => entry.id === row.id && entry.kind === 'signal'),
      readSignalRelations(db, snapshot.id, row.id)
    )
  );
};

export const getTopoStoreSignal = (
  db: Database,
  signalId: string,
  options?: { readonly snapshot?: TopoStoreRef }
): TopoStoreSignalDetailRecord | undefined => {
  const snapshot = readSnapshotRef(db, options?.snapshot);
  if (snapshot === undefined) {
    return undefined;
  }

  const row = db
    .query<TopoSignalRow, [string, string]>(
      `SELECT id, description, snapshot_id
       FROM topo_signals
       WHERE snapshot_id = ? AND id = ?
       LIMIT 1`
    )
    .get(snapshot.id, signalId);

  if (row === null || row === undefined) {
    return undefined;
  }

  const storedEntry = readStoredEntry(db, snapshot.id, 'signal', signalId);
  return {
    ...mapSignalRow(
      row,
      storedEntry,
      readSignalRelations(db, snapshot.id, signalId)
    ),
    examples: signalExamplesFromEntry(storedEntry),
    payload: storedEntry?.payload ?? storedEntry?.input ?? null,
  };
};

export const queryTopoStore = <TRow extends Record<string, unknown>>(
  db: Database,
  sql: string,
  bindings?: readonly SQLQueryBindings[]
): readonly TRow[] =>
  db
    .query<TRow, SQLQueryBindings[]>(sql)
    .all(...(bindings === undefined ? [] : [...bindings]));
