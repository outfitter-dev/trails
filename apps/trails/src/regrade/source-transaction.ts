import { InternalError, Result, deriveSafePath } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import type { RegradeReport } from '@ontrails/regrade';
import { readFileSync, writeFileSync } from 'node:fs';

export interface RegradeSourceSnapshot {
  readonly absolutePath: string;
  readonly source: Uint8Array;
}

export const snapshotRegradeSources = (params: {
  readonly reports: readonly (RegradeReport | null)[];
  readonly rootDir: string;
}): TrailsResult<readonly RegradeSourceSnapshot[], Error> => {
  const paths = new Set(
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
  const snapshots: RegradeSourceSnapshot[] = [];
  try {
    for (const path of paths) {
      const absolutePath = deriveSafePath(params.rootDir, path);
      if (absolutePath.isErr()) {
        return absolutePath;
      }
      snapshots.push({
        absolutePath: absolutePath.value,
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
  try {
    for (const snapshot of snapshots) {
      writeFileSync(snapshot.absolutePath, snapshot.source);
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
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
