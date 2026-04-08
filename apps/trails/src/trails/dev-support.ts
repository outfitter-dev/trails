import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  countPrunableTopoSaves,
  countTopoPins,
  countTopoSaves,
  pruneUnpinnedTopoSaves,
} from '@ontrails/core/internal/topo-saves';
import {
  openReadTrailsDb,
  openWriteTrailsDb,
  resolveTrailsDbPath,
  resolveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  applyTraceCleanup,
  countTraceRecords,
  previewTraceCleanup,
} from '@ontrails/tracing/internal/dev-state';

import { resolveLockPath } from './topo-support.js';

export const DEFAULT_TOPO_SAVE_RETENTION = 50;

const resolveRootDir = (cwd?: string): string => cwd ?? process.cwd();

const removeIfPresent = (filePath: string): boolean => {
  if (!existsSync(filePath)) {
    return false;
  }
  rmSync(filePath, { force: true });
  return true;
};

export interface DevStatsReport {
  readonly db: {
    readonly exists: boolean;
    readonly fileSizeBytes: number;
    readonly path: string;
  };
  readonly lock: {
    readonly exists: boolean;
    readonly fileSizeBytes: number;
    readonly path: string;
  };
  readonly retention: {
    readonly saves: number;
    readonly trackAgeMs: number;
    readonly tracks: number;
  };
  readonly topo: {
    readonly pinCount: number;
    readonly prunableSaveCount: number;
    readonly saveCount: number;
  };
  readonly tracing: {
    readonly recordCount: number;
  };
}

export interface DevCleanReport {
  readonly dryRun: boolean;
  readonly remaining: {
    readonly pinCount: number;
    readonly saveCount: number;
    readonly trackCount: number;
  };
  readonly removed: {
    readonly topoSaves: number;
    readonly trackRecords: number;
  };
  readonly retention: {
    readonly saves: number;
    readonly trackAgeMs: number;
    readonly tracks: number;
  };
}

export interface DevResetReport {
  readonly dryRun: boolean;
  readonly removedCount: number;
  readonly removedFiles: readonly string[];
}

interface DevRetentionOptions {
  readonly maxAge?: number;
  readonly maxRecords?: number;
  readonly rootDir?: string;
  readonly saveRetention?: number;
}

interface DevCleanupContext {
  readonly dbPath: string;
  readonly dryRun: boolean;
  readonly retention: DevCleanReport['retention'];
  readonly rootDir: string;
}

const buildRetention = (options?: DevRetentionOptions) => ({
  saves: options?.saveRetention ?? DEFAULT_TOPO_SAVE_RETENTION,
  trackAgeMs: options?.maxAge ?? DEFAULT_MAX_AGE,
  tracks: options?.maxRecords ?? DEFAULT_MAX_RECORDS,
});

const emptyDevClean = (
  retention: DevCleanReport['retention'],
  dryRun: boolean
): DevCleanReport => ({
  dryRun,
  remaining: {
    pinCount: 0,
    saveCount: 0,
    trackCount: 0,
  },
  removed: {
    topoSaves: 0,
    trackRecords: 0,
  },
  retention,
});

const buildLockStats = (lockPath: string): DevStatsReport['lock'] => ({
  exists: existsSync(lockPath),
  fileSizeBytes: existsSync(lockPath) ? statSync(lockPath).size : 0,
  path: lockPath,
});

const buildDbStats = (
  dbPath: string,
  exists: boolean
): DevStatsReport['db'] => ({
  exists,
  fileSizeBytes: exists ? statSync(dbPath).size : 0,
  path: '.trails/trails.db',
});

const emptyDevStats = (
  dbPath: string,
  lockPath: string,
  retention: DevStatsReport['retention']
): DevStatsReport => ({
  db: buildDbStats(dbPath, false),
  lock: buildLockStats(lockPath),
  retention,
  topo: {
    pinCount: 0,
    prunableSaveCount: 0,
    saveCount: 0,
  },
  tracing: {
    recordCount: 0,
  },
});

const liveDevStats = (
  db: Parameters<typeof countTopoPins>[0],
  dbPath: string,
  lockPath: string,
  retention: DevStatsReport['retention']
): DevStatsReport => ({
  db: buildDbStats(dbPath, true),
  lock: buildLockStats(lockPath),
  retention,
  topo: {
    pinCount: countTopoPins(db),
    prunableSaveCount: countPrunableTopoSaves(db, { keep: retention.saves }),
    saveCount: countTopoSaves(db),
  },
  tracing: {
    recordCount: countTraceRecords(db),
  },
});

