import type { SQLQueryBindings } from 'bun:sqlite';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { openWriteTrailsDb } from '@ontrails/core/internal/trails-db';

import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  TRACK_TABLE,
  applyTraceCleanup,
  countTraceRecords,
  ensureTraceSchema,
} from '../internal/dev-state.js';

import type { TraceRecord, TraceSink } from '@ontrails/core';

/** Configuration for the SQLite dev store. */
export interface DevStoreOptions {
  /** Path to the SQLite database file. Defaults to `.trails/trails.db`. */
  readonly path?: string;
  /** Root directory used when resolving the default `.trails/trails.db` path. */
  readonly rootDir?: string;
  /** Maximum number of records to retain. Defaults to 10000. */
  readonly maxRecords?: number;
  /** Maximum age of records in milliseconds. Defaults to 7 days. */
  readonly maxAge?: number;
}

/** Query options for filtering stored track records. */
export interface DevStoreQueryOptions {
  readonly trailId?: string;
  readonly traceId?: string;
  readonly errorsOnly?: boolean;
  readonly limit?: number;
}

/** Read-only query surface over persisted track records. */
export interface TraceStore {
  /** Query recent traces with optional filters. */
  readonly query: (options?: DevStoreQueryOptions) => readonly TraceRecord[];
  /** Return the total number of stored records. */
  readonly count: () => number;
  /** Close the database connection. */
  readonly close: () => void;
}

/** SQLite-backed dev store for persisting and querying track records. */
export interface DevStore extends TraceStore, TraceSink {}

/** Shape of a row returned from the tracing table. */
interface TraceRow {
  readonly id: string;
  readonly trace_id: string;
  readonly root_id: string;
  readonly parent_id: string | null;
  readonly kind: string;
  readonly name: string;
  readonly trail_id: string | null;
  readonly trailhead: string | null;
  readonly intent: string | null;
  readonly started_at: number;
  readonly ended_at: number | null;
  readonly status: string;
  readonly error_category: string | null;
  readonly permit_id: string | null;
  readonly permit_tenant_id: string | null;
  readonly attrs: string | null;
}

/** Reconstruct the permit object from decomposed columns. */
const buildPermit = (
  permitId: string | null,
  tenantId: string | null
): TraceRecord['permit'] => {
  if (permitId === null) {
    return undefined;
  }
  return tenantId === null ? { id: permitId } : { id: permitId, tenantId };
};

/** Parse attrs JSON back into a record. */
const parseAttrs = (raw: string | null): Readonly<Record<string, unknown>> =>
  raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

/** Reconstruct a TraceRecord from a database row. */
const rowToRecord = (row: TraceRow): TraceRecord => ({
  attrs: parseAttrs(row.attrs),
  endedAt: row.ended_at ?? undefined,
  errorCategory: row.error_category ?? undefined,
  id: row.id,
  intent: (row.intent ?? undefined) as TraceRecord['intent'],
  kind: row.kind as TraceRecord['kind'],
  name: row.name,
  parentId: row.parent_id ?? undefined,
  permit: buildPermit(row.permit_id, row.permit_tenant_id),
  rootId: row.root_id,
  startedAt: row.started_at,
  status: row.status as TraceRecord['status'],
  traceId: row.trace_id,
  trailId: row.trail_id ?? undefined,
  trailhead: (row.trailhead ?? undefined) as TraceRecord['trailhead'],
});

/** Filter definition: column condition and optional bound value. */
interface QueryFilter {
  readonly condition: string;
  readonly value?: SQLQueryBindings;
}

/** Derive active filters from query options. */
const deriveFilters = (
  options?: DevStoreQueryOptions
): readonly QueryFilter[] => {
  const filters: QueryFilter[] = [];

  if (options?.trailId !== undefined) {
    filters.push({ condition: 'trail_id = ?', value: options.trailId });
  }
  if (options?.traceId !== undefined) {
    filters.push({ condition: 'trace_id = ?', value: options.traceId });
  }
  if (options?.errorsOnly === true) {
    filters.push({ condition: "status = 'err'" });
  }

  return filters;
};

