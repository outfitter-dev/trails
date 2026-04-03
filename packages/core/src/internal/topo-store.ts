import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { deriveCliPath } from '../derive.js';
import { Result } from '../result.js';
import type { AnyProvision } from '../provision.js';
import type { AnySignal } from '../signal.js';
import type { Topo } from '../topo.js';
import type { AnyTrail } from '../trail.js';
import { validateEstablishedTopo } from '../validate-established-topo.js';
import type { CreateTopoSaveInput, TopoSaveRecord } from './topo-saves.js';
import { ensureTopoHistorySchema, insertTopoSaveRecord } from './topo-saves.js';

interface TopoTrailRow {
  readonly description: string | null;
  readonly exampleCount: number;
  readonly hasExamples: number;
  readonly hasOutput: number;
  readonly id: string;
  readonly idempotent: number;
  readonly intent: string;
  readonly meta: string | null;
  readonly saveId: string;
}

interface TopoCrossingRow {
  readonly saveId: string;
  readonly sourceId: string;
  readonly targetId: string;
}

interface TopoTrailProvisionRow {
  readonly provisionId: string;
  readonly saveId: string;
  readonly trailId: string;
}

interface TopoProvisionRow {
  readonly hasHealth: number;
  readonly hasMock: number;
  readonly id: string;
  readonly saveId: string;
}

interface TopoSignalRow {
  readonly description: string | null;
  readonly id: string;
  readonly saveId: string;
}

interface TopoTrailSignalRow {
  readonly saveId: string;
  readonly signalId: string;
  readonly trailId: string;
}

interface TopoTrailheadRow {
  readonly derivedName: string;
  readonly method: string | null;
  readonly saveId: string;
  readonly trailId: string;
  readonly trailhead: string;
}

interface TopoExampleRow {
  readonly description: string | null;
  readonly error: string | null;
  readonly expected: string | null;
  readonly id: string;
  readonly input: string;
  readonly name: string;
  readonly ordinal: number;
  readonly saveId: string;
  readonly trailId: string;
}

interface NormalizedTopoProjection {
  readonly crossings: readonly TopoCrossingRow[];
  readonly examples: readonly TopoExampleRow[];
  readonly provisions: readonly TopoProvisionRow[];
  readonly signals: readonly TopoSignalRow[];
  readonly trailheads: readonly TopoTrailheadRow[];
  readonly trailProvisions: readonly TopoTrailProvisionRow[];
  readonly trailSignals: readonly TopoTrailSignalRow[];
  readonly trails: readonly TopoTrailRow[];
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const stableJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

const normalizeTrailRows = (
  trails: readonly AnyTrail[],
  saveId: string
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
    saveId,
  }));

const normalizeCrossingRows = (
  trails: readonly AnyTrail[],
  saveId: string
): readonly TopoCrossingRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.crosses)].toSorted().map((targetId) => ({
      saveId,
      sourceId: trail.id,
      targetId,
    }))
  );

const normalizeTrailProvisionRows = (
  trails: readonly AnyTrail[],
  saveId: string
): readonly TopoTrailProvisionRow[] =>
  trails.flatMap((trail) =>
    [...new Set(trail.provisions.map((provision) => provision.id))]
      .toSorted()
      .map((provisionId) => ({
        provisionId,
        saveId,
        trailId: trail.id,
      }))
  );

const normalizeProvisionRows = (
  provisions: readonly AnyProvision[],
  saveId: string
): readonly TopoProvisionRow[] =>
  provisions.map((provision) => ({
    hasHealth: provision.health === undefined ? 0 : 1,
    hasMock: provision.mock === undefined ? 0 : 1,
    id: provision.id,
    saveId,
  }));

const normalizeSignalRows = (
  signals: readonly AnySignal[],
  saveId: string
): readonly TopoSignalRow[] =>
  signals.map((signal) => ({
    description: signal.description ?? null,
    id: signal.id,
    saveId,
  }));

const normalizeTrailSignalRows = (
  signals: readonly AnySignal[],
  saveId: string
): readonly TopoTrailSignalRow[] =>
  signals.flatMap((signal) =>
    [...new Set(signal.from ?? [])].toSorted().map((trailId) => ({
      saveId,
      signalId: signal.id,
      trailId,
    }))
  );

/**
 * Project trailhead rows for stored topo.
 *
 * Currently records only CLI-derived rows. MCP, HTTP, and other trailhead
 * projections are intentionally deferred until the topo-store schema supports
 * multi-trailhead representation. The JSON export (`trailhead_map` in
 * `topo_exports`) is more faithful for now. See ADR-0015 for the target shape.
 */
const normalizeTrailheadRows = (
  trails: readonly AnyTrail[],
  saveId: string
): readonly TopoTrailheadRow[] =>
  trails.map((trail) => ({
    derivedName: deriveCliPath(trail.id).join(' '),
    method: null,
    saveId,
    trailId: trail.id,
    trailhead: 'cli',
  }));

