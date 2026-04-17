/**
 * Stored-export pipeline for topo persistence.
 *
 * Extracted from topo-support.ts so this branch (trl-131) owns its own file,
 * keeping absorb routing clean across the stack.
 */

import type { Topo } from '@ontrails/core';
import { InternalError, Result } from '@ontrails/core';
import type { TopoSaveRecord } from '@ontrails/core/internal/topo-saves';
import type { StoredTopoExport } from '@ontrails/core/internal/topo-store';
import {
  getStoredTopoExport,
  persistEstablishedTopoSave,
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
): Result<{ save: TopoSaveRecord; storedExport: StoredTopoExport }, Error> => {
  const saveResult = persistEstablishedTopoSave(db, app, {
    ...readGitState(rootDir),
    ...deriveTopoCounts(app),
  });
  if (saveResult.isErr()) {
    return saveResult;
  }

  const save = saveResult.value;
  const storedExport = getStoredTopoExport(db, save.id);

  if (storedExport === undefined) {
    return Result.err(
      new InternalError(`Missing stored topo export for save "${save.id}"`)
    );
  }

  return Result.ok({
    save,
    storedExport,
  });
};

const writeStoredExportArtifacts = async (
  storedExport: StoredTopoExport,
  trailsDir: string
): Promise<Pick<TopoExportReport, 'hash' | 'lockPath' | 'mapPath'>> => {
  const mapPath = await writeSurfaceMap(
    JSON.parse(storedExport.trailheadMapJson) as SurfaceMap,
    { dir: trailsDir }
  );
  const lockPath = await writeSurfaceLock(
    JSON.parse(storedExport.lockContent) as SurfaceLock,
    { dir: trailsDir }
  );

  return {
    hash: storedExport.trailheadHash,
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

    const { save, storedExport } = persisted.value;
    const artifacts = await writeStoredExportArtifacts(
      storedExport,
      deriveTrailsDir({ rootDir })
    );
    return Result.ok({ ...artifacts, save });
  } finally {
    db.close();
  }
};
