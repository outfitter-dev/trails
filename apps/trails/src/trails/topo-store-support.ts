/**
 * Stored-export pipeline for topo persistence.
 *
 * Extracted from topo-support.ts to isolate store persistence concerns,
 * keeping module boundaries clean.
 */

import { Database } from 'bun:sqlite';

import type { Topo } from '@ontrails/core';
import {
  ConflictError,
  deriveTrailsDir,
  InternalError,
  openWriteTrailsDb,
  Result,
  TimeoutError,
} from '@ontrails/core';
import type {
  LockManifest,
  TopoGraph,
  TopoGraphOverlayRegistration,
  TopoSnapshot,
  TrailsLock,
} from '@ontrails/topography';
import type { StoredTopoExport } from '@ontrails/topography/backend-support';
import {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  deriveSourceFingerprint,
  deriveTopoGraphDiff,
  deriveTopoGraphHash,
  isTopoArtifactRegenerationError,
  readTopoGraph,
  TRAILS_LOCK_SCHEMA_VERSION,
  writeTrailsLock,
} from '@ontrails/topography';
import {
  createStoredTopoSnapshot,
  getStoredTopoExport,
} from '@ontrails/topography/backend-support';

import { removeRootRelativeFileIfPresent } from '../local-state-io.js';

import type { TopoExportReport } from './topo-support.js';
import {
  deriveRootDir,
  deriveTopoCounts,
  readGitState,
} from './topo-support.js';

type OverlaysOption = readonly TopoGraphOverlayRegistration[];

const persistAndReadStoredExport = (
  app: Topo,
  db: ReturnType<typeof openWriteTrailsDb>,
  rootDir: string,
  options?:
    | {
        readonly overlays?: OverlaysOption | undefined;
      }
    | undefined
): Result<
  { snapshot: TopoSnapshot; storedExport: StoredTopoExport },
  Error