/** Build a parameterized SELECT query from query options. */
const buildQuery = (
  defaultLimit: number,
  options?: DevStoreQueryOptions
): { readonly sql: string; readonly params: SQLQueryBindings[] } => {
  const filters = deriveFilters(options);
  const where =
    filters.length > 0
      ? `WHERE ${filters.map((f) => f.condition).join(' AND ')}`
      : '';
  const params: SQLQueryBindings[] = [
    ...filters.flatMap((f) => (f.value === undefined ? [] : [f.value])),
    options?.limit ?? defaultLimit,
  ];

  return {
    params,
    sql: `SELECT * FROM ${TRACK_TABLE} ${where} ORDER BY started_at DESC LIMIT ?`,
  };
};

/** Serialize attrs to JSON, returning null for empty objects. */
const serializeAttrs = (
  attrs: Readonly<Record<string, unknown>>
): string | null =>
  Object.keys(attrs).length > 0 ? JSON.stringify(attrs) : null;

/** Serialize a TraceRecord into positional INSERT parameters. */
const recordToParams = (record: TraceRecord): SQLQueryBindings[] => [
  record.id,
  record.traceId,
  record.rootId,
  record.parentId ?? null,
  record.kind,
  record.name,
  record.trailId ?? null,
  record.trailhead ?? null,
  record.intent ?? null,
  record.startedAt,
  record.endedAt ?? null,
  record.status,
  record.errorCategory ?? null,
  record.permit?.id ?? null,
  record.permit?.tenantId ?? null,
  serializeAttrs(record.attrs),
];

/** SQL for inserting a track record. */
const UPSERT_SQL = `INSERT INTO ${TRACK_TABLE} (
  id, trace_id, root_id, parent_id,
  kind, name, trail_id, trailhead,
  intent, started_at, ended_at, status,
  error_category, permit_id, permit_tenant_id, attrs
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  trace_id = excluded.trace_id,
  root_id = excluded.root_id,
  parent_id = excluded.parent_id,
  kind = excluded.kind,
  name = excluded.name,
  trail_id = excluded.trail_id,
  trailhead = excluded.trailhead,
  intent = excluded.intent,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  status = excluded.status,
  error_category = excluded.error_category,
  permit_id = excluded.permit_id,
  permit_tenant_id = excluded.permit_tenant_id,
  attrs = excluded.attrs`;

/** Create a transactional writer that keeps retention pruning atomic. */
const createWriter = (
  db: Database,
  insertStmt: ReturnType<Database['prepare']>,
  maxRecords: number,
  maxAge: number | undefined
): ((record: TraceRecord) => void) =>
  db.transaction((record: TraceRecord) => {
    insertStmt.run(...recordToParams(record));
    applyTraceCleanup(db, {
      maxRecords,
      ...(maxAge === undefined ? {} : { maxAge }),
    });
  });

interface LegacyStoreCandidate {
  readonly path: string;
  readonly tableName: string;
}

const resolveLegacyCandidates = (
  rootDir?: string
): readonly LegacyStoreCandidate[] => {
  const devDir = join(rootDir ?? process.cwd(), '.trails', 'dev');
  return [
    { path: join(devDir, 'tracing.db'), tableName: 'tracing' },
    { path: join(devDir, 'tracker.db'), tableName: 'tracker' },
  ];
};

const hasLegacyTable = (db: Database, tableName: string): boolean => {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(tableName);
  return row?.name === tableName;
};

const shouldSkipLegacyMigration = (
  db: Database,
  _options: DevStoreOptions | undefined
): boolean => countTraceRecords(db) > 0;

interface LegacyCandidateRows {
  readonly matched: boolean;
  readonly rows: readonly TraceRow[];
}

