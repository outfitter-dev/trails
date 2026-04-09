import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { ValidationError } from '../errors.js';
import type { TopoPinRecord, TopoSaveRecord } from './topo-saves.js';
import {
  getTopoPin,
  getTopoSave,
  listTopoPins,
  listTopoSaves,
} from './topo-saves.js';
import type { StoredTopoExport } from './topo-store.js';
import { getStoredTopoExport } from './topo-store.js';

export interface TopoStoreRef {
  readonly pin?: string;
  readonly saveId?: string;
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
  readonly safety: '-' | 'destroy' | 'read' | 'write';
  readonly saveId: string;
}

export interface TopoStoreExampleRecord {
  readonly description: string | null;
  readonly error: string | null;
  readonly expected: unknown;
  readonly input: unknown;
  readonly name: string;
  readonly ordinal: number;
}

export interface TopoStoreTrailDetailRecord extends TopoStoreTrailRecord {
  readonly crosses: readonly string[];
  readonly detours: Readonly<Record<string, readonly string[]>> | null;
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
  readonly saveId: string;
  readonly usedBy: readonly string[];
}

export interface TopoStoreExportRecord extends StoredTopoExport {
  readonly save: TopoSaveRecord;
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
  readonly save_id: string;
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
  readonly input: string;
  readonly name: string;
  readonly ordinal: number;
}

interface TopoResourceRow {
  readonly has_health: number;
  readonly has_mock: number;
  readonly id: string;
  readonly save_id: string;
}

interface StoredTrailheadMapEntry {
  readonly description?: string;
  readonly detours?: Readonly<Record<string, readonly string[]>>;
  readonly healthcheck?: boolean;
  readonly id: string;
  readonly kind: 'resource' | 'signal' | 'trail';
}

interface StoredTrailheadMap {
  readonly entries: readonly StoredTrailheadMapEntry[];
}

