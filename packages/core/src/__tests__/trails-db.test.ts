import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureSubsystemSchema,
  ensureTrailsWorkspace,
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
  WORKSPACE_GITIGNORE_CONTENT,
} from '../trails-db.js';

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
    expect(existsSync(join(rootDir, '.trails', 'cache'))).toBe(true);
    expect(existsSync(join(rootDir, '.trails', 'state'))).toBe(true);
  };

  test('deriveTrailsDbPath places the database in .trails/state/trails.db', () => {
    const rootDir = '/tmp/example-app';
    expect(deriveTrailsDbPath({ rootDir })).toBe(
      '/tmp/example-app/.trails/state/trails.db'
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

  describe('ensureTrailsWorkspace', () => {
    test('creates the canonical cache/state subdirectories', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      expectWorkspaceLayout(rootDir);
    });

    test('writes the canonical gitignore content on first run', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      const content = readFileSync(
        join(rootDir, '.trails', '.gitignore'),
        'utf8'
      );
      expect(content).toBe(WORKSPACE_GITIGNORE_CONTENT);
    });

    test('appends missing canonical lines to an existing gitignore', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      const gitignorePath = join(rootDir, '.trails', '.gitignore');

      // Simulate a user who removed two canonical lines and added their own.
      writeFileSync(gitignorePath, '# custom rule\n*.local\n');
      ensureTrailsWorkspace(rootDir);

      const content = readFileSync(gitignorePath, 'utf8');
      expect(content).toContain('# custom rule');
      expect(content).toContain('*.local');
      expect(content).toContain('config.local.ts');
      expect(content).toContain('cache/');
      expect(content).toContain('state/');
    });

    test('leaves an up-to-date gitignore untouched on repeat runs', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      const first = readFileSync(
        join(rootDir, '.trails', '.gitignore'),
        'utf8'
      );
      ensureTrailsWorkspace(rootDir);
      const second = readFileSync(
        join(rootDir, '.trails', '.gitignore'),
        'utf8'
      );
      expect(second).toBe(first);
    });
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
