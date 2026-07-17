import {
  InternalError,
  Result,
  ValidationError,
  deriveSafePath,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import type { RegradeReport } from '@ontrails/regrade';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface RegradeSourceSnapshot {
  readonly absolutePath: string;
  readonly mode: number | null;
  readonly path: string;
  readonly source: Uint8Array | null;
}

const inspectRegradeMutationPath = (params: {
  readonly absolutePath: string;
  readonly path: string;
  readonly rootDir: string;
}): TrailsResult<Stats | null, Error> => {
  const root = resolve(params.rootDir);
  const segments = relative(root, params.absolutePath)
    .split(sep)
    .filter(Boolean);
  let currentPath = root;
  let leafStats: Stats | null = null;
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      leafStats = lstatSync(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return Result.ok(null);
      }
      return Result.err(
        new InternalError(
          'Failed to inspect a Regrade mutation path before apply.',
          {
            ...(error instanceof Error ? { cause: error } : {}),
            context: { path: params.path },
          }
        )
      );
    }
    if (leafStats.isSymbolicLink()) {
      return Result.err(
        new ValidationError(
          'Regrade apply cannot transactionally mutate through symbolic links.',
          { context: { path: params.path } }
        )
      );
    }
  }
  return Result.ok(leafStats);
};

export const snapshotRegradeSources = (params: {
  readonly optionalPaths?: readonly string[] | undefined;
  readonly reports: readonly (RegradeReport | null)[];
  readonly rootDir: string;
}): TrailsResult<readonly RegradeSourceSnapshot[], Error> => {
  const requiredPaths = new Set(
    params.reports.flatMap(
      (report) =>
        report?.entries
          .filter(
            (entry) =>
              entry.outcome === 'rewrite' || entry.outcome === 'needs-review'
          )
          .map((entry) => entry.path) ?? []
    )
  );
  const paths = new Map([...requiredPaths].map((path) => [path, false]));
  for (const path of params.optionalPaths ?? []) {
    if (!paths.has(path)) {
      paths.set(path, true);
    }
  }
  const snapshots: RegradeSourceSnapshot[] = [];
  try {
    for (const [path, optional] of paths) {
      const absolutePath = deriveSafePath(params.rootDir, path);
      if (absolutePath.isErr()) {
        return absolutePath;
      }
      const inspected = inspectRegradeMutationPath({
        absolutePath: absolutePath.value,
        path,
        rootDir: params.rootDir,
      });
      if (inspected.isErr()) {
        return inspected;
      }
      const stats = inspected.value;
      if (optional && stats === null) {
        snapshots.push({
          absolutePath: absolutePath.value,
          mode: null,
          path,
          source: null,
        });
        continue;
      }
      if (stats === null) {
        return Result.err(
          new InternalError(
            'Failed to snapshot a missing Regrade source before apply.',
            { context: { path } }
          )
        );
      }
      snapshots.push({
        absolutePath: absolutePath.value,
        mode: stats.mode % 0o1_0000,
        path,
        source: readFileSync(absolutePath.value),
      });
    }
  } catch (error) {
    return Result.err(
      new InternalError(
        'Failed to snapshot Regrade sources before apply.',
        error instanceof Error ? { cause: error } : {}
      )
    );
  }
  return Result.ok(snapshots);
};

const rollbackRegradeSources = (
  snapshots: readonly RegradeSourceSnapshot[]
): Error | null => {
  const failures: { readonly message: string; readonly path: string }[] = [];
  for (const snapshot of snapshots) {
    try {
      if (snapshot.source === null) {
        rmSync(snapshot.absolutePath, { force: true });
      } else {
        mkdirSync(dirname(snapshot.absolutePath), { recursive: true });
        writeFileSync(snapshot.absolutePath, snapshot.source);
        if (snapshot.mode !== null) {
          chmodSync(snapshot.absolutePath, snapshot.mode);
        }
      }
    } catch (error) {
      failures.push({
        message:
          (error as NodeJS.ErrnoException).code ??
          (error instanceof Error ? error.name : 'Unknown rollback failure'),
        path: snapshot.path,
      });
    }
  }
  return failures.length === 0
    ? null
    : new Error(
        `Failed to restore Regrade sources: ${JSON.stringify(failures)}`
      );
};

export const regradeApplyErrorAfterRollback = (
  error: Error,
  snapshots: readonly RegradeSourceSnapshot[]
): TrailsResult<never, Error> => {
  const rollbackError = rollbackRegradeSources(snapshots);
  return rollbackError === null
    ? Result.err(error)
    : Result.err(
        new InternalError('Regrade apply failed and source rollback failed.', {
          cause: error,
          context: { rollbackError: rollbackError.message },
        })
      );
};
