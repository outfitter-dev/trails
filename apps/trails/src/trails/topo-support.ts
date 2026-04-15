import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Topo } from '@ontrails/core';
import type {
  TopoPinRecord,
  TopoSaveRecord,
} from '@ontrails/core/internal/topo-saves';
import {
  getTopoPin,
  listTopoPins,
  listTopoSaves,
  pinTopoSave,
  unpinTopoSave,
} from '@ontrails/core/internal/topo-saves';
import { persistEstablishedTopoSave } from '@ontrails/core/internal/topo-store';
import {
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
} from '@ontrails/core/internal/trails-db';
import { z } from 'zod';

import type { BriefReport, SurveyListReport } from './topo-reports.js';

/** Output schema for a topo save record. Shared across topo trails. */
export const topoSaveOutput = z.object({
  createdAt: z.string(),
  gitDirty: z.boolean(),
  gitSha: z.string().optional(),
  id: z.string(),
  resourceCount: z.number(),
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

export const deriveRootDir = (cwd?: string): string => cwd ?? process.cwd();

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

export const readGitState = (
  rootDir: string
): { readonly gitDirty: boolean; readonly gitSha?: string } => {
  const gitSha = safeGit(rootDir, ['rev-parse', 'HEAD']);
  const status = safeGit(rootDir, ['status', '--porcelain']);
  return {
    gitDirty: (status?.length ?? 0) > 0,
    ...(gitSha === undefined ? {} : { gitSha }),
  };
};

export const deriveTopoCounts = (
  app: Topo
): Pick<TopoSaveRecord, 'resourceCount' | 'signalCount' | 'trailCount'> => ({
  resourceCount: app.resources.size,
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

export const createIsolatedExampleInput = (
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

export const createCurrentTopoSave = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSaveRecord => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    const result = persistEstablishedTopoSave(db, app, {
      ...readGitState(rootDir),
      ...deriveTopoCounts(app),
    });
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  } finally {
    db.close();
  }
};

export const listTopoHistory = (options?: {
  readonly limit?: number;
  readonly rootDir?: string;
}): TopoHistoryReport => {
  const rootDir = deriveRootDir(options?.rootDir);
  const limit = options?.limit ?? DEFAULT_TOPO_HISTORY_LIMIT;
  const dbPath = deriveTrailsDbPath({ rootDir });
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
  const rootDir = deriveRootDir(input.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    const result = persistEstablishedTopoSave(db, app, {
      ...readGitState(rootDir),
      ...deriveTopoCounts(app),
    });
    if (result.isErr()) {
      throw result.error;
    }
    const pin = pinTopoSave(db, {
      name: input.name,
      saveId: result.value.id,
    });
    return { pin, save: result.value };
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
  const rootDir = deriveRootDir(input.rootDir);
  if (!existsSync(deriveTrailsDbPath({ rootDir }))) {
    return { dryRun: input.dryRun, removed: false };
  }
  const db = input.dryRun
    ? openReadTrailsDb({ rootDir })
    : openWriteTrailsDb({ rootDir });

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