const buildExampleId = (
  saveId: string,
  trailId: string,
  ordinal: number
): string => `${saveId}:${trailId}:${ordinal.toString().padStart(4, '0')}`;

const normalizeExampleRows = (
  trails: readonly AnyTrail[],
  saveId: string
): readonly TopoExampleRow[] =>
  trails.flatMap((trail) =>
    (trail.examples ?? []).map((example, index) => ({
      description: example.description ?? null,
      error: example.error ?? null,
      expected:
        example.expected === undefined ? null : stableJson(example.expected),
      id: buildExampleId(saveId, trail.id, index),
      input: stableJson(example.input),
      name: example.name,
      ordinal: index,
      saveId,
      trailId: trail.id,
    }))
  );

const normalizeTopoProjection = (
  topo: Topo,
  saveId: string
): NormalizedTopoProjection => {
  const trails = topo.list().toSorted((a, b) => a.id.localeCompare(b.id));
  const provisions = topo
    .listProvisions()
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const signals = topo
    .listSignals()
    .toSorted((a, b) => a.id.localeCompare(b.id));

  return {
    crossings: normalizeCrossingRows(trails, saveId),
    examples: normalizeExampleRows(trails, saveId),
    provisions: normalizeProvisionRows(provisions, saveId),
    signals: normalizeSignalRows(signals, saveId),
    trailProvisions: normalizeTrailProvisionRows(trails, saveId),
    trailSignals: normalizeTrailSignalRows(signals, saveId),
    trailheads: normalizeTrailheadRows(trails, saveId),
    trails: normalizeTrailRows(trails, saveId),
  };
};

/**
 * Look up a cached JSON schema by content hash.
 *
 * The query matches on `zod_hash` without filtering by `save_id` because the
 * cache is intentionally cross-save: if the Zod schema definition has not
 * changed (same hash), the serialized JSON Schema is reused regardless of
 * which save produced it. This is safe as long as `zodToJsonSchema` is
 * deterministic for a given `_def` hash — the `schemaDefinitionHash` pipeline
 * guarantees that structurally identical schemas produce the same hash.
 */
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
      id, intent, idempotent, has_output, has_examples, example_count, description, meta, save_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    (row) => [
      row.id,
      row.intent,
      row.idempotent,
      row.hasOutput,
      row.hasExamples,
      row.exampleCount,
      row.description,
      row.meta,
      row.saveId,
    ]
  );
  insertRows(
    db,
    projection.crossings,
    'INSERT INTO topo_crossings (source_id, target_id, save_id) VALUES (?, ?, ?)',
    (row) => [row.sourceId, row.targetId, row.saveId]
  );
  insertRows(
    db,
    projection.trailProvisions,
    `INSERT INTO topo_trail_provisions (trail_id, provision_id, save_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.provisionId, row.saveId]
  );
  insertRows(
    db,
    projection.provisions,
    `INSERT INTO topo_provisions (id, has_mock, has_health, save_id)
     VALUES (?, ?, ?, ?)`,
    (row) => [row.id, row.hasMock, row.hasHealth, row.saveId]
  );
  insertRows(
    db,
    projection.signals,
    'INSERT INTO topo_signals (id, description, save_id) VALUES (?, ?, ?)',
    (row) => [row.id, row.description, row.saveId]
  );
  insertRows(
    db,
    projection.trailSignals,
    `INSERT INTO topo_trail_signals (trail_id, signal_id, save_id)
     VALUES (?, ?, ?)`,
    (row) => [row.trailId, row.signalId, row.saveId]
  );
  insertRows(
    db,
    projection.trailheads,
    `INSERT INTO topo_trailheads (trail_id, trailhead, derived_name, method, save_id)
     VALUES (?, ?, ?, ?, ?)`,
    (row) => [
      row.trailId,
      row.trailhead,
      row.derivedName,
      row.method,
      row.saveId,
    ]
  );
  insertRows(
    db,
    projection.examples,
    `INSERT INTO topo_examples (
      id, trail_id, ordinal, name, description, input, expected, error, save_id
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
      row.saveId,
    ]
  );
};

export const persistEstablishedTopoSave = (
  db: Database,
  topo: Topo,
  input?: CreateTopoSaveInput
): Result<TopoSaveRecord, Error> => {
  const validated = validateEstablishedTopo(topo);
  if (validated.isErr()) {
    return Result.err(validated.error);
  }

  ensureTopoHistorySchema(db);

  const saveInput: CreateTopoSaveInput = {
    ...input,
    provisionCount: input?.provisionCount ?? topo.provisions.size,
    signalCount: input?.signalCount ?? topo.signals.size,
    trailCount: input?.trailCount ?? topo.trails.size,
  };

  return db.transaction(() => {
    const save = insertTopoSaveRecord(db, saveInput);
    insertProjectedRows(db, normalizeTopoProjection(topo, save.id));
    return created;
  })();

  return Result.ok(record);
};
