/**
 * Stored-export pipeline for topo persistence.
 *
 * Extracted from topo-support.ts to isolate store persistence concerns,
 * keeping module boundaries clean.
 */

import { Database } from 'bun:sqlite';

import type { CliCommandAliasInput, Topo } from '@ontrails/core';
import {
  ConflictError,
  deriveTrailsDir,
  InternalError,
  openWriteTrailsDb,
  Result,
} from '@ontrails/core';
import type {
  LockManifest,
  TopoGraph,
  TopoSnapshot,
} from '@ontrails/topographer';
import type { StoredTopoExport } from '@ontrails/topographer/backend-support';
import {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  readTopoGraph,
  writeLockManifest,
  writeTopoGraph,
} from '@ontrails/topographer';
import {
  createStoredTopoSnapshot,
  getStoredTopoExport,
} from '@ontrails/topographer/backend-support';

import type { TopoExportReport } from './topo-support.js';
import {
  deriveRootDir,
  deriveTopoCounts,
  readGitState,
} from './topo-support.js';

type CliAliasesOption = Readonly<
  Record<string, readonly CliCommandAliasInput[]>
>;

const persistAndReadStoredExport = (
  app: Topo,
  db: ReturnType<typeof openWriteTrailsDb>,
  rootDir: string,
  options?: { readonly cliAliases?: CliAliasesOption | undefined } | undefined
): Result<
  { snapshot: TopoSnapshot; storedExport: StoredTopoExport },
  Error
> => {
  const snapshotResult = createStoredTopoSnapshot(db, app, {
    cliAliases: options?.cliAliases,
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
  options?: {
    readonly cliAliases?: CliAliasesOption | undefined;
    readonly rootDir?: string;
  }
): Result<StoredTopoExport, Error> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = new Database(':memory:');

  try {
    const projected = persistAndReadStoredExport(app, db, rootDir, {
      cliAliases: options?.cliAliases,
    });
    return projected.isErr()
      ? projected
      : Result.ok(projected.value.storedExport);
  } finally {
    db.close();
  }
};

const writeStoredExportArtifacts = async (
  storedExport: StoredTopoExport,
  trailsDir: string,
  options?: { readonly force?: boolean | undefined }
): Promise<Pick<TopoExportReport, 'hash' | 'lockPath' | 'topoPath'>> => {
  const previousTopo = await readTopoGraph({ dir: trailsDir });
  const nextTopo = JSON.parse(storedExport.topoGraphJson) as TopoGraph;
  const diff =
    previousTopo === null
      ? undefined
      : deriveTopoGraphDiff(previousTopo, nextTopo);
  if (diff !== undefined && diff.breaking.length > 0 && !options?.force) {
    throw new ConflictError(
      `Topo contains ${diff.breaking.length} breaking change(s). Add a version entry, revert the change, or rerun with --force.`
    );
  }

  const topoGraphBase =
    previousTopo === null
      ? nextTopo
      : carryForwardTopoGraphForces(previousTopo, nextTopo);
  const topoGraph =
    diff === undefined || diff.breaking.length === 0
      ? topoGraphBase
      : annotateTopoGraphForces(topoGraphBase, diff.breaking);
  const hash = deriveTopoGraphHash(topoGraph);
  const lockManifest = {
    ...(JSON.parse(storedExport.lockManifestJson) as LockManifest),
    artifacts: [
      {
        path: 'topo.lock',
        role: 'topo',
        sha256: hash,
      },
    ],
  } satisfies LockManifest;

  const topoPath = await writeTopoGraph(topoGraph, { dir: trailsDir });
  const lockPath = await writeLockManifest(lockManifest, { dir: trailsDir });

  return {
    hash,
    lockPath,
    topoPath,
  };
};

export const exportCurrentTopo = async (
  app: Topo,
  options?: {
    readonly cliAliases?: CliAliasesOption | undefined;
    readonly force?: boolean | undefined;
    readonly rootDir?: string;
  }
): Promise<Result<TopoExportReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = openWriteTrailsDb({ rootDir });

  try {
    const persisted = persistAndReadStoredExport(app, db, rootDir, {
      cliAliases: options?.cliAliases,
    });
    if (persisted.isErr()) {
      return persisted;
    }

    const { snapshot, storedExport } = persisted.value;
    let artifacts: Pick<TopoExportReport, 'hash' | 'lockPath' | 'topoPath'>;
    try {
      artifacts = await writeStoredExportArtifacts(
        storedExport,
        deriveTrailsDir({ rootDir }),
        { force: options?.force }
      );
    } catch (error: unknown) {
      return Result.err(
        error instanceof Error
          ? error
          : new InternalError('Unable to write topo artifacts')
      );
    }
    return Result.ok({ ...artifacts, snapshot });
  } finally {
    db.close();
  }
};
