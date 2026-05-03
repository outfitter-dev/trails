/**
 * Stored-export pipeline for topo persistence.
 *
 * Extracted from topo-support.ts to isolate store persistence concerns,
 * keeping module boundaries clean.
 */

import { Database } from 'bun:sqlite';

import type { StoredTopoExport, Topo, TopoSnapshot } from '@ontrails/core';
import {
  createStoredTopoSnapshot,
  deriveTrailsDir,
  getStoredTopoExport,
  InternalError,
  openWriteTrailsDb,
  Result,
} from '@ontrails/core';
import type { SurfaceLock, SurfaceMap } from '@ontrails/topographer';
import { writeSurfaceLock, writeSurfaceMap } from '@ontrails/topographer';

import type { TopoExportReport } from './topo-support.js';
import {
  deriveRootDir,
  deriveTopoCounts,
  readGitState,
} from './topo-support.js';

const persistAndReadStoredExport = (
  app: Topo,
  db: ReturnType<typeof openWriteTrailsDb>,
  rootDir: string
): Result<
  { snapshot: TopoSnapshot; storedExport: StoredTopoExport },
  Error
> => {
  const snapshotResult = createStoredTopoSnapshot(db, app, {
    ...readGitState(rootDir),
    ...deriveTopoCounts(app),
  });
  if (snapshotResult.isErr()) {
    return snapshotResult;
  }

  const snapshot = snapshotResult.value;
  const storedExport = getStoredTopoExport(db, snapshot.id);

  if (storedExport === undefined) {
    return Result.err(
      new InternalError(
        `Missing stored topo export for snapshot "${snapshot.id}"`
      )
    );
  }

  return Result.ok({
    snapshot,
    storedExport,
  });
};

export const deriveCurrentTopoExport = (
  app: Topo,
  options?: { readonly rootDir?: string }
): Result<StoredTopoExport, Error> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = new Database(':memory:');

  try {
    const projected = persistAndReadStoredExport(app, db, rootDir);
    return projected.isErr()
      ? projected
      : Result.ok(projected.value.storedExport);
  } finally {
    db.close();
  }
};

const writeStoredExportArtifacts = async (
  storedExport: StoredTopoExport,
  trailsDir: string
): Promise<Pick<TopoExportReport, 'hash' | 'lockPath' | 'mapPath'>> => {
  const mapPath = await writeSurfaceMap(
    JSON.parse(storedExport.surfaceMapJson) as SurfaceMap,
    { dir: trailsDir }
  );
  const lockPath = await writeSurfaceLock(
    JSON.parse(storedExport.lockContent) as SurfaceLock,
    { dir: trailsDir }
  );

  return {
    hash: storedExport.surfaceHash,
    lockPath,
    mapPath,
  };
};

export const exportCurrentTopo = async (
  app: Topo,
  options?: { readonly rootDir?: string }
): Promise<Result<TopoExportReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    const persisted = persistAndReadStoredExport(app, db, rootDir);
    if (persisted.isErr()) {
      return persisted;
    }

    const { snapshot, storedExport } = persisted.value;
    const artifacts = await writeStoredExportArtifacts(
      storedExport,
      deriveTrailsDir({ rootDir })
    );
    return Result.ok({ ...artifacts, snapshot });
  } finally {
    db.close();
  }
};
