import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Topo } from '@ontrails/core';
import { ConflictError, NotFoundError, Result } from '@ontrails/core';
import type {
  TopoPinRecord,
  TopoSaveRecord,
} from '@ontrails/core/internal/topo-saves';
import {
  createTopoSave,
  getTopoPin,
  listTopoPins,
  listTopoSaves,
  pinTopoSave,
  unpinTopoSave,
} from '@ontrails/core/internal/topo-saves';
import {
  openReadTrailsDb,
  openWriteTrailsDb,
  resolveTrailsDbPath,
  resolveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import {
  generateTrailheadMap,
  hashTrailheadMap,
  readTrailheadLock,
  writeTrailheadLock,
  writeTrailheadMap,
} from '@ontrails/schema';
import { z } from 'zod';

import type { BriefReport, SurveyListReport } from './topo-reports.js';
import { generateBriefReport, generateSurveyList } from './topo-reports.js';

/** Output schema for a topo save record. Shared across topo trails. */
export const topoSaveOutput = z.object({
  createdAt: z.string(),
  gitDirty: z.boolean(),
  gitSha: z.string().optional(),
  id: z.string(),
  provisionCount: z.number(),
  signalCount: z.number(),
  trailCount: z.number(),
});

/** Output schema for a topo pin record. Shared across topo trails. */
export const topoPinOutput = z.object({
  createdAt: z.string(),
  name: z.string(),
  saveId: z.string(),
});

export const DEFAULT_APP_MODULE = './src/app.ts';
export const DEFAULT_TOPO_HISTORY_LIMIT = 10;
export const LOCK_PATH = '.trails/trails.lock';
export const LEGACY_LOCK_PATH = '.trails/trailhead.lock';

/** Resolve the lockfile path, preferring the current name with legacy fallback. */
export const resolveLockPath = (trailsDir: string): string => {
  const primary = join(trailsDir, 'trails.lock');
  if (existsSync(primary)) {
    return primary;
  }
  const legacy = join(trailsDir, 'trailhead.lock');
  return existsSync(legacy) ? legacy : primary;
};
const EXAMPLE_APP_MODULE = fileURLToPath(new URL('../app.ts', import.meta.url));

export interface TopoSummaryReport {
  readonly app: BriefReport;
  readonly dbPath: string;
  readonly list: SurveyListReport;
  readonly lockExists: boolean;
  readonly lockPath: string;
}

export interface TopoHistoryReport {
  readonly dbPath: string;
  readonly limit: number;
  readonly pinCount: number;
  readonly pins: TopoPinRecord[];
  readonly saveCount: number;
  readonly saves: TopoSaveRecord[];
}

export interface TopoExportReport {
  readonly hash: string;
  readonly lockPath: string;
  readonly mapPath: string;
  readonly save: TopoSaveRecord;
}

export interface TopoVerifyReport {
  readonly committedHash: string;
  readonly currentHash: string;
  readonly lockPath: string;
  readonly stale: false;
}

const resolveRootDir = (cwd?: string): string => cwd ?? process.cwd();

const safeGit = (cwd: string, args: readonly string[]): string | undefined => {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stderr: 'ignore',
    stdout: 'pipe',
  });
  if (!proc.success) {
    return undefined;
  }
  const text = Buffer.from(proc.stdout).toString('utf8').trim();
  return text.length === 0 ? undefined : text;
};

const currentGitState = (
  rootDir: string
): { readonly gitDirty: boolean; readonly gitSha?: string } => {
  const gitSha = safeGit(rootDir, ['rev-parse', 'HEAD']);
  const status = safeGit(rootDir, ['status', '--porcelain']);
  return {
    gitDirty: (status?.length ?? 0) > 0,
    ...(gitSha === undefined ? {} : { gitSha }),
  };
};

const topoCounts = (
  app: Topo
): Pick<TopoSaveRecord, 'provisionCount' | 'signalCount' | 'trailCount'> => ({
  provisionCount: app.provisions.size,
  signalCount: app.signals.size,
  trailCount: app.trails.size,
});

const emptyTopoHistory = (
  dbPath: string,
  limit: number
): TopoHistoryReport => ({
  dbPath,
  limit,
  pinCount: 0,
  pins: [],
  saveCount: 0,
  saves: [],
});

const collectedTopoHistory = (
  dbPath: string,
  limit: number,
  pins: readonly TopoPinRecord[],
  allSaves: readonly TopoSaveRecord[]
): TopoHistoryReport => ({
  dbPath,
  limit,
  pinCount: pins.length,
  pins: [...pins],
  saveCount: allSaves.length,
  saves: allSaves.slice(0, limit),
});

const removeTopoPinWithDb = (
  input: { readonly dryRun: boolean; readonly name: string },
  pin: TopoPinRecord,
  db: Parameters<typeof unpinTopoSave>[0]
): {
  readonly dryRun: boolean;
  readonly pin?: TopoPinRecord;
  readonly removed: boolean;
} =>
  input.dryRun
    ? { dryRun: true, pin, removed: false }
    : { dryRun: false, pin, removed: unpinTopoSave(db, input.name) };