> => {
  const snapshotResult = createStoredTopoSnapshot(db, app, {
    overlays: options?.overlays,
    sourceFingerprint: deriveSourceFingerprint(rootDir),
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

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const readErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { readonly code?: unknown };
  return typeof code === 'string' ? code : undefined;
};

const isSqliteLockError = (error: unknown): boolean => {
  const code = readErrorCode(error);
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return true;
  }
  return asError(error).message.match(/database is (locked|busy)/i) !== null;
};

export const mapTopoExportError = (error: unknown): Error => {
  if (!isSqliteLockError(error)) {
    return error instanceof Error
      ? error
      : new InternalError('Unable to write topo artifacts');
  }
  return new TimeoutError(
    'Timed out waiting for the Trails topo store lock while compiling artifacts. Another topo write may be running; retry after it finishes.',
    {
      cause: asError(error),
      context: {
        operation: 'compile',
        reason: 'sqlite-lock-contention',
        resource: 'trails.db',
      },
    }
  );
};

export const deriveCurrentTopoExport = (
  app: Topo,
  options?: {
    readonly rootDir?: string;
    readonly overlays?: OverlaysOption | undefined;
  }
): Result<StoredTopoExport, Error> => {
  const rootDir = deriveRootDir(options?.rootDir);
  const db = new Database(':memory:');

  try {
    const derived = persistAndReadStoredExport(app, db, rootDir, {
      overlays: options?.overlays,
    });
    return derived.isErr() ? derived : Result.ok(derived.value.storedExport);
  } finally {
    db.close();
  }
};

const readPreviousCommittedTopo = async (
  rootDir: string
): Promise<TopoGraph | null> => {
  try {
    const rootTopo = await readTopoGraph({ dir: rootDir });
    return rootTopo ?? readTopoGraph({ dir: deriveTrailsDir({ rootDir }) });
  } catch (error) {
    if (isTopoArtifactRegenerationError(error)) {
      return null;
    }
    throw error;
  }
};

const prepareStoredExportArtifacts = async (
  storedExport: StoredTopoExport,
  rootDir: string,
  options?: { readonly force?: boolean | undefined }
): Promise<{
  readonly hash: string;
  readonly topoGraph: TopoGraph;
}> => {
  const previousTopo = await readPreviousCommittedTopo(rootDir);
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

  return {
    hash,
    topoGraph,
  };
};

const LEGACY_COMMITTED_ARTIFACTS = [
  '.trails/topo.lock',
  '.trails/trails.lock',
] as const;

const removeLegacyCommittedArtifacts = (
  rootDir: string
): Result<void, Error> => {
  for (const relativePath of LEGACY_COMMITTED_ARTIFACTS) {
    const removed = removeRootRelativeFileIfPresent(rootDir, relativePath);
    if (removed.isErr()) {
      return removed;
    }
  }

  return Result.ok();
};

const writeStoredExportArtifacts = async (
  storedExport: StoredTopoExport,
  rootDir: string,
  options?: { readonly force?: boolean | undefined }
): Promise<Pick<TopoExportReport, 'hash' | 'lockPath'>> => {
  const prepared = await prepareStoredExportArtifacts(
    storedExport,
    rootDir,
    options
  );

  const lockManifest = JSON.parse(
    storedExport.lockManifestJson
  ) as LockManifest;
  // Omit wallclock provenance from the committed artifact so recompiling the
  // same sources yields byte-identical lock files; the hash never covered it.
  const { generatedAt: _generatedAt, ...committedTopoGraph } =
    prepared.topoGraph;
  const lockPath = await writeTrailsLock(
    {
      scope: lockManifest.scope,
      summary: {
        entities: prepared.topoGraph.entries.filter(
          (entry) => entry.kind === 'entity'
        ).length,
        resources: prepared.topoGraph.entries.filter(
          (entry) => entry.kind === 'resource'
        ).length,
        signals: prepared.topoGraph.entries.filter(
          (entry) => entry.kind === 'signal'
        ).length,
        trails: prepared.topoGraph.entries.filter(
          (entry) => entry.kind === 'trail'
        ).length,
      },
      topoGraph: committedTopoGraph,
      topoGraphHash: prepared.hash,
      version: TRAILS_LOCK_SCHEMA_VERSION,
    } as TrailsLock,
    { dir: rootDir }
  );
  const removedLegacyArtifacts = removeLegacyCommittedArtifacts(rootDir);
  if (removedLegacyArtifacts.isErr()) {
    throw removedLegacyArtifacts.error;
  }

  return {
    hash: prepared.hash,
    lockPath,
  };
};

export const exportCurrentTopo = async (
  app: Topo,
  options?: {
    readonly force?: boolean | undefined;
    readonly rootDir?: string;
    readonly overlays?: OverlaysOption | undefined;
  }
): Promise<Result<TopoExportReport, Error>> => {
  const rootDir = deriveRootDir(options?.rootDir);
  let db: ReturnType<typeof openWriteTrailsDb> | undefined;

  try {
    const candidate = deriveCurrentTopoExport(app, {
      overlays: options?.overlays,
      rootDir,
    });
    if (candidate.isErr()) {
      return candidate;
    }

    try {
      await prepareStoredExportArtifacts(candidate.value, rootDir, {
        force: options?.force,
      });
    } catch (error: unknown) {
      return Result.err(mapTopoExportError(error));
    }

    db = openWriteTrailsDb({ rootDir });
    const persisted = persistAndReadStoredExport(app, db, rootDir, {
      overlays: options?.overlays,
    });
    if (persisted.isErr()) {
      return persisted;
    }

    const { snapshot, storedExport } = persisted.value;
    let artifacts: Pick<TopoExportReport, 'hash' | 'lockPath'>;
    try {
      artifacts = await writeStoredExportArtifacts(storedExport, rootDir, {
        force: options?.force,
      });
    } catch (error: unknown) {
      return Result.err(mapTopoExportError(error));
    }
    return Result.ok({ ...artifacts, snapshot });
  } catch (error: unknown) {
    return Result.err(mapTopoExportError(error));
  } finally {
    db?.close();
  }
};
