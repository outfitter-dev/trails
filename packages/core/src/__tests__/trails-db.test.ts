import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveTrailsProjectKey,
  ensureSubsystemSchema,
  ensureTrailsWorkspace,
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
  deriveTrailsStateDir,
  deriveTrailsStateHome,
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

  const expectNoDisposableWorkspaceLayout = (rootDir: string): void => {
    expect(existsSync(join(rootDir, '.trails', '.gitignore'))).toBe(false);
    expect(existsSync(join(rootDir, '.trails', 'cache'))).toBe(false);
    expect(existsSync(join(rootDir, '.trails', 'state'))).toBe(false);
  };

  test('deriveTrailsDbPath places the database in the XDG state store', () => {
    const rootDir = '/tmp/example-app';
    const env = { XDG_STATE_HOME: '/tmp/trails-state' };
    const projectKey = deriveTrailsProjectKey({ rootDir });

    expect(projectKey).toMatch(/^example-app-[a-f0-9]{16}$/);
    expect(deriveTrailsStateHome({ env, rootDir })).toBe('/tmp/trails-state');
    expect(deriveTrailsStateDir({ env, rootDir })).toBe(
      `/tmp/trails-state/trails/projects/${projectKey}`
    );
    expect(deriveTrailsDbPath({ env, rootDir })).toBe(
      `/tmp/trails-state/trails/projects/${projectKey}/trails.db`
    );
  });

  test('TRAILS_STATE_HOME overrides XDG_STATE_HOME', () => {
    expect(
      deriveTrailsStateHome({
        env: {
          TRAILS_STATE_HOME: '/tmp/trails-explicit-state',
          XDG_STATE_HOME: '/tmp/xdg-state',
        },
        rootDir: '/tmp/example-app',
      })
    ).toBe('/tmp/trails-explicit-state');
  });

  test('deriveTrailsDbPath preserves explicit path overrides', () => {
    expect(
      deriveTrailsDbPath({
        env: { XDG_STATE_HOME: '/tmp/ignored-state' },
        path: '/tmp/custom/trails.db',
        rootDir: '/tmp/example-app',
      })
    ).toBe('/tmp/custom/trails.db');
  });

  test('openWriteTrailsDb creates the database with WAL and NORMAL defaults', () => {
    const rootDir = makeRoot();
    const stateHome = join(rootDir, 'state-home');
    const db = openWriteTrailsDb({
      env: { XDG_STATE_HOME: stateHome },
      rootDir,
    });

    try {
      expect(
        existsSync(
          deriveTrailsDbPath({ env: { XDG_STATE_HOME: stateHome }, rootDir })
        )
      ).toBe(true);
      expectNoDisposableWorkspaceLayout(rootDir);

      const journal = db
        .query<{ journal_mode: string }, []>('PRAGMA journal_mode')
        .get();
      const synchronous = db
        .query<{ synchronous: number }, []>('PRAGMA synchronous')
        .get();
      const busyTimeout = db
        .query<{ timeout: number }, []>('PRAGMA busy_timeout')
        .get();

      expect(journal?.journal_mode.toLowerCase()).toBe('wal');
      expect(synchronous?.synchronous).toBe(1);
      expect(busyTimeout?.timeout).toBe(5000);
    } finally {
      db.close();
    }
  });

  test('openReadTrailsDb blocks writes at the SQLite connection level', () => {
    const rootDir = makeRoot();
    const env = { XDG_STATE_HOME: join(rootDir, 'state-home') };
    const writer = openWriteTrailsDb({ env, rootDir });
    writer.close();

    const reader = openReadTrailsDb({ env, rootDir });

    try {
      const busyTimeout = reader
        .query<{ timeout: number }, []>('PRAGMA busy_timeout')
        .get();
      expect(busyTimeout?.timeout).toBe(5000);
      expect(() => reader.run('CREATE TABLE readonly_probe (id TEXT)')).toThrow(
        /readonly|read-only/i
      );
    } finally {
      reader.close();
    }
  });

  describe('ensureTrailsWorkspace', () => {
    test('creates only the committed-control directory', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      expect(existsSync(join(rootDir, '.trails'))).toBe(true);
      expectNoDisposableWorkspaceLayout(rootDir);
    });

    test('is idempotent without writing a workspace gitignore', () => {
      const rootDir = makeRoot();
      ensureTrailsWorkspace(rootDir);
      ensureTrailsWorkspace(rootDir);
      expect(existsSync(join(rootDir, '.trails'))).toBe(true);
      expectNoDisposableWorkspaceLayout(rootDir);
    });

    test('keeps legacy gitignore compatibility content empty', () => {
      expect(WORKSPACE_GITIGNORE_CONTENT).toBe('');
    });
  });

  test('ensureSubsystemSchema only migrates when the subsystem version changes', () => {
    const rootDir = makeRoot();
    const db = openWriteTrailsDb({
      env: { XDG_STATE_HOME: join(rootDir, 'state-home') },
      rootDir,
    });
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
