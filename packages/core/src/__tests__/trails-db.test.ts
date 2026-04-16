import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureSubsystemSchema,
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
} from '../internal/trails-db.js';
import {
  createTopoSnapshot,
  ensureTopoSnapshotSchema,
  listTopoSnapshots,
  pinTopoSnapshot,
  pruneUnpinnedSnapshots,
} from '../internal/topo-snapshots.js';

describe('trails db foundation', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'trails-db-'));
    return tmpRoot;
  };

  const expectWorkspaceLayout = (rootDir: string): void => {
    expect(existsSync(join(rootDir, '.trails', '.gitignore'))).toBe(true);
    expect(existsSync(join(rootDir, '.trails', 'config'))).toBe(true);
    expect(existsSync(join(rootDir, '.trails', 'dev'))).toBe(true);
    expect(existsSync(join(rootDir, '.trails', 'generated'))).toBe(true);
  };

  test('deriveTrailsDbPath places the database in .trails/trails.db', () => {
    const rootDir = '/tmp/example-app';
    expect(deriveTrailsDbPath({ rootDir })).toBe(
      '/tmp/example-app/.trails/trails.db'
    );
  });

  test('openWriteTrailsDb creates the database with WAL and NORMAL defaults', () => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });

    try {
      expect(existsSync(deriveTrailsDbPath({ rootDir }))).toBe(true);
      expectWorkspaceLayout(rootDir);

      const journal = db
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
        .get();
      const synchronous = db
        .query<{ synchronous: number }, []>('PRAGMA synchronous')
        .get();

      expect(journal?.journal_mode.toLowerCase()).toBe('wal');
      expect(synchronous?.synchronous).toBe(1);
    } finally {
      db.close();
    }
  });

  test('openReadTrailsDb blocks writes at the SQLite connection level', () => {
    const rootDir = makeRoot();
    const writer = openWriteTrailsDb({ rootDir });
    writer.close();

    const reader = openReadTrailsDb({ rootDir });

    try {
      expect(() => reader.run('CREATE TABLE readonly_probe (id TEXT)')).toThrow(
        /readonly|read-only/i
      );
    } finally {
      reader.close();
    }
  });

  test('ensureSubsystemSchema only migrates when the subsystem version changes', () => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });
    let calls = 0;

    try {
      ensureSubsystemSchema(db, {
        migrate: () => {
          calls += 1;
          db.run(
            'CREATE TABLE IF NOT EXISTS track_records (id TEXT PRIMARY KEY)'
          );
        },
        subsystem: 'track',
        version: 1,
      });

      ensureSubsystemSchema(db, {
        migrate: () => {
          calls += 1;
        },
        subsystem: 'track',
        version: 1,
      });

      ensureSubsystemSchema(db, {
        migrate: (currentVersion) => {
          calls += 1;
          expect(currentVersion).toBe(1);
          db.run('ALTER TABLE track_records ADD COLUMN status TEXT');
        },
        subsystem: 'track',
        version: 2,
      });

      expect(calls).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('topo snapshot primitives', () => {
  let tmpRoot: string | undefined;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { force: true, recursive: true });
      tmpRoot = undefined;
    }
  });

  const makeRoot = (): string => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'topo-snapshots-'));
    return tmpRoot;
  };

  const seedHistory = (db: ReturnType<typeof openWriteTrailsDb>) => {
    ensureTopoSnapshotSchema(db);

    const pinned = createTopoSnapshot(db, {
      createdAt: '2026-04-01T00:00:00.000Z',
      gitDirty: false,
      gitSha: 'abc123',
      resourceCount: 2,
      signalCount: 1,
      trailCount: 3,
    });
    const disposable = createTopoSnapshot(db, {
      createdAt: '2026-04-02T00:00:00.000Z',
      gitDirty: true,
      gitSha: 'def456',
      resourceCount: 3,
      signalCount: 2,
      trailCount: 4,
    });

    return {
      disposable,
      pinned,
      pinnedSnapshot: pinTopoSnapshot(db, {
        id: pinned.id,
        name: 'before-auth',
      }),
    };
  };

  test('creates snapshots, pins them, and prunes only unpinned history', () => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({ rootDir });

    try {
      const { disposable, pinned, pinnedSnapshot } = seedHistory(db);

      expect(pinnedSnapshot?.pinnedAs).toBe('before-auth');
      expect(
        listTopoSnapshots(db, { pinned: true }).map((snapshot) => snapshot.id)
      ).toEqual([pinned.id]);
      expect(listTopoSnapshots(db).map((snapshot) => snapshot.id)).toEqual([
        disposable.id,
        pinned.id,
      ]);

      expect(pruneUnpinnedSnapshots(db, { keep: 0 })).toBe(1);
      expect(listTopoSnapshots(db).map((snapshot) => snapshot.id)).toEqual([
        pinned.id,
      ]);
    } finally {
      db.close();
    }
  });
});