const readLegacyCandidateRows = (
  candidate: LegacyStoreCandidate
): LegacyCandidateRows => {
  if (!existsSync(candidate.path)) {
    return { matched: false, rows: [] };
  }

  const legacyDb = new Database(candidate.path, { readonly: true });
  try {
    if (!hasLegacyTable(legacyDb, candidate.tableName)) {
      return { matched: false, rows: [] };
    }

    return {
      matched: true,
      rows: legacyDb
        .query<TraceRow, []>(
          `SELECT * FROM ${candidate.tableName} ORDER BY started_at ASC`
        )
        .all(),
    };
  } finally {
    legacyDb.close();
  }
};

interface LegacyRows {
  readonly paths: readonly string[];
  readonly rows: readonly TraceRow[];
}

/** Read rows from all supported legacy stores and track which files were consumed. */
const drainLegacyRows = (options: DevStoreOptions | undefined): LegacyRows => {
  const rows: TraceRow[] = [];
  const paths: string[] = [];

  for (const candidate of resolveLegacyCandidates(options?.rootDir)) {
    const candidateRows = readLegacyCandidateRows(candidate);
    if (!candidateRows.matched) {
      continue;
    }
    paths.push(candidate.path);
    rows.push(...candidateRows.rows);
  }

  return { paths, rows };
};

const removeLegacyDbFiles = (paths: readonly string[]): void => {
  for (const path of paths) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${path}${suffix}`;
      if (existsSync(sidecar)) {
        unlinkSync(sidecar);
      }
    }
  }
};

const migrateLegacyRows = (
  rows: readonly TraceRow[],
  write: (record: TraceRecord) => void
): void => {
  for (const row of rows) {
    write(rowToRecord(row));
  }
};

const migrateLegacyStoreIfPresent = (
  db: Database,
  options: DevStoreOptions | undefined,
  write: (record: TraceRecord) => void
): void => {
  if (shouldSkipLegacyMigration(db, options)) {
    return;
  }
  const { paths, rows } = drainLegacyRows(options);
  if (paths.length === 0) {
    return;
  }
  migrateLegacyRows(rows, write);
  removeLegacyDbFiles(paths);
};

const createReadApi = (db: Database, defaultLimit: number): TraceStore => ({
  close: () => {
    db.close();
  },
  count: () => countTraceRecords(db),
  query: (queryOptions?: DevStoreQueryOptions): readonly TraceRecord[] => {
    const { sql, params } = buildQuery(defaultLimit, queryOptions);
    const rows = db.query<TraceRow, SQLQueryBindings[]>(sql).all(...params);
    return rows.map(rowToRecord);
  },
});

/**
 * Create a SQLite-backed dev store for persisting track records.
 *
 * Uses WAL mode and normal synchronous for good write performance.
 * Automatically prunes records exceeding `maxRecords` on each write.
 */
export const createDevStore = (options?: DevStoreOptions): DevStore => {
  const maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxAge = options?.maxAge ?? DEFAULT_MAX_AGE;
  const db = openWriteTrailsDb({
    ...(options?.path === undefined ? {} : { path: options.path }),
    ...(options?.rootDir === undefined ? {} : { rootDir: options.rootDir }),
  });
  ensureTraceSchema(db);
  const insertStmt = db.prepare(UPSERT_SQL);
  const write = createWriter(db, insertStmt, maxRecords, maxAge);
  migrateLegacyStoreIfPresent(db, options, write);
  return { ...createReadApi(db, maxRecords), write };
};

/**
 * Read-only view of a TraceStore.
 *
 * `close()` is a no-op — consumers of this view (e.g. the tracing resource)
 * must not close the underlying connection they don't own.
 */
export const toTraceStore = (store: TraceStore): TraceStore => ({
  close: () => {
    // Intentional no-op: read-only view must not close the underlying DB.
  },
  count: () => store.count(),
  query: (options?: DevStoreQueryOptions) => store.query(options),
});
