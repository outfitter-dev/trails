import type { Database } from 'bun:sqlite';

import { ensureSubsystemSchema } from './trails-db.js';

const TOPO_SUBSYSTEM = 'topo';

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

export const ensureTopoHistorySchema = (db: Database): void => {
  ensureSubsystemSchema(db, {
    migrate: () => {
      db.run(`CREATE TABLE IF NOT EXISTS topo_saves (
        id TEXT PRIMARY KEY,
        git_sha TEXT,
        git_dirty INTEGER NOT NULL DEFAULT 0,
        trail_count INTEGER NOT NULL DEFAULT 0,
        signal_count INTEGER NOT NULL DEFAULT 0,
        provision_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS topo_pins (
        name TEXT PRIMARY KEY,
        save_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (save_id) REFERENCES topo_saves(id)
      )`);
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_topo_saves_created_at ON topo_saves(created_at DESC)'
      );
      db.run(
        'CREATE INDEX IF NOT EXISTS idx_topo_pins_save_id ON topo_pins(save_id)'
      );
    },
    subsystem: TOPO_SUBSYSTEM,
    version: 1,
  });
};

export const createTopoSave = (
  db: Database,
  input?: CreateTopoSaveInput
): TopoSaveRecord => {
  ensureTopoHistorySchema(db);

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

  const before = countSaves(db);

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