export const isolatedExampleInput = (
  name: string
): { readonly module: string; readonly rootDir: string } => {
  const rootDir = join(tmpdir(), 'ontrails-trails-examples', name);
  rmSync(rootDir, { force: true, recursive: true });
  mkdirSync(rootDir, { recursive: true });
  return {
    module: EXAMPLE_APP_MODULE,
    rootDir,
  };
};

export const buildTopoSummary = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSummaryReport => {
  const rootDir = resolveRootDir(options?.rootDir);
  const trailsDir = resolveTrailsDir({ rootDir });
  return {
    app: generateBriefReport(app),
    dbPath: resolveTrailsDbPath({ rootDir }),
    list: generateSurveyList(app),
    lockExists:
      existsSync(join(trailsDir, 'trails.lock')) ||
      existsSync(join(trailsDir, 'trailhead.lock')),
    lockPath: resolveLockPath(trailsDir),
  };
};

export const createCurrentTopoSave = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSaveRecord => {
  const rootDir = resolveRootDir(options?.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    return createTopoSave(db, {
      ...currentGitState(rootDir),
      ...topoCounts(app),
    });
  } finally {
    db.close();
  }
};

export const listTopoHistory = (options?: {
  readonly limit?: number;
  readonly rootDir?: string;
}): TopoHistoryReport => {
  const rootDir = resolveRootDir(options?.rootDir);
  const limit = options?.limit ?? DEFAULT_TOPO_HISTORY_LIMIT;
  const dbPath = resolveTrailsDbPath({ rootDir });
  if (!existsSync(dbPath)) {
    return emptyTopoHistory(dbPath, limit);
  }
  const db = openReadTrailsDb({ rootDir });

  try {
    return collectedTopoHistory(
      dbPath,
      limit,
      listTopoPins(db),
      listTopoSaves(db)
    );
  } finally {
    db.close();
  }
};

export const pinCurrentTopo = (
  app: Topo,
  input: { readonly name: string; readonly rootDir?: string }
): { readonly pin: TopoPinRecord; readonly save: TopoSaveRecord } => {
  const rootDir = resolveRootDir(input.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    const save = createTopoSave(db, {
      ...currentGitState(rootDir),
      ...topoCounts(app),
    });
    const pin = pinTopoSave(db, { name: input.name, saveId: save.id });
    return { pin, save };
  } finally {
    db.close();
  }
};

export const removeTopoPin = (input: {
  readonly dryRun: boolean;
  readonly name: string;
  readonly rootDir?: string;
}): {
  readonly dryRun: boolean;
  readonly pin?: TopoPinRecord;
  readonly removed: boolean;
} => {
  const rootDir = resolveRootDir(input.rootDir);
  if (!existsSync(resolveTrailsDbPath({ rootDir }))) {
    return { dryRun: input.dryRun, removed: false };
  }
  const db = openWriteTrailsDb({ rootDir });

  try {
    const pin = getTopoPin(db, input.name);
    if (pin === undefined) {
      return { dryRun: input.dryRun, removed: false };
    }
    return removeTopoPinWithDb(input, pin, db);
  } finally {
    db.close();
  }
};

export const exportCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoExportReport, Error>> => {
  const rootDir = resolveRootDir(options?.rootDir);
  const trailsDir = resolveTrailsDir({ rootDir });
  const save = createCurrentTopoSave(app, { rootDir });
  const trailheadMap = generateTrailheadMap(app);
  const mapPath = await writeTrailheadMap(trailheadMap, { dir: trailsDir });
  const hash = hashTrailheadMap(trailheadMap);
  const lockPath = await writeTrailheadLock(hash, { dir: trailsDir });

  return Result.ok({
    hash,
    lockPath,
    mapPath,
    save,
  });
};

export const verifyCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoVerifyReport, Error>> => {
  const rootDir = resolveRootDir(options?.rootDir);
  const trailsDir = resolveTrailsDir({ rootDir });
  const trailheadMap = generateTrailheadMap(app);
  const currentHash = hashTrailheadMap(trailheadMap);
  const committedHash = await readTrailheadLock({ dir: trailsDir });

  if (committedHash === null) {
    return Result.err(
      new NotFoundError(
        'No committed trails.lock found. Run `trails topo export` first.'
      )
    );
  }

  if (committedHash !== currentHash) {
    return Result.err(
      new ConflictError(
        'trails.lock is stale. Run `trails topo export` to refresh it.'
      )
    );
  }

  return Result.ok({
    committedHash,
    currentHash,
    lockPath: resolveLockPath(trailsDir),
    stale: false,
  });
};

export const lockfileStats = (options?: {
  readonly rootDir?: string;
}): {
  readonly exists: boolean;
  readonly fileSizeBytes: number;
  readonly path: string;
} => {
  const rootDir = resolveRootDir(options?.rootDir);
  const filePath = join(resolveTrailsDir({ rootDir }), 'trails.lock');
  return {
    exists: existsSync(filePath),
    fileSizeBytes: existsSync(filePath) ? statSync(filePath).size : 0,
    path: LOCK_PATH,
  };
};
