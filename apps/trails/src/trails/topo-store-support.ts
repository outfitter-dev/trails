/**
 * Stored-export pipeline for topo persistence.
 *
 * Extracted from topo-support.ts to isolate store persistence concerns,
 * keeping module boundaries clean.
 */

import type { Topo, TopoSnapshot } from '@ontrails/core';
import { InternalError, Result } from '@ontrails/core';
import type { StoredTopoExport } from '@ontrails/core/internal/topo-store';
import {
  createTopoSnapshot,
  getStoredTopoExport,
} from '@ontrails/core/internal/topo-store';
import {
  openWriteTrailsDb,
  deriveTrailsDir,
} from '@ontrails/core/internal/trails-db';
import type { SurfaceLock, SurfaceMap } from '@ontrails/schema';
import { writeSurfaceLock, writeSurfaceMap } from '@ontrails/schema';

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
  const snapshotResult = createTopoSnapshot(db, app, {
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