const ensureSingleRefSelector = (ref?: TopoStoreRef): void => {
  if (ref?.pin !== undefined && ref.saveId !== undefined) {
    throw new ValidationError(
      'Topo store references may use pin or saveId, not both'
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

const resolveRefSave = (
  db: Database,
  ref?: TopoStoreRef
): TopoSaveRecord | undefined => {
  ensureSingleRefSelector(ref);

  if (ref?.saveId !== undefined) {
    return getTopoSave(db, ref.saveId);
  }

  if (ref?.pin !== undefined) {
    const pin = getTopoPin(db, ref.pin);
    return pin === undefined ? undefined : getTopoSave(db, pin.saveId);
  }

  return listTopoSaves(db)[0];
};

const readStoredEntry = (
  db: Database,
  saveId: string,
  kind: StoredTrailheadMapEntry['kind'],
  id: string
): StoredTrailheadMapEntry | undefined => {
  const stored = getStoredTopoExport(db, saveId);
  if (stored === undefined) {
    return undefined;
  }

  const map = JSON.parse(stored.trailheadMapJson) as StoredTrailheadMap;
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
    safety: safetyForIntent(intent),
    saveId: row.save_id,
  };
};

const readTrailCrossings = (
  db: Database,
  saveId: string,
  trailId: string
): readonly string[] =>
  db
    .query<TopoCrossingRow, [string, string]>(
      `SELECT target_id
       FROM topo_crossings
       WHERE save_id = ? AND source_id = ?
       ORDER BY target_id ASC`
    )
    .all(saveId, trailId)
    .map((row) => row.target_id);

const readTrailResourceIds = (
  db: Database,
  saveId: string,
  trailId: string
): readonly string[] =>
  db
    .query<TopoTrailResourceRow, [string, string]>(
      `SELECT resource_id
       FROM topo_trail_resources
       WHERE save_id = ? AND trail_id = ?
       ORDER BY resource_id ASC`
    )
    .all(saveId, trailId)
    .map((row) => row.resource_id);

const readTrailExamples = (
  db: Database,
  saveId: string,
  trailId: string
): readonly TopoStoreExampleRecord[] =>
  db
    .query<TopoExampleRow, [string, string]>(
      `SELECT ordinal, name, description, input, expected, error
       FROM topo_examples
       WHERE save_id = ? AND trail_id = ?
       ORDER BY ordinal ASC`
    )
    .all(saveId, trailId)
    .map((row) => ({
      description: row.description,
      error: row.error,
      expected: row.expected === null ? null : parseJson(row.expected),
      input: parseJson(row.input),
      name: row.name,
      ordinal: row.ordinal,
    }));

const readResourceUsage = (
  db: Database,
  saveId: string
): ReadonlyMap<string, readonly string[]> => {
  const rows = db
    .query<{ resource_id: string; trail_id: string }, [string]>(
      `SELECT resource_id, trail_id
       FROM topo_trail_resources
       WHERE save_id = ?
       ORDER BY resource_id ASC, trail_id ASC`
    )
    .all(saveId);

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

export const resolveTopoStoreSave = (
  db: Database,
  ref?: TopoStoreRef
): TopoSaveRecord | undefined => resolveRefSave(db, ref);

export const listTopoStorePins = (db: Database): readonly TopoPinRecord[] =>
  listTopoPins(db);

export const listTopoStoreSaves = (db: Database): readonly TopoSaveRecord[] =>
  listTopoSaves(db);

export const getTopoStoreExport = (
  db: Database,
  ref?: TopoStoreRef
): TopoStoreExportRecord | undefined => {
  const save = resolveRefSave(db, ref);
  if (save === undefined) {
    return undefined;
  }

  const stored = getStoredTopoExport(db, save.id);
  if (stored === undefined) {
    return undefined;
  }

  return {
    ...stored,
    save,
  };
};

export const listTopoStoreTrails = (
  db: Database,
  options?: {
    readonly intent?: TopoStoreTrailRecord['intent'];
    readonly save?: TopoStoreRef;
  }
): readonly TopoStoreTrailRecord[] => {
  const save = resolveRefSave(db, options?.save);
  if (save === undefined) {
    return [];
  }

  const baseQuery = `SELECT id, intent, idempotent, has_output, has_examples, example_count, description, meta, save_id
             FROM topo_trails`;

  let rows: TopoTrailRow[];
  if (options?.intent === undefined) {
    rows = db
      .query<TopoTrailRow, [string]>(
        `${baseQuery} WHERE save_id = ? ORDER BY id ASC`
      )
      .all(save.id);
  } else if (options.intent === 'write') {
    rows = db
      .query<TopoTrailRow, [string]>(
        `${baseQuery} WHERE save_id = ? AND intent = 'write' ORDER BY id ASC`
      )
      .all(save.id);
  } else {
    rows = db
      .query<TopoTrailRow, [string, string]>(
        `${baseQuery} WHERE save_id = ? AND intent = ? ORDER BY id ASC`
      )
      .all(save.id, options.intent);
  }

  return rows.map(mapTrailRow);
};

export const getTopoStoreTrail = (
  db: Database,
  trailId: string,
  options?: { readonly save?: TopoStoreRef }
): TopoStoreTrailDetailRecord | undefined => {
  const save = resolveRefSave(db, options?.save);
  if (save === undefined) {
    return undefined;
  }

  const row = db
    .query<TopoTrailRow, [string, string]>(
      `SELECT id, intent, idempotent, has_output, has_examples, example_count, description, meta, save_id
       FROM topo_trails
       WHERE save_id = ? AND id = ?
       LIMIT 1`
    )
    .get(save.id, trailId);

  if (row === null || row === undefined) {
    return undefined;
  }

  const storedEntry = readStoredEntry(db, save.id, 'trail', trailId);

  return {
    ...mapTrailRow(row),
    crosses: readTrailCrossings(db, save.id, trailId),
    detours: storedEntry?.detours ?? null,
    examples: readTrailExamples(db, save.id, trailId),
    resources: readTrailResourceIds(db, save.id, trailId),
  };
};

const mapResourceRow = (
  row: TopoResourceRow,
  usedBy: readonly string[],
  storedEntry?: StoredTrailheadMapEntry
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
  saveId: row.save_id,
  usedBy,
});

export const listTopoStoreResources = (
  db: Database,
  options?: { readonly save?: TopoStoreRef }
): readonly TopoStoreResourceRecord[] => {
  const save = resolveRefSave(db, options?.save);
  if (save === undefined) {
    return [];
  }

  const usage = readResourceUsage(db, save.id);
  const rows = db
    .query<TopoResourceRow, [string]>(
      `SELECT id, has_mock, has_health, save_id
       FROM topo_resources
       WHERE save_id = ?
       ORDER BY id ASC`
    )
    .all(save.id);

  const stored = getStoredTopoExport(db, save.id);
  const entries = stored
    ? (JSON.parse(stored.trailheadMapJson) as StoredTrailheadMap).entries
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
  options?: { readonly save?: TopoStoreRef }
): TopoStoreResourceRecord | undefined => {
  const save = resolveRefSave(db, options?.save);
  if (save === undefined) {
    return undefined;
  }

  const row = db
    .query<TopoResourceRow, [string, string]>(
      `SELECT id, has_mock, has_health, save_id
       FROM topo_resources
       WHERE save_id = ? AND id = ?
       LIMIT 1`
    )
    .get(save.id, resourceId);

  if (row === null || row === undefined) {
    return undefined;
  }

  const usage = readResourceUsage(db, save.id);
  return mapResourceRow(
    row,
    usage.get(resourceId) ?? [],
    readStoredEntry(db, save.id, 'resource', resourceId)
  );
};

export const queryTopoStore = <TRow extends Record<string, unknown>>(
  db: Database,
  sql: string,
  bindings?: readonly SQLQueryBindings[]
): readonly TRow[] =>
  db
    .query<TRow, SQLQueryBindings[]>(sql)
    .all(...(bindings === undefined ? [] : [...bindings]));
