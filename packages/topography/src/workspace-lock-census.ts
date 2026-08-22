import {
  includedByPathScope,
  matchesAnyPathGlob,
  NotFoundError,
} from '@ontrails/core';
import type { PathScope } from '@ontrails/core';
import { trailsLockFileName } from '@ontrails/config';
import type {
  ReadTrailsProjectIdentityResult,
  ResolvedTrailsWorkspaceApp,
} from '@ontrails/config';
import { collectSourceTree } from '@ontrails/source';

import type {
  UnownedWorkspaceLockObservation,
  WorkspaceViewCollectionSkip,
} from './workspace-view-types.js';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

export interface WorkspaceLockCensus {
  readonly collectionSkips: readonly WorkspaceViewCollectionSkip[];
  readonly unownedLocks: readonly UnownedWorkspaceLockObservation[];
}

export const workspaceCollectionSkipForApp = (
  app: ResolvedTrailsWorkspaceApp,
  collectionSkips: readonly WorkspaceViewCollectionSkip[]
): WorkspaceViewCollectionSkip | undefined => {
  const lockPath =
    app.root === '.' ? trailsLockFileName : `${app.root}/${trailsLockFileName}`;
  return collectionSkips.find(
    (skip) =>
      skip.path === lockPath ||
      (app.root !== '.' &&
        (app.root === skip.path || app.root.startsWith(`${skip.path}/`)))
  );
};

/** Collect observation-only lock evidence without deriving workspace identity. */
export const collectWorkspaceLockCensus = (
  identity: ReadTrailsProjectIdentityResult,
  expectedLockPaths: ReadonlySet<string>,
  lockScope: PathScope | undefined
): WorkspaceLockCensus => {
  const collection = collectSourceTree(identity.rootDir, {
    classify: (entry) => {
      if (entry.kind === 'directory') {
        if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          return { action: 'skip', reason: 'ignored-directory' };
        }
        if (matchesAnyPathGlob(entry.path, lockScope?.exclude)) {
          return { action: 'skip', reason: 'scope-excluded' };
        }
        return { action: 'recurse' };
      }
      if (entry.kind !== 'file') {
        return { action: 'skip', reason: 'unsupported-entry' };
      }
      if (entry.name !== trailsLockFileName) {
        return { action: 'skip', reason: 'not-lock-artifact' };
      }
      return includedByPathScope(entry.path, lockScope)
        ? { action: 'collect' }
        : { action: 'skip', reason: 'scope-excluded' };
    },
  });
  if (collection === null) {
    throw new NotFoundError(
      `Cannot observe workspace collection root ${identity.rootDir}.`,
      { context: { rootDir: identity.rootDir } }
    );
  }

  const collectionSkips = collection.skipped
    .filter((skip) => skip.reason !== 'not-lock-artifact')
    .map((skip) => ({
      path: skip.path,
      provenance: 'source-collection' as const,
      reason: skip.reason,
    }));
  const unownedLocks = collection.files
    .filter((file) => !expectedLockPaths.has(file.path))
    .map((file): UnownedWorkspaceLockObservation => {
      const rootAggregate = file.path === trailsLockFileName;
      return {
        coaching: rootAggregate
          ? 'Remove the workspace-root trails.lock; configured workspaces use app-root locks only.'
          : `Declare the lock-owning app root for ${file.path} in workspace.apps, or remove the lock if it is not an app artifact.`,
        kind: rootAggregate
          ? 'forbidden-workspace-aggregate'
          : 'unconfigured-app-lock',
        path: file.path,
        provenance: 'source-collection',
      };
    });
  return { collectionSkips, unownedLocks };
};
