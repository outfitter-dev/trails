import { Database } from 'bun:sqlite';
import type { SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Crumb } from '../record.js';
import type { CrumbSink } from '../crumbs-layer.js';

/** Configuration for the SQLite dev store. */
export interface DevStoreOptions {
  /** Path to the SQLite database file. Defaults to `.trails/dev/crumbs.db`. */
  readonly path?: string;
  /** Maximum number of records to retain. Defaults to 10000. */
  readonly maxRecords?: number;
  /** Maximum age of records in milliseconds. Defaults to 7 days. */
  readonly maxAge?: number;
}

/** Query options for filtering stored crumb records. */
export interface DevStoreQueryOptions {
  readonly trailId?: string;
  readonly traceId?: string;
  readonly errorsOnly?: boolean;
  readonly limit?: number;
}

/** SQLite-backed dev store for persisting and querying crumb records. */
export interface DevStore extends CrumbSink {
  /** Query recent traces with optional filters. */
  readonly query: (options?: DevStoreQueryOptions) => readonly Crumb[];
  /** Return the total number of stored records. */
  readonly count: () => number;
  /** Close the database connection. */
  readonly close: () => void;
}

/** SQL for creating the crumbs table. */
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS crumbs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  trail_id TEXT,
  surface TEXT,
  intent TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  error_category TEXT,
  permit_id TEXT,
  permit_tenant_id TEXT,
  attrs TEXT
)`;

/** Index for common query patterns. */
const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_crumbs_trail_id ON crumbs(trail_id)',
  'CREATE INDEX IF NOT EXISTS idx_crumbs_trace_id ON crumbs(trace_id)',
  'CREATE INDEX IF NOT EXISTS idx_crumbs_status ON crumbs(status)',
  'CREATE INDEX IF NOT EXISTS idx_crumbs_started_at ON crumbs(started_at)',
];

/** Shape of a row returned from the crumbs table. */
interface CrumbRow {
  readonly id: string;
  readonly trace_id: string;
  readonly root_id: string;
  readonly parent_id: string | null;
  readonly kind: string;
  readonly name: string;
  readonly trail_id: string | null;
  readonly surface: string | null;
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
): Crumb['permit'] => {
  if (permitId === null) {
    return undefined;
  }
  return tenantId === null ? { id: permitId } : { id: permitId, tenantId };
};

/** Parse attrs JSON back into a record. */
const parseAttrs = (raw: string | null): Readonly<Record<string, unknown>> =>
  raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

/** Reconstruct a Crumb from a database row. */
const rowToRecord = (row: CrumbRow): Crumb => ({
  attrs: parseAttrs(row.attrs),
  endedAt: row.ended_at ?? undefined,
  errorCategory: row.error_category ?? undefined,
  id: row.id,
  intent: (row.intent ?? undefined) as Crumb['intent'],
  kind: row.kind as Crumb['kind'],
  name: row.name,
  parentId: row.parent_id ?? undefined,
  permit: buildPermit(row.permit_id, row.permit_tenant_id),
  rootId: row.root_id,
  startedAt: row.started_at,
  status: row.status as Crumb['status'],
  surface: (row.surface ?? undefined) as Crumb['surface'],
  traceId: row.trace_id,
  trailId: row.trail_id ?? undefined,
});

/** Initialize the database with pragmas, table, and indexes. */
const initializeDb = (db: Database): void => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run(CREATE_TABLE_SQL);
  for (const sql of CREATE_INDEXES_SQL) {
    db.run(sql);
  }
};

/** Ensure the parent directory for the database file exists. */
const ensureDir = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
};

/** Prune records exceeding the retention limit. */
const pruneByCount = (db: Database, maxRecords: number): void => {
  const countResult = db
    .query<{ count: number }, []>('SELECT COUNT(*) as count FROM crumbs')
    .get();
  const count = countResult?.count ?? 0;

  if (count <= maxRecords) {
    return;
  }

  const excess = count - maxRecords;
  db.run(
    `DELETE FROM crumbs WHERE id IN (
      SELECT id FROM crumbs ORDER BY started_at ASC LIMIT ?
    )`,
    [excess]
  );
};

/** Prune records older than maxAge milliseconds. */
const pruneByAge = (db: Database, maxAge: number): void => {
  const threshold = Date.now() - maxAge;
  db.run('DELETE FROM crumbs WHERE started_at < ?', [threshold]);
};

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
    sql: `SELECT * FROM crumbs ${where} ORDER BY started_at DESC LIMIT ?`,
  };
};

/** Serialize attrs to JSON, returning null for empty objects. */
const serializeAttrs = (
  attrs: Readonly<Record<string, unknown>>
): string | null =>
  Object.keys(attrs).length > 0 ? JSON.stringify(attrs) : null;

/** Serialize a Crumb into positional INSERT parameters. */
const recordToParams = (record: Crumb): SQLQueryBindings[] => [
  record.id,
  record.traceId,
  record.rootId,
  record.parentId ?? null,
  record.kind,
  record.name,
  record.trailId ?? null,
  record.surface ?? null,
  record.intent ?? null,
  record.startedAt,
  record.endedAt ?? null,
  record.status,
  record.errorCategory ?? null,
  record.permit?.id ?? null,
  record.permit?.tenantId ?? null,
  serializeAttrs(record.attrs),
];

/** SQL for inserting a crumb record. */
const UPSERT_SQL = `INSERT INTO crumbs (
  id, trace_id, root_id, parent_id,
  kind, name, trail_id, surface,
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
  surface = excluded.surface,
  intent = excluded.intent,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  status = excluded.status,
  error_category = excluded.error_category,
  permit_id = excluded.permit_id,
  permit_tenant_id = excluded.permit_tenant_id,
  attrs = excluded.attrs`;

/** Open and initialize the database at the given path. */
const openDb = (dbPath: string): Database => {
  ensureDir(dbPath);
  const db = new Database(dbPath, { create: true });
  initializeDb(db);
  return db;
};

/** Count stored crumb records. */
const countRecords = (db: Database): number => {
  const result = db
    .query<{ count: number }, []>('SELECT COUNT(*) as count FROM crumbs')
    .get();
  return result?.count ?? 0;
};

/** Create a transactional writer that keeps retention pruning atomic. */
const createWriter = (
  db: Database,
  insertStmt: ReturnType<Database['prepare']>,
  maxRecords: number,
  maxAge: number | undefined
): ((record: Crumb) => void) =>
  db.transaction((record: Crumb) => {
    insertStmt.run(...recordToParams(record));
    pruneByCount(db, maxRecords);
    if (maxAge !== undefined) {
      pruneByAge(db, maxAge);
    }
  });

/**
 * Create a SQLite-backed dev store for persisting crumb records.
 *
 * Uses WAL mode and normal synchronous for good write performance.
 * Automatically prunes records exceeding `maxRecords` on each write.
 */
export const createDevStore = (options?: DevStoreOptions): DevStore => {
  const dbPath = options?.path ?? '.trails/dev/crumbs.db';
  const maxRecords = options?.maxRecords ?? 10_000;
  const maxAge = options?.maxAge;
  const db = openDb(dbPath);
  const insertStmt = db.prepare(UPSERT_SQL);
  const write = createWriter(db, insertStmt, maxRecords, maxAge);

  const query = (queryOptions?: DevStoreQueryOptions): readonly Crumb[] => {
    const { sql, params } = buildQuery(maxRecords, queryOptions);
    const rows = db.query<CrumbRow, SQLQueryBindings[]>(sql).all(...params);
    return rows.map(rowToRecord);
  };

  const count = (): number => countRecords(db);

  const close = (): void => {
    db.close();
  };

  return { close, count, query, write };
};
