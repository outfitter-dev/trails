import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  countPinnedSnapshots,
  countPrunableSnapshots,
  countTopoSnapshots,
  openReadTrailsDb,
  openWriteTrailsDb,
  deriveTrailsDbPath,
  deriveTrailsDir,
  pruneUnpinnedSnapshots,
} from '@ontrails/core';
import {
  DEFAULT_MAX_AGE,
  DEFAULT_MAX_RECORDS,
  applyTraceCleanup,
  countTraceRecords,
  previewTraceCleanup,
} from '@ontrails/tracing';

import { removeRootRelativeFileIfPresent } from '../local-state-io.js';

import { requireTrailRootDir } from './root-dir.js';

export const DEFAULT_TOPO_SNAPSHOT_RETENTION = 50;

const deriveRootDir = (cwd?: string): string => requireTrailRootDir(cwd);

const removeResetFileIfPresent = (
  rootDir: string,
  relativePath: string
): boolean => {
  const removed = removeRootRelativeFileIfPresent(rootDir, relativePath);
  if (removed.isErr()) {
    throw removed.error;
  }
  return removed.value;
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
    readonly snapshots: number;
    readonly traceAgeMs: number;
    readonly traces: number;
  };
  readonly topo: {
    readonly pinnedCount: number;
    readonly prunableSnapshotCount: number;
    readonly snapshotCount: number;
  };
  readonly tracing: {
    readonly recordCount: number;
  };
}

export interface DevCleanReport {
  readonly dryRun: boolean;
  readonly remaining: {
    readonly pinnedCount: number;
    readonly snapshotCount: number;
    readonly traceCount: number;
  };
  readonly removed: {
    readonly topoSnapshots: number;
    readonly traceRecords: number;
  };
  readonly retention: {
    readonly snapshots: number;
    readonly traceAgeMs: number;
    readonly traces: number;
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
  readonly snapshotRetention?: number;
}

interface DevCleanupContext {
  readonly dbPath: string;
  readonly dryRun: boolean;
  readonly retention: DevCleanReport['retention'];
  readonly rootDir: string;
}

const buildRetention = (options?: DevRetentionOptions) => ({
  snapshots: options?.snapshotRetention ?? DEFAULT_TOPO_SNAPSHOT_RETENTION,
  traceAgeMs: options?.maxAge ?? DEFAULT_MAX_AGE,
  traces: options?.maxRecords ?? DEFAULT_MAX_RECORDS,
});

const emptyDevClean = (
  retention: DevCleanReport['retention'],
  dryRun: boolean
): DevCleanReport => ({
  dryRun,
  remaining: {
    pinnedCount: 0,
    snapshotCount: 0,
    traceCount: 0,
  },
  removed: {
    topoSnapshots: 0,
    traceRecords: 0,
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
    pinnedCount: 0,
    prunableSnapshotCount: 0,
    snapshotCount: 0,
  },
  tracing: {
    recordCount: 0,
  },
});

const liveDevStats = (
  db: Parameters<typeof countPinnedSnapshots>[0],
  dbPath: string,
  lockPath: string,
  retention: DevStatsReport['retention']
): DevStatsReport => ({
  db: buildDbStats(dbPath, true),
  lock: buildLockStats(lockPath),
  retention,
  topo: {
    pinnedCount: countPinnedSnapshots(db),
    prunableSnapshotCount: countPrunableSnapshots(db, {
      keep: retention.snapshots,
    }),
    snapshotCount: countTopoSnapshots(db),
  },
  tracing: {
    recordCount: countTraceRecords(db),
  },
});

const deriveDevStatsContext = (options?: DevRetentionOptions) => {
  const rootDir = deriveRootDir(options?.rootDir);
  const dbPath = deriveTrailsDbPath({ rootDir });
  const trailsDir = deriveTrailsDir({ rootDir });
  const lockPath = join(trailsDir, 'trails.lock');
  return {
    dbExists: existsSync(dbPath),
    dbPath,
    lockPath,
    retention: buildRetention(options),
    rootDir,
  };
};

const deriveDevCleanupContext = (
  options?: DevRetentionOptions & { readonly dryRun?: boolean }
): DevCleanupContext => {
  const rootDir = deriveRootDir(options?.rootDir);
  return {
    dbPath: deriveTrailsDbPath({ rootDir }),
    dryRun: options?.dryRun ?? false,
    retention: buildRetention(options),
    rootDir,
  };
};

const cleanupTraces = (
  db: Parameters<typeof countPinnedSnapshots>[0],
  context: DevCleanupContext
) =>
  context.dryRun
    ? previewTraceCleanup(db, {
        maxAge: context.retention.traceAgeMs,
        maxRecords: context.retention.traces,
      })
    : applyTraceCleanup(db, {
        maxAge: context.retention.traceAgeMs,
        maxRecords: context.retention.traces,
      });

const cleanupTopoSnapshots = (
  db: Parameters<typeof countPinnedSnapshots>[0],
  context: DevCleanupContext
): number =>
  context.dryRun
    ? countPrunableSnapshots(db, { keep: context.retention.snapshots })
    : pruneUnpinnedSnapshots(db, { keep: context.retention.snapshots });

const buildCleanReport = (
  db: Parameters<typeof countPinnedSnapshots>[0],
  context: DevCleanupContext
): DevCleanReport => {
  const traceReport = cleanupTraces(db, context);
  const topoRemoved = cleanupTopoSnapshots(db, context);
  const snapshotCount = countTopoSnapshots(db);

  return {
    dryRun: context.dryRun,
    remaining: {
      pinnedCount: countPinnedSnapshots(db),
      snapshotCount: context.dryRun
        ? snapshotCount - topoRemoved
        : snapshotCount,
      traceCount: context.dryRun
        ? traceReport.remaining - traceReport.removedTotal
        : traceReport.remaining,
    },
    removed: {
      topoSnapshots: topoRemoved,
      traceRecords: traceReport.removedTotal,
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
    deriveDevStatsContext(options);

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
  const context = deriveDevCleanupContext(options);
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
  const rootDir = deriveRootDir(options?.rootDir);
  const files = presentResetFiles(rootDir);

  if (options?.dryRun === true) {
    return {
      dryRun: true,
      removedCount: files.length,
      removedFiles: files,
    };
  }

  const removedFiles = files.filter((relativePath) =>
    removeResetFileIfPresent(rootDir, relativePath)
  );

  return {
    dryRun: false,
    removedCount: removedFiles.length,
    removedFiles,
  };
};
