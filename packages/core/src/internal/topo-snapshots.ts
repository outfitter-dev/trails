import type { Database, SQLQueryBindings } from 'bun:sqlite';

import { ensureSubsystemSchema } from './trails-db.js';

const TOPO_SUBSYSTEM = 'topo';
const TOPO_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS topo_snapshots (
    id TEXT PRIMARY KEY,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL DEFAULT 0,
    trail_count INTEGER NOT NULL DEFAULT 0,
    signal_count INTEGER NOT NULL DEFAULT 0,
    resource_count INTEGER NOT NULL DEFAULT 0,
    pinned_as TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trails (
    id TEXT NOT NULL,
    intent TEXT,
    idempotent INTEGER NOT NULL DEFAULT 0,
    has_output INTEGER NOT NULL DEFAULT 0,
    has_examples INTEGER NOT NULL DEFAULT 0,
    example_count INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    pattern TEXT,
    meta TEXT,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_crossings (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_resources (
    trail_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, resource_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_resources (
    id TEXT NOT NULL,
    has_mock INTEGER NOT NULL DEFAULT 0,
    has_health INTEGER NOT NULL DEFAULT 0,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_signals (
    id TEXT NOT NULL,
    description TEXT,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_signals (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_surfaces (
    trail_id TEXT NOT NULL,
    surface TEXT NOT NULL,
    derived_name TEXT NOT NULL,
    method TEXT,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, surface, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_examples (
    id TEXT PRIMARY KEY,
    trail_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    input TEXT NOT NULL,
    expected TEXT,
    error TEXT,
    snapshot_id TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_schemas (
    owner_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    schema_kind TEXT NOT NULL,
    zod_hash TEXT NOT NULL,
    json_schema TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (owner_id, owner_kind, schema_kind, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_exports (
    snapshot_id TEXT PRIMARY KEY,
    surface_map TEXT NOT NULL,
    surface_hash TEXT NOT NULL,
    serialized_lock TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_fires (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_on (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, snapshot_id),
    FOREIGN KEY (snapshot_id) REFERENCES topo_snapshots(id) ON DELETE CASCADE
  )`,
] as const;
const TOPO_INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_topo_snapshots_created_at ON topo_snapshots(created_at DESC)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_topo_snapshots_pinned_as
   ON topo_snapshots(pinned_as) WHERE pinned_as IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS idx_topo_trails_snapshot_id ON topo_trails(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_crossings_snapshot_id ON topo_crossings(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_resources_snapshot_id ON topo_trail_resources(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_resources_snapshot_id ON topo_resources(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_signals_snapshot_id ON topo_signals(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_signals_snapshot_id ON topo_trail_signals(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_surfaces_snapshot_id ON topo_surfaces(snapshot_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_topo_examples_snapshot_trail_ordinal ON topo_examples(snapshot_id, trail_id, ordinal)',
  'CREATE INDEX IF NOT EXISTS idx_topo_schemas_snapshot_id ON topo_schemas(snapshot_id)',
  `CREATE INDEX IF NOT EXISTS idx_topo_schemas_lookup
   ON topo_schemas(owner_id, owner_kind, schema_kind, zod_hash)`,
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_fires_snapshot_id ON topo_trail_fires(snapshot_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_on_snapshot_id ON topo_trail_on(snapshot_id)',
] as const;
interface TopoSnapshotRow {
  readonly created_at: string;
  readonly git_dirty: number;
  readonly git_sha: string | null;
  readonly id: string;
  readonly pinned_as: string | null;
  readonly resource_count: number;
  readonly signal_count: number;
  readonly trail_count: number;
}

export interface TopoSnapshot {
  readonly createdAt: string;
  readonly gitDirty: boolean;
  readonly gitSha?: string;
  readonly id: string;
  readonly pinnedAs?: string;
  readonly resourceCount: number;
  readonly signalCount: number;
  readonly trailCount: number;
}

export interface CreateTopoSnapshotInput {
  readonly createdAt?: string;
  readonly gitDirty?: boolean;
  readonly gitSha?: string;
  readonly id?: string;
  readonly resourceCount?: number;
  readonly signalCount?: number;
  readonly trailCount?: number;
}

export interface ListTopoSnapshotsOptions {
  readonly before?: string;
  readonly limit?: number;
  readonly pinned?: boolean;
}

const rowToSnapshot = (row: TopoSnapshotRow): TopoSnapshot => ({
  createdAt: row.created_at,
  gitDirty: row.git_dirty === 1,
  id: row.id,
  resourceCount: row.resource_count,
  signalCount: row.signal_count,
  trailCount: row.trail_count,
  ...(row.git_sha === null ? {} : { gitSha: row.git_sha }),
  ...(row.pinned_as === null ? {} : { pinnedAs: row.pinned_as }),
});

const tableExists = (db: Database, tableName: string): boolean => {
  const row = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(tableName);
  return row?.name === tableName;
};

const runStatements = (db: Database, statements: readonly string[]): void => {
  for (const statement of statements) {
    db.run(statement);
  }
};

const createAllTopoTables = (db: Database): void => {
  runStatements(db, TOPO_TABLE_STATEMENTS);
  runStatements(db, TOPO_INDEX_STATEMENTS);
};

/**
 * Current topo subsystem schema version.
 *
 * Version 8 adds `pattern TEXT` column to `topo_trails`.
 *
 * Version 7 defined the snapshot-first topo tables (`topo_snapshots`,
 * `topo_surfaces`, and `snapshot_id` foreign keys) as the only supported
 * schema. Older pre-release tables are ignored in place; we create the current
 * tables and advance the subsystem version without translating or deleting
 * legacy rows.
 */
export const TOPO_SCHEMA_VERSION = 8;

export const ensureTopoSnapshotSchema = (db: Database): void => {
  ensureSubsystemSchema(db, {
    migrate: (currentVersion) => {
      createAllTopoTables(db);
      if (currentVersion === 7) {
        db.run('ALTER TABLE topo_trails ADD COLUMN pattern TEXT');
      }
    },
    subsystem: TOPO_SUBSYSTEM,
    version: TOPO_SCHEMA_VERSION,
  });
};

export const insertTopoSnapshotRecord = (
  db: Database,
  input?: CreateTopoSnapshotInput
): TopoSnapshot => {
  const record: TopoSnapshot = {
    createdAt: input?.createdAt ?? new Date().toISOString(),
    gitDirty: input?.gitDirty ?? false,
    id: input?.id ?? Bun.randomUUIDv7(),
    resourceCount: input?.resourceCount ?? 0,
    signalCount: input?.signalCount ?? 0,
    trailCount: input?.trailCount ?? 0,
    ...(input?.gitSha === undefined ? {} : { gitSha: input.gitSha }),
  };

  db.run(
    `INSERT INTO topo_snapshots (
      id, git_sha, git_dirty, trail_count, signal_count, resource_count, pinned_as, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.gitSha ?? null,
      record.gitDirty ? 1 : 0,
      record.trailCount,
      record.signalCount,
      record.resourceCount,
      null,
      record.createdAt,
    ]
  );

  return record;
};

const normalizeLimit = (limit?: number): number | undefined => {
  if (limit === undefined) {
    return undefined;
  }
  return Math.max(0, Math.trunc(limit));
};

export const readTopoSnapshot = (
  db: Database,
  id: string
): TopoSnapshot | undefined => {
  if (!tableExists(db, 'topo_snapshots')) {
    return undefined;
  }
  const row = db
    .query<TopoSnapshotRow, [string]>(
      `SELECT id, git_sha, git_dirty, trail_count, signal_count, resource_count, pinned_as, created_at
       FROM topo_snapshots
       WHERE id = ?`
    )
    .get(id);
  return row === null || row === undefined ? undefined : rowToSnapshot(row);
};

export const readPinnedTopoSnapshot = (
  db: Database,
  name: string
): TopoSnapshot | undefined => {
  if (!tableExists(db, 'topo_snapshots')) {
    return undefined;
  }
  const row = db
    .query<TopoSnapshotRow, [string]>(
      `SELECT id, git_sha, git_dirty, trail_count, signal_count, resource_count, pinned_as, created_at
       FROM topo_snapshots
       WHERE pinned_as = ?
       LIMIT 1`
    )
    .get(name);
  return row === null || row === undefined ? undefined : rowToSnapshot(row);
};

const applyBeforeSnapshotClause = (
  db: Database,
  beforeId: string | undefined,
  bindings: SQLQueryBindings[],
  conditions: string[]
): boolean => {
  if (beforeId === undefined) {
    return true;
  }

  const before = readTopoSnapshot(db, beforeId);
  if (before === undefined) {
    return false;
  }

  conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
  bindings.push(before.createdAt, before.createdAt, before.id);
  return true;
};

const applyPinnedSnapshotClause = (
  pinned: boolean | undefined,
  conditions: string[]
): void => {
  if (pinned === true) {
    conditions.push('pinned_as IS NOT NULL');
    return;
  }

  if (pinned === false) {
    conditions.push('pinned_as IS NULL');
  }
};

const buildSnapshotWhereClause = (conditions: readonly string[]): string =>
  conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`;

const buildSnapshotLimitClause = (
  limit: number | undefined,
  bindings: SQLQueryBindings[]
): string => {
  if (limit === undefined) {
    return '';
  }

  bindings.push(limit);
  return ' LIMIT ?';
};

const listSnapshotRows = (
  db: Database,
  options?: ListTopoSnapshotsOptions
): readonly TopoSnapshotRow[] => {
  if (!tableExists(db, 'topo_snapshots')) {
    return [];
  }

  const bindings: SQLQueryBindings[] = [];
  const conditions: string[] = [];
  if (!applyBeforeSnapshotClause(db, options?.before, bindings, conditions)) {
    return [];
  }

  applyPinnedSnapshotClause(options?.pinned, conditions);
  const whereClause = buildSnapshotWhereClause(conditions);
  const limitClause = buildSnapshotLimitClause(
    normalizeLimit(options?.limit),
    bindings
  );

  return db
    .query<TopoSnapshotRow, SQLQueryBindings[]>(
      `SELECT id, git_sha, git_dirty, trail_count, signal_count, resource_count, pinned_as, created_at
       FROM topo_snapshots${whereClause}
       ORDER BY created_at DESC, id DESC${limitClause}`
    )
    .all(...bindings);
};

export const listTopoSnapshots = (
  db: Database,
  options?: ListTopoSnapshotsOptions
): readonly TopoSnapshot[] => listSnapshotRows(db, options).map(rowToSnapshot);

const countSnapshots = (db: Database, whereClause?: string): number => {
  const query =
    whereClause === undefined
      ? 'SELECT COUNT(*) as count FROM topo_snapshots'
      : `SELECT COUNT(*) as count FROM topo_snapshots WHERE ${whereClause}`;
  const row = db.query<{ count: number }, []>(query).get();
  return row?.count ?? 0;
};

export const countTopoSnapshots = (db: Database): number => {
  if (!tableExists(db, 'topo_snapshots')) {
    return 0;
  }
  return countSnapshots(db);
};

export const countPinnedSnapshots = (db: Database): number => {
  if (!tableExists(db, 'topo_snapshots')) {
    return 0;
  }
  return countSnapshots(db, 'pinned_as IS NOT NULL');
};

export const countPrunableSnapshots = (
  db: Database,
  options: { readonly keep: number }
): number => {
  if (!tableExists(db, 'topo_snapshots')) {
    return 0;
  }
  const row = db
    .query<{ count: number }, [number]>(
      `SELECT COUNT(*) as count
       FROM (
         SELECT id
         FROM topo_snapshots
         WHERE pinned_as IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .get(options.keep);
  return row?.count ?? 0;
};

export const createTopoSnapshot = (
  db: Database,
  input?: CreateTopoSnapshotInput
): TopoSnapshot => {
  ensureTopoSnapshotSchema(db);
  return insertTopoSnapshotRecord(db, input);
};

export const pinTopoSnapshot = (
  db: Database,
  input: { readonly id: string; readonly name: string }
): TopoSnapshot | undefined => {
  ensureTopoSnapshotSchema(db);

  return db.transaction(() => {
    const snapshot = readTopoSnapshot(db, input.id);
    if (snapshot === undefined) {
      return;
    }

    db.run('UPDATE topo_snapshots SET pinned_as = NULL WHERE pinned_as = ?', [
      input.name,
    ]);
    db.run('UPDATE topo_snapshots SET pinned_as = ? WHERE id = ?', [
      input.name,
      input.id,
    ]);

    return readTopoSnapshot(db, input.id);
  })();
};

export const unpinTopoSnapshot = (
  db: Database,
  nameOrId: string
): TopoSnapshot | undefined => {
  ensureTopoSnapshotSchema(db);

  return db.transaction(() => {
    const snapshot =
      readPinnedTopoSnapshot(db, nameOrId) ?? readTopoSnapshot(db, nameOrId);
    if (snapshot?.pinnedAs === undefined) {
      return;
    }

    db.run('UPDATE topo_snapshots SET pinned_as = NULL WHERE id = ?', [
      snapshot.id,
    ]);

    return readTopoSnapshot(db, snapshot.id);
  })();
};

export const pruneUnpinnedSnapshots = (
  db: Database,
  options: { readonly keep: number }
): number => {
  if (!tableExists(db, 'topo_snapshots')) {
    return 0;
  }
  if (countPrunableSnapshots(db, options) === 0) {
    return 0;
  }

  db.run(
    `DELETE FROM topo_snapshots
     WHERE id IN (
       SELECT id
       FROM topo_snapshots
       WHERE pinned_as IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT -1 OFFSET ?
     )`,
    [options.keep]
  );

  return (
    db.query<{ changes: number }, []>('SELECT changes() as changes').get()
      ?.changes ?? 0
  );
};
