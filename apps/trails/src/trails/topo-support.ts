import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createTopoSnapshot as persistTopoSnapshot,
  deriveTrailsDbPath,
  listTopoSnapshots as readTopoSnapshots,
  pinTopoSnapshot,
  unpinTopoSnapshot,
} from '@ontrails/core';
import type { Topo, TopoSnapshot } from '@ontrails/core';
import { z } from 'zod';

import {
  createIsolatedExampleRoot,
  writeIsolatedExampleAppModule,
} from '../local-state-io.js';

import { requireTrailRootDir } from './root-dir.js';
import type { BriefReport, SurveyListReport } from './topo-reports.js';

/** Output schema for a topo snapshot record. Shared across topo trails. */
export const topoSnapshotOutput = z.object({
  createdAt: z.string(),
  gitDirty: z.boolean(),
  gitSha: z.string().optional(),
  id: z.string(),
  pinnedAs: z.string().optional(),
  resourceCount: z.number(),
  signalCount: z.number(),
  trailCount: z.number(),
});

export const DEFAULT_APP_MODULE = './src/app.ts';
export const DEFAULT_TOPO_HISTORY_LIMIT = 10;
export const LOCK_PATH = '.trails/trails.lock';
const EXAMPLE_APP_MODULE = fileURLToPath(new URL('../app.ts', import.meta.url));

const uniqueExampleRootName = (name: string): string =>
  `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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
  readonly pinnedCount: number;
  readonly snapshotCount: number;
  readonly snapshots: TopoSnapshot[];
}

export interface TopoExportReport {
  readonly hash: string;
  readonly lockPath: string;
  readonly mapPath: string;
  readonly snapshot: TopoSnapshot;
}

export interface TopoVerifyReport {
  readonly committedHash: string;
  readonly currentHash: string;
  readonly lockPath: string;
  readonly stale: false;
}

export const deriveRootDir = (cwd?: string): string => requireTrailRootDir(cwd);

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
): Pick<TopoSnapshot, 'resourceCount' | 'signalCount' | 'trailCount'> => ({
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
  pinnedCount: 0,
  snapshotCount: 0,
  snapshots: [],
});

const collectTopoHistory = (
  dbPath: string,
  limit: number,
  snapshots: readonly TopoSnapshot[]
): TopoHistoryReport => ({
  dbPath,
  limit,
  pinnedCount: snapshots.filter((snapshot) => snapshot.pinnedAs !== undefined)
    .length,
  snapshotCount: snapshots.length,
  snapshots: snapshots.slice(0, limit),
});

const buildSnapshotInput = (
  app: Topo,
  rootDir: string
): {
  readonly gitDirty: boolean;
  readonly gitSha?: string;
  readonly resourceCount: number;
  readonly signalCount: number;
  readonly trailCount: number;
} => ({
  ...readGitState(rootDir),
  ...deriveTopoCounts(app),
});

export const createIsolatedExampleInput = (
  name: string
): { readonly module: string; readonly rootDir: string } => {
  const rootDir = createIsolatedExampleRoot(uniqueExampleRootName(name));
  return {
    module: writeIsolatedExampleAppModule(rootDir, EXAMPLE_APP_MODULE),
    rootDir,
  };
};

export const createCurrentTopoSnapshot = (
  app: Topo,
  options?: { readonly rootDir?: string }
): TopoSnapshot => {
  const rootDir = deriveRootDir(options?.rootDir);
  const result = persistTopoSnapshot(app, {
    rootDir,
    ...buildSnapshotInput(app, rootDir),
  });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
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

  return collectTopoHistory(dbPath, limit, readTopoSnapshots({ rootDir }));
};

export const pinCurrentTopoSnapshot = (
  app: Topo,
  input: { readonly name: string; readonly rootDir?: string }
): { readonly snapshot: TopoSnapshot } => {
  const rootDir = deriveRootDir(input.rootDir);
  const created = persistTopoSnapshot(app, {
    rootDir,
    ...buildSnapshotInput(app, rootDir),
  });
  if (created.isErr()) {
    throw created.error;
  }

  const snapshot = pinTopoSnapshot(created.value.id, input.name, {
    rootDir,
  });
  if (snapshot === undefined) {
    throw new Error(`Missing topo snapshot "${created.value.id}" to pin`);
  }

  return { snapshot };
};

export const removePinnedTopoSnapshot = (input: {
  readonly dryRun: boolean;
  readonly name: string;
  readonly rootDir?: string;
}): {
  readonly dryRun: boolean;
  readonly removed: boolean;
  readonly snapshot?: TopoSnapshot;
} => {
  const rootDir = deriveRootDir(input.rootDir);
  if (!existsSync(deriveTrailsDbPath({ rootDir }))) {
    return { dryRun: input.dryRun, removed: false };
  }

  if (input.dryRun) {
    const snapshot = readTopoSnapshots({ pinned: true, rootDir }).find(
      (candidate) => candidate.pinnedAs === input.name
    );
    return snapshot === undefined
      ? { dryRun: true, removed: false }
      : { dryRun: true, removed: false, snapshot };
  }

  const snapshot = unpinTopoSnapshot(input.name, { rootDir });
  return {
    dryRun: false,
    removed: snapshot !== undefined,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
};
