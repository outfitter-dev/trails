import type { Database } from 'bun:sqlite';

import {
  ensureSubsystemSchema,
  openWriteTrailsDb,
} from '@ontrails/core/internal/trails-db';

import type { DevStoreOptions } from '../stores/dev.js';

export const DEFAULT_MAX_RECORDS = 10_000;
export const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const TRACK_SUBSYSTEM = 'track';
export const TRACK_TABLE = 'track_records';

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${TRACK_TABLE} (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  trail_id TEXT,
  trailhead TEXT,
  intent TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  error_category TEXT,
  permit_id TEXT,
  permit_tenant_id TEXT,
  attrs TEXT
)`;

const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_${TRACK_TABLE}_trail_id ON ${TRACK_TABLE}(trail_id)`,
  `CREATE INDEX IF NOT EXISTS idx_${TRACK_TABLE}_trace_id ON ${TRACK_TABLE}(trace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_${TRACK_TABLE}_status ON ${TRACK_TABLE}(status)`,
  `CREATE INDEX IF NOT EXISTS idx_${TRACK_TABLE}_started_at ON ${TRACK_TABLE}(started_at)`,
];

export interface TraceCleanupReport {
  readonly removedByAge: number;
  readonly removedByCount: number;
  readonly removedTotal: number;
  readonly remaining: number;
}

const traceTableExists = (db: Database): boolean => {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(TRACK_TABLE);
  return row?.name === TRACK_TABLE;
};

export const ensureTraceSchema = (db: Database): void => {
  ensureSubsystemSchema(db, {
    migrate: () => {
      db.run(CREATE_TABLE_SQL);
      for (const sql of CREATE_INDEXES_SQL) {
        db.run(sql);
      }
    },
    subsystem: TRACK_SUBSYSTEM,
    version: 1,
  });
};

export const countTraceRecords = (db: Database): number => {
  if (!traceTableExists(db)) {
    return 0;
  }
  const result = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM ${TRACK_TABLE}`
    )
    .get();
  return result?.count ?? 0;
};

const countOldTracks = (db: Database, maxAge: number): number => {
  if (!traceTableExists(db)) {
    return 0;
  }
  const threshold = Date.now() - maxAge;
  const row = db
    .query<{ count: number }, [number]>(
      `SELECT COUNT(*) as count FROM ${TRACK_TABLE} WHERE started_at < ?`
    )
    .get(threshold);
  return row?.count ?? 0;
};

const countOverflowTracks = (
  db: Database,
  maxRecords: number,
  maxAge: number
): number => {
  const total = countTraceRecords(db);
  const remainingAfterAge = total - countOldTracks(db, maxAge);
  return Math.max(remainingAfterAge - maxRecords, 0);
};

const deleteOldTracks = (db: Database, maxAge: number): number => {
  const threshold = Date.now() - maxAge;
  const result = db.run(`DELETE FROM ${TRACK_TABLE} WHERE started_at < ?`, [
    threshold,
  ]);
  return result.changes;
};

const deleteOverflowTracks = (db: Database, maxRecords: number): number => {
  const excess = Math.max(countTraceRecords(db) - maxRecords, 0);
  if (excess === 0) {
    return 0;
  }

  const result = db.run(
    `DELETE FROM ${TRACK_TABLE} WHERE id IN (
      SELECT id FROM ${TRACK_TABLE} ORDER BY started_at ASC LIMIT ?
    )`,
    [excess]
  );
  return result.changes;
};

const toCleanupReport = (
  db: Database,
  removedByAge: number,
  removedByCount: number
): TraceCleanupReport => ({
  remaining: countTraceRecords(db),
  removedByAge,
  removedByCount,
  removedTotal: removedByAge + removedByCount,
});

export const previewTraceCleanup = (
  db: Database,
  options?: Pick<DevStoreOptions, 'maxAge' | 'maxRecords'>
): TraceCleanupReport => {
  const maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxAge = options?.maxAge ?? DEFAULT_MAX_AGE;
  const removedByAge = countOldTracks(db, maxAge);
  const removedByCount = countOverflowTracks(db, maxRecords, maxAge);
  return toCleanupReport(db, removedByAge, removedByCount);
};

export const applyTraceCleanup = (
  db: Database,
  options?: Pick<DevStoreOptions, 'maxAge' | 'maxRecords'>
): TraceCleanupReport => {
  if (!traceTableExists(db)) {
    return toCleanupReport(db, 0, 0);
  }
  const maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxAge = options?.maxAge ?? DEFAULT_MAX_AGE;
  const removedByAge = deleteOldTracks(db, maxAge);
  const removedByCount = deleteOverflowTracks(db, maxRecords);
  return toCleanupReport(db, removedByAge, removedByCount);
};

export const withTraceStoreDb = <T>(
  options: Pick<DevStoreOptions, 'path' | 'rootDir'> | undefined,
  run: (db: Database) => T
): T => {
  const db = openWriteTrailsDb({
    ...(options?.path === undefined ? {} : { path: options.path }),
    ...(options?.rootDir === undefined ? {} : { rootDir: options.rootDir }),
  });

  try {
    ensureTraceSchema(db);
    return run(db);
  } finally {
    db.close();
  }
};