const resolveDevStatsContext = (options?: DevRetentionOptions) => {
  const rootDir = resolveRootDir(options?.rootDir);
  const dbPath = resolveTrailsDbPath({ rootDir });
  const trailsDir = resolveTrailsDir({ rootDir });
  const lockPath = resolveLockPath(trailsDir);
  return {
    dbExists: existsSync(dbPath),
    dbPath,
    lockPath,
    retention: buildRetention(options),
    rootDir,
  };
};

const resolveDevCleanupContext = (
  options?: DevRetentionOptions & { readonly dryRun?: boolean }
): DevCleanupContext => {
  const rootDir = resolveRootDir(options?.rootDir);
  return {
    dbPath: resolveTrailsDbPath({ rootDir }),
    dryRun: options?.dryRun ?? false,
    retention: buildRetention(options),
    rootDir,
  };
};

const cleanupTracks = (
  db: Parameters<typeof countTopoPins>[0],
  context: DevCleanupContext
) =>
  context.dryRun
    ? previewTraceCleanup(db, {
        maxAge: context.retention.trackAgeMs,
        maxRecords: context.retention.tracks,
      })
    : applyTraceCleanup(db, {
        maxAge: context.retention.trackAgeMs,
        maxRecords: context.retention.tracks,
      });

const cleanupTopoSaves = (
  db: Parameters<typeof countTopoPins>[0],
  context: DevCleanupContext
): number =>
  context.dryRun
    ? countPrunableTopoSaves(db, { keep: context.retention.saves })
    : pruneUnpinnedTopoSaves(db, { keep: context.retention.saves });

const buildCleanReport = (
  db: Parameters<typeof countTopoPins>[0],
  context: DevCleanupContext
): DevCleanReport => {
  const trackReport = cleanupTracks(db, context);
  const topoRemoved = cleanupTopoSaves(db, context);
  const saveCount = countTopoSaves(db);

  return {
    dryRun: context.dryRun,
    remaining: {
      pinCount: countTopoPins(db),
      saveCount: context.dryRun ? saveCount - topoRemoved : saveCount,
      trackCount: context.dryRun
        ? trackReport.remaining - trackReport.removedTotal
        : trackReport.remaining,
    },
    removed: {
      topoSaves: topoRemoved,
      trackRecords: trackReport.removedTotal,
    },
    retention: context.retention,
  };
};

const RESET_FILES = [
  '.trails/trails.db',
  '.trails/trails.db-shm',
  '.trails/trails.db-wal',
  '.trails/dev/tracing.db',
  '.trails/dev/tracing.db-shm',
  '.trails/dev/tracing.db-wal',
] as const;

const presentResetFiles = (
  rootDir: string
): readonly (typeof RESET_FILES)[number][] =>
  RESET_FILES.filter((relativePath) => existsSync(join(rootDir, relativePath)));

export const buildDevStats = (
  options?: DevRetentionOptions
): DevStatsReport => {
  const { dbExists, dbPath, lockPath, retention, rootDir } =
    resolveDevStatsContext(options);

  if (!dbExists) {
    return emptyDevStats(dbPath, lockPath, retention);
  }

  const db = openReadTrailsDb({ rootDir });

  try {
    return liveDevStats(db, dbPath, lockPath, retention);
  } finally {
    db.close();
  }
};

export const cleanDevState = (
  options?: DevRetentionOptions & { readonly dryRun?: boolean }
): DevCleanReport => {
  const context = resolveDevCleanupContext(options);
  if (!existsSync(context.dbPath)) {
    return emptyDevClean(context.retention, context.dryRun);
  }

  const db = context.dryRun
    ? openReadTrailsDb({ rootDir: context.rootDir })
    : openWriteTrailsDb({ rootDir: context.rootDir });

  try {
    return buildCleanReport(db, context);
  } finally {
    db.close();
  }
};

export const resetDevState = (options?: {
  readonly dryRun?: boolean;
  readonly rootDir?: string;
}): DevResetReport => {
  const rootDir = resolveRootDir(options?.rootDir);
  const files = presentResetFiles(rootDir);

  if (options?.dryRun === true) {
    return {
      dryRun: true,
      removedCount: files.length,
      removedFiles: files,
    };
  }

  const removedFiles = files.filter((relativePath) =>
    removeIfPresent(join(rootDir, relativePath))
  );

  return {
    dryRun: false,
    removedCount: removedFiles.length,
    removedFiles,
  };
};
