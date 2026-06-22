import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { NotFoundError } from './errors.js';

const TRAILS_DIR = '.trails';
const TRAILS_DB_FILE = 'trails.db';
const TRAILS_STORE_DIR = 'trails';
const TRAILS_PROJECTS_DIR = 'projects';
const SCHEMA_VERSION_TABLE = 'meta_schema_versions';
const SQLITE_BUSY_TIMEOUT_MS = 5000;
const PROJECT_KEY_HASH_LENGTH = 16;
const PROJECT_KEY_NAME_FALLBACK = 'project';

/**
 * Legacy no-op compatibility export.
 *
 * `.trails/` is committed project control, not disposable cache/state. New
 * code should not write a `.trails/.gitignore`; keep this export available for
 * older callers during the pre-1.0 cutover.
 */
export const WORKSPACE_GITIGNORE_LINES = [] as const;

/**
 * Legacy no-op compatibility export. See {@link WORKSPACE_GITIGNORE_LINES}.
 */
export const WORKSPACE_GITIGNORE_CONTENT = '';

export interface TrailsDbLocationOptions {
  readonly env?: Record<string, string | undefined>;
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

const sanitizeProjectKeyName = (name: string): string => {
  const normalized = name.replaceAll(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized.length > 0 ? normalized : PROJECT_KEY_NAME_FALLBACK;
};

const projectHash = (rootDir: string): string =>
  createHash('sha256')
    .update(rootDir)
    .digest('hex')
    .slice(0, PROJECT_KEY_HASH_LENGTH);

export const deriveTrailsProjectKey = (
  options?: TrailsDbLocationOptions
): string => {
  const rootDir = deriveRootDir(options?.rootDir);
  return `${sanitizeProjectKeyName(basename(rootDir))}-${projectHash(rootDir)}`;
};

export const deriveTrailsStateHome = (
  options?: TrailsDbLocationOptions
): string => {
  const env = options?.env ?? process.env;
  return resolve(
    env['TRAILS_STATE_HOME'] ??
      env['XDG_STATE_HOME'] ??
      join(homedir(), '.local', 'state')
  );
};

export const deriveTrailsStateDir = (
  options?: TrailsDbLocationOptions
): string =>
  join(
    deriveTrailsStateHome(options),
    TRAILS_STORE_DIR,
    TRAILS_PROJECTS_DIR,
    deriveTrailsProjectKey(options)
  );

export const deriveTrailsDir = (options?: TrailsDbLocationOptions): string =>
  join(deriveRootDir(options?.rootDir), TRAILS_DIR);

export const deriveTrailsDbPath = (options?: TrailsDbLocationOptions): string =>
  options?.path
    ? resolve(options.path)
    : join(deriveTrailsStateDir(options), TRAILS_DB_FILE);

const ensureDbParentDir = (dbPath: string): void => {
  mkdirSync(dirname(dbPath), { recursive: true });
};

/**
 * Bootstrap the `.trails/` workspace at `rootDir`.
 *
 * Creates only the committed-control directory. Derived cache and observed
 * state live in the per-user Trails store, so this helper intentionally does
 * not create `.trails/cache`, `.trails/state`, or `.trails/.gitignore`.
 */
export const ensureTrailsWorkspace = (rootDir: string): void => {
  const trailsDir = deriveTrailsDir({ rootDir });
  mkdirSync(trailsDir, { recursive: true });
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
  const locationOptions: TrailsDbLocationOptions = {
    ...(options?.env === undefined ? {} : { env: options.env }),
    ...(options?.path === undefined ? {} : { path: options.path }),
    rootDir,
  };
  const dbPath = deriveTrailsDbPath(locationOptions);

  ensureDbParentDir(dbPath);

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
