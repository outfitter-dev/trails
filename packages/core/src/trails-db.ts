import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { NotFoundError } from './errors.js';

const TRAILS_DIR = '.trails';
const TRAILS_DB_FILE = 'trails.db';
const TRAILS_CACHE_DIR = 'cache';
const TRAILS_STATE_DIR = 'state';
const SCHEMA_VERSION_TABLE = 'meta_schema_versions';
const SQLITE_BUSY_TIMEOUT_MS = 5000;
const WORKSPACE_SUBDIRS = [TRAILS_CACHE_DIR, TRAILS_STATE_DIR] as const;

/**
 * The canonical lines written to a freshly-bootstrapped
 * `.trails/.gitignore`. Kept as the source of truth for every consumer that
 * needs to either write the file (scaffold) or audit its content (tests).
 *
 * @see {@link WORKSPACE_GITIGNORE_CONTENT} for the rendered string form.
 */
export const WORKSPACE_GITIGNORE_LINES = [
  '# Local config overrides',
  'config.local.js',
  'config.local.ts',
  '',
  '# Rebuildable cache',
  'cache/',
  '',
  '# Mutable runtime state',
  'state/',
  '',
] as const;

/**
 * The canonical rendered `.trails/.gitignore` content. Use this when writing
 * the file eagerly (e.g. during `trails create` scaffolding) or when asserting
 * on the workspace bootstrap output.
 */
export const WORKSPACE_GITIGNORE_CONTENT = `${WORKSPACE_GITIGNORE_LINES.join('\n').trimEnd()}\n`;

export interface TrailsDbLocationOptions {
  readonly path?: string;
  readonly rootDir?: string;
}

export interface EnsureSubsystemSchemaOptions {
  readonly migrate: (currentVersion: number) => void;
  readonly subsystem: string;
  readonly version: number;
}

interface SchemaVersionRow {
  readonly version: number;
}

const deriveRootDir = (rootDir?: string): string =>
  resolve(rootDir ?? process.cwd());

export const deriveTrailsDir = (options?: TrailsDbLocationOptions): string =>
  join(deriveRootDir(options?.rootDir), TRAILS_DIR);

export const deriveTrailsDbPath = (options?: TrailsDbLocationOptions): string =>
  options?.path
    ? resolve(options.path)
    : join(deriveTrailsDir(options), TRAILS_STATE_DIR, TRAILS_DB_FILE);

const ensureDbParentDir = (dbPath: string): void => {
  mkdirSync(dirname(dbPath), { recursive: true });
};

const appendMissingGitignoreLines = (
  gitignorePath: string,
  content: string
): void => {
  const existingLines = new Set(content.split('\n').map((l) => l.trim()));
  const missing = WORKSPACE_GITIGNORE_LINES.filter(
    (line) => line !== '' && !existingLines.has(line)
  );

  if (missing.length === 0) {
    return;
  }

  const next = `${content.trimEnd()}\n\n${missing.join('\n')}`;
  writeFileSync(gitignorePath, `${next.trimEnd()}\n`);
};

const ensureWorkspaceGitignore = (trailsDir: string): void => {
  const gitignorePath = join(trailsDir, '.gitignore');

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, WORKSPACE_GITIGNORE_CONTENT);
    return;
  }

  appendMissingGitignoreLines(
    gitignorePath,
    readFileSync(gitignorePath, 'utf8')
  );
};

/**
 * Bootstrap the `.trails/` workspace at `rootDir`.
 *
 * Creates the workspace directory plus the canonical `cache/` and `state/`
 * subdirectories, then either writes a fresh `.gitignore` matching
 * {@link WORKSPACE_GITIGNORE_CONTENT} or appends any missing canonical lines
 * to an existing one. Safe to call repeatedly. This is the single canonical
 * source of truth for workspace layout — scaffolding, configuration loading,
 * and runtime DB initialization all flow through here.
 */
export const ensureTrailsWorkspace = (rootDir: string): void => {
  const trailsDir = deriveTrailsDir({ rootDir });
  mkdirSync(trailsDir, { recursive: true });
  for (const subdir of WORKSPACE_SUBDIRS) {
    mkdirSync(join(trailsDir, subdir), { recursive: true });
  }
  ensureWorkspaceGitignore(trailsDir);
};

const initializeWritePragmas = (db: Database): void => {
  db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS.toString()}`);
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA foreign_keys = ON');
};

const initializeReadPragmas = (db: Database): void => {
  db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS.toString()}`);
  db.run('PRAGMA foreign_keys = ON');
};

const ensureSchemaVersionTable = (db: Database): void => {
  db.run(`CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
    subsystem TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`);
};

const readSubsystemVersion = (db: Database, subsystem: string): number => {
  const row = db
    .query<SchemaVersionRow, [string]>(
      `SELECT version FROM ${SCHEMA_VERSION_TABLE} WHERE subsystem = ?`
    )
    .get(subsystem);
  return row?.version ?? 0;
};

const writeSubsystemVersion = (
  db: Database,
  subsystem: string,
  version: number
): void => {
  db.run(
    `INSERT INTO ${SCHEMA_VERSION_TABLE} (subsystem, version, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(subsystem) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [subsystem, version, new Date().toISOString()]
  );
};

export const openWriteTrailsDb = (
  options?: TrailsDbLocationOptions
): Database => {
  const rootDir = deriveRootDir(options?.rootDir);
  const dbPath = deriveTrailsDbPath(
    options?.path ? { path: options.path, rootDir } : { rootDir }
  );

  if (options?.path === undefined) {
    ensureTrailsWorkspace(rootDir);
  } else {
    ensureDbParentDir(dbPath);
  }

  const db = new Database(dbPath, { create: true });
  initializeWritePragmas(db);
  ensureSchemaVersionTable(db);
  return db;
};

export const openReadTrailsDb = (
  options?: TrailsDbLocationOptions
): Database => {
  const dbPath = deriveTrailsDbPath(options);
  if (!existsSync(dbPath)) {
    throw new NotFoundError(
      `Trails database not found at "${dbPath}". Run a write operation first to initialize it.`
    );
  }
  const db = new Database(dbPath, { readonly: true });
  initializeReadPragmas(db);
  return db;
};

export const ensureSubsystemSchema = (
  db: Database,
  options: EnsureSubsystemSchemaOptions
): void => {
  ensureSchemaVersionTable(db);

  db.transaction(() => {
    const currentVersion = readSubsystemVersion(db, options.subsystem);
    if (currentVersion >= options.version) {
      return;
    }

    options.migrate(currentVersion);
    writeSubsystemVersion(db, options.subsystem, options.version);
  })();
};
