import type { Database } from 'bun:sqlite';

import { ensureSubsystemSchema } from './trails-db.js';

const TOPO_SUBSYSTEM = 'topo';
const TOPO_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS topo_saves (
    id TEXT PRIMARY KEY,
    git_sha TEXT,
    git_dirty INTEGER NOT NULL DEFAULT 0,
    trail_count INTEGER NOT NULL DEFAULT 0,
    signal_count INTEGER NOT NULL DEFAULT 0,
    provision_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS topo_pins (
    name TEXT PRIMARY KEY,
    save_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (save_id) REFERENCES topo_saves(id)
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trails (
    id TEXT NOT NULL,
    intent TEXT,
    idempotent INTEGER NOT NULL DEFAULT 0,
    has_output INTEGER NOT NULL DEFAULT 0,
    has_examples INTEGER NOT NULL DEFAULT 0,
    example_count INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    meta TEXT,
    save_id TEXT NOT NULL,
    PRIMARY KEY (id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_crossings (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_provisions (
    trail_id TEXT NOT NULL,
    provision_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, provision_id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_provisions (
    id TEXT NOT NULL,
    has_mock INTEGER NOT NULL DEFAULT 0,
    has_health INTEGER NOT NULL DEFAULT 0,
    save_id TEXT NOT NULL,
    PRIMARY KEY (id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_signals (
    id TEXT NOT NULL,
    description TEXT,
    save_id TEXT NOT NULL,
    PRIMARY KEY (id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_signals (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trailheads (
    trail_id TEXT NOT NULL,
    trailhead TEXT NOT NULL,
    derived_name TEXT NOT NULL,
    method TEXT,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, trailhead, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
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
    save_id TEXT NOT NULL,
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_schemas (
    owner_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL,
    schema_kind TEXT NOT NULL,
    zod_hash TEXT NOT NULL,
    json_schema TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (owner_id, owner_kind, schema_kind, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_exports (
    save_id TEXT PRIMARY KEY,
    trailhead_map TEXT NOT NULL,
    trailhead_hash TEXT NOT NULL,
    serialized_lock TEXT NOT NULL,
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_fires (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS topo_trail_on (
    trail_id TEXT NOT NULL,
    signal_id TEXT NOT NULL,
    save_id TEXT NOT NULL,
    PRIMARY KEY (trail_id, signal_id, save_id),
    FOREIGN KEY (save_id) REFERENCES topo_saves(id) ON DELETE CASCADE
  )`,
] as const;
const TOPO_INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_topo_saves_created_at ON topo_saves(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_topo_pins_save_id ON topo_pins(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trails_save_id ON topo_trails(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_crossings_save_id ON topo_crossings(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_provisions_save_id ON topo_trail_provisions(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_provisions_save_id ON topo_provisions(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_signals_save_id ON topo_signals(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_signals_save_id ON topo_trail_signals(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trailheads_save_id ON topo_trailheads(save_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_topo_examples_save_trail_ordinal ON topo_examples(save_id, trail_id, ordinal)',
  'CREATE INDEX IF NOT EXISTS idx_topo_schemas_save_id ON topo_schemas(save_id)',
  `CREATE INDEX IF NOT EXISTS idx_topo_schemas_lookup
   ON topo_schemas(owner_id, owner_kind, schema_kind, zod_hash)`,
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_fires_save_id ON topo_trail_fires(save_id)',
  'CREATE INDEX IF NOT EXISTS idx_topo_trail_on_save_id ON topo_trail_on(save_id)',
] as const;

interface TopoSaveRow {
  readonly created_at: string;
  readonly git_dirty: number;
  readonly git_sha: string | null;
  readonly id: string;
  readonly provision_count: number;
  readonly signal_count: number;
  readonly trail_count: number;
}

interface TopoPinRow {
  readonly created_at: string;
  readonly name: string;
  readonly save_id: string;
}

export interface TopoSaveRecord {
  readonly createdAt: string;
  readonly gitDirty: boolean;
  readonly gitSha?: string;
  readonly id: string;
  readonly provisionCount: number;
  readonly signalCount: number;
  readonly trailCount: number;
}

export interface CreateTopoSaveInput {
  readonly createdAt?: string;
  readonly gitDirty?: boolean;
  readonly gitSha?: string;
  readonly id?: string;
  readonly provisionCount?: number;
  readonly signalCount?: number;
  readonly trailCount?: number;
}

export interface TopoPinRecord {
  readonly createdAt: string;
  readonly name: string;
  readonly saveId: string;
}

export interface CreateTopoPinInput {
  readonly createdAt?: string;
  readonly name: string;
  readonly saveId: string;
}

const rowToSave = (row: TopoSaveRow): TopoSaveRecord => ({
  createdAt: row.created_at,
  gitDirty: row.git_dirty === 1,
  id: row.id,
  provisionCount: row.provision_count,
  signalCount: row.signal_count,
  trailCount: row.trail_count,
  ...(row.git_sha === null ? {} : { gitSha: row.git_sha }),
});

const rowToPin = (row: TopoPinRow): TopoPinRecord => ({
  createdAt: row.created_at,
  name: row.name,
  saveId: row.save_id,
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

export const ensureTopoHistorySchema = (db: Database): void => {
  ensureSubsystemSchema(db, {
    migrate: (currentVersion) => {
      if (currentVersion < 2) {
        runStatements(db, TOPO_TABLE_STATEMENTS);
        runStatements(db, TOPO_INDEX_STATEMENTS);
      }
      if (currentVersion === 2) {
        // v2→v3: add schema cache and export tables
        runStatements(db, TOPO_TABLE_STATEMENTS.slice(10, 12));
        runStatements(db, TOPO_INDEX_STATEMENTS.slice(10, 12));
      }
      if (currentVersion < 4 && currentVersion >= 2) {
        // v3→v4: add persisted signal edges (fires/on)
        runStatements(db, TOPO_TABLE_STATEMENTS.slice(12));
        runStatements(db, TOPO_INDEX_STATEMENTS.slice(12));
      }
    },
    subsystem: TOPO_SUBSYSTEM,
    version: 4,
  });
};

export const insertTopoSaveRecord = (
  db: Database,
  input?: CreateTopoSaveInput
): TopoSaveRecord => {
  const record: TopoSaveRecord = {
    createdAt: input?.createdAt ?? new Date().toISOString(),
    gitDirty: input?.gitDirty ?? false,
    id: input?.id ?? Bun.randomUUIDv7(),
    provisionCount: input?.provisionCount ?? 0,
    signalCount: input?.signalCount ?? 0,
    trailCount: input?.trailCount ?? 0,
    ...(input?.gitSha === undefined ? {} : { gitSha: input.gitSha }),
  };

  db.run(
    `INSERT INTO topo_saves (
      id, git_sha, git_dirty, trail_count, signal_count, provision_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.gitSha ?? null,
      record.gitDirty ? 1 : 0,
      record.trailCount,
      record.signalCount,
      record.provisionCount,
      record.createdAt,
    ]
  );

  return record;
};

export const createTopoSave = (
  db: Database,
  input?: CreateTopoSaveInput
): TopoSaveRecord => {
  ensureTopoHistorySchema(db);
  return insertTopoSaveRecord(db, input);
};

export const pinTopoSave = (
  db: Database,
  input: CreateTopoPinInput
): TopoPinRecord => {
  ensureTopoHistorySchema(db);

  const record: TopoPinRecord = {
    createdAt: input.createdAt ?? new Date().toISOString(),
    name: input.name,
    saveId: input.saveId,
  };

  db.run(
    `INSERT INTO topo_pins (name, save_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       save_id = excluded.save_id,
       created_at = excluded.created_at`,
    [record.name, record.saveId, record.createdAt]
  );

  return record;
};

export const listTopoSaves = (db: Database): readonly TopoSaveRecord[] => {
  if (!tableExists(db, 'topo_saves')) {
    return [];
  }
  const rows = db
    .query<TopoSaveRow, []>(
      `SELECT id, git_sha, git_dirty, trail_count, signal_count, provision_count, created_at
       FROM topo_saves
       ORDER BY created_at DESC, id DESC`
    )
    .all();
  return rows.map(rowToSave);
};

export const listTopoPins = (db: Database): readonly TopoPinRecord[] => {
  if (!tableExists(db, 'topo_pins')) {
    return [];
  }
  const rows = db
    .query<TopoPinRow, []>(
      `SELECT name, save_id, created_at
       FROM topo_pins
       ORDER BY created_at ASC, name ASC`
    )
    .all();
  return rows.map(rowToPin);
};

const countSaves = (db: Database): number => {
  const row = db
    .query<{ count: number }, []>('SELECT COUNT(*) as count FROM topo_saves')
    .get();
  return row?.count ?? 0;
};

export const countTopoSaves = (db: Database): number => {
  if (!tableExists(db, 'topo_saves')) {
    return 0;
  }
  return countSaves(db);
};

export const countTopoPins = (db: Database): number => {
  if (!tableExists(db, 'topo_pins')) {
    return 0;
  }
  const row = db
    .query<{ count: number }, []>('SELECT COUNT(*) as count FROM topo_pins')
    .get();
  return row?.count ?? 0;
};

export const getTopoSave = (
  db: Database,
  id: string
): TopoSaveRecord | undefined => {
  if (!tableExists(db, 'topo_saves')) {
    return undefined;
  }
  const row = db
    .query<TopoSaveRow, [string]>(
      `SELECT id, git_sha, git_dirty, trail_count, signal_count, provision_count, created_at
       FROM topo_saves
       WHERE id = ?`
    )
    .get(id);
  return row === null || row === undefined ? undefined : rowToSave(row);
};

export const getTopoPin = (
  db: Database,
  name: string
): TopoPinRecord | undefined => {
  if (!tableExists(db, 'topo_pins')) {
    return undefined;
  }
  const row = db
    .query<TopoPinRow, [string]>(
      `SELECT name, save_id, created_at
       FROM topo_pins
       WHERE name = ?`
    )
    .get(name);
  return row === null || row === undefined ? undefined : rowToPin(row);
};

export const countPrunableTopoSaves = (
  db: Database,
  options: { readonly keep: number }
): number => {
  if (!tableExists(db, 'topo_saves') || !tableExists(db, 'topo_pins')) {
    return 0;
  }
  const row = db
    .query<{ count: number }, [number]>(
      `SELECT COUNT(*) as count
       FROM (
         SELECT save.id
         FROM topo_saves save
         LEFT JOIN topo_pins pin ON pin.save_id = save.id
         WHERE pin.save_id IS NULL
         ORDER BY save.created_at DESC, save.id DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .get(options.keep);
  return row?.count ?? 0;
};

export const pruneUnpinnedTopoSaves = (
  db: Database,
  options: { readonly keep: number }
): number => {
  if (!tableExists(db, 'topo_saves') || !tableExists(db, 'topo_pins')) {
    return 0;
  }
  if (countPrunableTopoSaves(db, options) === 0) {
    return 0;
  }

  db.run(
    `DELETE FROM topo_saves
     WHERE id IN (
       SELECT save.id
       FROM topo_saves save
       LEFT JOIN topo_pins pin ON pin.save_id = save.id
       WHERE pin.save_id IS NULL
       ORDER BY save.created_at DESC, save.id DESC
       LIMIT -1 OFFSET ?
     )`,
    [options.keep]
  );

  return (
    db.query<{ changes: number }, []>('SELECT changes() as changes').get()
      ?.changes ?? 0
  );
};

export const unpinTopoSave = (db: Database, name: string): boolean => {
  ensureTopoHistorySchema(db);
  const result = db.run('DELETE FROM topo_pins WHERE name = ?', [name]);
  return result.changes > 0;
};
