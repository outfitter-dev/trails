import type { SQLQueryBindings } from 'bun:sqlite';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { openWriteTrailsDb } from '@ontrails/core/internal/trails-db';

import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  TRACK_TABLE,
  applyTrackCleanup,
  countTrackRecords,
  ensureTrackSchema,
} from '../internal/dev-state.js';

import type { Track } from '../track.js';
import type { TrackSink } from '../tracker-gate.js';

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
export interface TrackStore {
  /** Query recent traces with optional filters. */
  readonly query: (options?: DevStoreQueryOptions) => readonly Track[];
  /** Return the total number of stored records. */
  readonly count: () => number;
  /** Close the database connection. */
  readonly close: () => void;
}

/** SQLite-backed dev store for persisting and querying track records. */
export interface DevStore extends TrackStore, TrackSink {}

/** Shape of a row returned from the tracker table. */
interface TrackRow {
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
): Track['permit'] => {
  if (permitId === null) {
    return undefined;
  }
  return tenantId === null ? { id: permitId } : { id: permitId, tenantId };
};

/** Parse attrs JSON back into a record. */
const parseAttrs = (raw: string | null): Readonly<Record<string, unknown>> =>
  raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

/** Reconstruct a Track from a database row. */
const rowToRecord = (row: TrackRow): Track => ({
  attrs: parseAttrs(row.attrs),
  endedAt: row.ended_at ?? undefined,
  errorCategory: row.error_category ?? undefined,
  id: row.id,
  intent: (row.intent ?? undefined) as Track['intent'],
  kind: row.kind as Track['kind'],
  name: row.name,
  parentId: row.parent_id ?? undefined,
  permit: buildPermit(row.permit_id, row.permit_tenant_id),
  rootId: row.root_id,
  startedAt: row.started_at,
  status: row.status as Track['status'],
  traceId: row.trace_id,
  trailId: row.trail_id ?? undefined,
  trailhead: (row.trailhead ?? undefined) as Track['trailhead'],
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

/** Serialize a Track into positional INSERT parameters. */
const recordToParams = (record: Track): SQLQueryBindings[] => [
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
): ((record: Track) => void) =>
  db.transaction((record: Track) => {
    insertStmt.run(...recordToParams(record));
    applyTrackCleanup(db, {
      maxRecords,
      ...(maxAge === undefined ? {} : { maxAge }),
    });
  });

const resolveLegacyPath = (rootDir?: string): string =>
  join(rootDir ?? process.cwd(), '.trails', 'dev', 'tracker.db');

const hasLegacyTrackerTable = (db: Database): boolean => {
  const row = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracker'"
    )
    .get();
  return row?.name === 'tracker';
};

const shouldSkipLegacyMigration = (
  db: Database,
  _options: DevStoreOptions | undefined
): boolean => countTrackRecords(db) > 0;

const readLegacyRows = (legacyDb: Database): readonly TrackRow[] => {
  if (!hasLegacyTrackerTable(legacyDb)) {
    return [];
  }

  return legacyDb
    .query<TrackRow, []>('SELECT * FROM tracker ORDER BY started_at ASC')
    .all();
};

const openLegacyDb = (
  options: DevStoreOptions | undefined
): Database | undefined => {
  const legacyPath = resolveLegacyPath(options?.rootDir);
  if (!existsSync(legacyPath)) {
    return undefined;
  }

  return new Database(legacyPath, { readonly: true });
};

/** Read rows from the legacy DB and close it. Returns empty array if no legacy DB. */
const drainLegacyRows = (
  options: DevStoreOptions | undefined
): readonly TrackRow[] => {
  const legacyDb = openLegacyDb(options);
  if (legacyDb === undefined) {
    return [];
  }
  try {
    return readLegacyRows(legacyDb);
  } finally {
    legacyDb.close();
  }
};

const removeLegacyDbFiles = (options: DevStoreOptions | undefined): void => {
  const legacyPath = resolveLegacyPath(options?.rootDir);
  unlinkSync(legacyPath);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${legacyPath}${suffix}`;
    if (existsSync(sidecar)) {
      unlinkSync(sidecar);
    }
  }
};

const migrateLegacyStoreIfPresent = (
  db: Database,
  options: DevStoreOptions | undefined,
  write: (record: Track) => void
): void => {
  if (shouldSkipLegacyMigration(db, options)) {
    return;
  }
  const rows = drainLegacyRows(options);
  if (rows.length === 0) {
    return;
  }
  for (const row of rows) {
    write(rowToRecord(row));
  }
  removeLegacyDbFiles(options);
};

const createReadApi = (db: Database, defaultLimit: number): TrackStore => ({
  close: () => {
    db.close();
  },
  count: () => countTrackRecords(db),
  query: (queryOptions?: DevStoreQueryOptions): readonly Track[] => {
    const { sql, params } = buildQuery(defaultLimit, queryOptions);
    const rows = db.query<TrackRow, SQLQueryBindings[]>(sql).all(...params);
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
  ensureTrackSchema(db);
  const insertStmt = db.prepare(UPSERT_SQL);
  const write = createWriter(db, insertStmt, maxRecords, maxAge);
  migrateLegacyStoreIfPresent(db, options, write);
  return { ...createReadApi(db, maxRecords), write };
};

/**
 * Read-only view of a TrackStore.
 *
 * `close()` is a no-op — consumers of this view (e.g. the tracker provision)
 * must not close the underlying connection they don't own.
 */
export const toTrackStore = (store: TrackStore): TrackStore => ({
  close: () => {
    // Intentional no-op: read-only view must not close the underlying DB.
  },
  count: () => store.count(),
  query: (options?: DevStoreQueryOptions) => store.query(options),
});
