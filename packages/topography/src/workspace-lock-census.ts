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
import { deriveConfiguredAppAliases } from './workspace-configured-aliases.js';

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

export interface WorkspaceLockCensus {
  readonly collectionSkips: readonly WorkspaceViewCollectionSkip[];
  readonly configuredAppRootDirectories: ReadonlyMap<string, string>;
  readonly unownedLocks: readonly UnownedWorkspaceLockObservation[];
}

const containsRelativePath = (boundary: string, target: string): boolean =>
  target === boundary || target.startsWith(`${boundary}/`);

const compareCollectionSkips = (
  left: WorkspaceViewCollectionSkip,
  right: WorkspaceViewCollectionSkip
): number => {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.reason === right.reason) {
    return 0;
  }
  return left.reason < right.reason ? -1 : 1;
};

const excludedPathForLock = (
  lockPath: string,
  lockScope: PathScope | undefined
): string | undefined => {
  const segments = lockPath.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = segments.slice(0, index).join('/');
    if (matchesAnyPathGlob(ancestor, lockScope?.exclude)) {
      return ancestor;
    }
  }
  return matchesAnyPathGlob(lockPath, lockScope?.exclude)
    ? lockPath
    : undefined;
};

const scopeExcludedPathForExpectedLock = (
  lockPath: string,
  lockScope: PathScope | undefined
): string | undefined => {
  const excludedPath = excludedPathForLock(lockPath, lockScope);
  if (excludedPath !== undefined) {
    return excludedPath;
  }
  return includedByPathScope(lockPath, lockScope) ? undefined : lockPath;
};

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
  const aliases = deriveConfiguredAppAliases(identity);
  const authoredLockPathByPhysicalPath = new Map(
    aliases.map((alias) => [alias.physicalLockPath, alias.authoredLockPath])
  );
  const safeAliasEntryPaths = new Set(
    aliases.flatMap((alias) => [
      ...alias.aliasEntryPaths,
      ...alias.physicalAliasEntryPaths,
    ])
  );
  const configuredAppRootDirectories = new Map(
    aliases.map((alias) => [alias.authoredLockPath, alias.physicalRootDir])
  );
  // Config supports app roots below ignored ancestry, so descent toward a
  // configured root stays observable here too. The exemption reaches only
  // ancestors of a configured root, or the root itself. Ignored-named
  // directories below a configured root stay pruned, so an app's own
  // dependency tree never enters the census as unowned lock evidence. Config's
  // own collection still carries the wider two-arm profile; narrowing it there
  // is a separate follow-up. Workspace-root apps never need the exemption;
  // their lock is already outside every ignored directory.
  const configuredRootPaths = [
    ...identity.apps.map((app) => app.root),
    ...aliases.map((alias) => alias.physicalRoot),
  ].filter((root) => root !== '.');
  const collection = collectSourceTree(identity.rootDir, {
    classify: (entry) => {
      if (entry.kind === 'directory') {
        if (
          DEFAULT_IGNORED_DIRECTORIES.has(entry.name) &&
          !configuredRootPaths.some((root) =>
            containsRelativePath(entry.path, root)
          )
        ) {
          return { action: 'skip', reason: 'ignored-directory' };
        }
        if (matchesAnyPathGlob(entry.path, lockScope?.exclude)) {
          return { action: 'skip', reason: 'scope-excluded' };
        }
        return { action: 'recurse' };
      }
      if (matchesAnyPathGlob(entry.path, lockScope?.exclude)) {
        return { action: 'skip', reason: 'scope-excluded' };
      }
      if (entry.kind !== 'file') {
        return { action: 'skip', reason: 'unsupported-entry' };
      }
      if (entry.name !== trailsLockFileName) {
        return { action: 'skip', reason: 'not-lock-artifact' };
      }
      const scopedPath =
        authoredLockPathByPhysicalPath.get(entry.path) ?? entry.path;
      return includedByPathScope(scopedPath, lockScope)
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

  const observedSkips = [
    ...collection.skipped
      .filter(
        (skip) =>
          skip.reason !== 'not-lock-artifact' &&
          !(
            skip.reason === 'unsupported-entry' &&
            safeAliasEntryPaths.has(skip.path)
          )
      )
      .flatMap((skip): WorkspaceViewCollectionSkip[] => {
        const observed = {
          path: skip.path,
          provenance: 'source-collection' as const,
          reason: skip.reason,
        };
        const translated = aliases.flatMap(
          (alias): WorkspaceViewCollectionSkip[] =>
            alias.physicalRoot === skip.path ||
            alias.physicalRoot.startsWith(`${skip.path}/`) ||
            alias.physicalLockPath === skip.path ||
            [...alias.physicalAliasEntryPaths].some(
              (path) => path === skip.path || path.startsWith(`${skip.path}/`)
            )
              ? [
                  {
                    ...observed,
                    path:
                      alias.physicalLockPath === skip.path
                        ? alias.authoredLockPath
                        : alias.authoredRoot,
                  },
                ]
              : []
        );
        return [observed, ...translated];
      }),
    ...identity.apps.flatMap((app): WorkspaceViewCollectionSkip[] =>
      aliases.some((alias) => alias.authoredRoot === app.root) ||
      ![...safeAliasEntryPaths].some(
        (path) => app.root === path || app.root.startsWith(`${path}/`)
      )
        ? []
        : [
            {
              path: app.root,
              provenance: 'source-collection',
              reason: 'unsupported-entry',
            },
          ]
    ),
  ];
  const syntheticScopeSkipPaths = new Set<string>();
  const syntheticScopeSkips = [...expectedLockPaths]
    .toSorted()
    .flatMap((lockPath): WorkspaceViewCollectionSkip[] => {
      const scopeExcludedPath = scopeExcludedPathForExpectedLock(
        lockPath,
        lockScope
      );
      if (
        scopeExcludedPath === undefined ||
        syntheticScopeSkipPaths.has(scopeExcludedPath) ||
        observedSkips.some(
          (skip) =>
            skip.path === lockPath || lockPath.startsWith(`${skip.path}/`)
        )
      ) {
        return [];
      }
      syntheticScopeSkipPaths.add(scopeExcludedPath);
      return [
        {
          path: scopeExcludedPath,
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ];
    });
  const syntheticAliasScopeSkips = aliases.flatMap(
    (alias): WorkspaceViewCollectionSkip[] => {
      const physicalExclusion = [
        ...[...alias.physicalAliasEntryPaths].flatMap((path) => [
          { authoredPath: alias.authoredRoot, path },
          {
            authoredPath: alias.authoredLockPath,
            path: `${path}/${trailsLockFileName}`,
          },
        ]),
        {
          authoredPath: alias.authoredLockPath,
          path: alias.physicalLockPath,
        },
      ]
        .map((candidate) => ({
          ...candidate,
          excludedPath: excludedPathForLock(candidate.path, lockScope),
        }))
        .find((candidate) => candidate.excludedPath !== undefined);
      if (physicalExclusion?.excludedPath === undefined) {
        return [];
      }
      return [
        {
          path: physicalExclusion.excludedPath,
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
        {
          path: physicalExclusion.authoredPath,
          provenance: 'source-collection',
          reason: 'scope-excluded',
        },
      ];
    }
  );
  const collectionSkips = [
    ...new Map(
      [
        ...observedSkips,
        ...syntheticScopeSkips,
        ...syntheticAliasScopeSkips,
      ].map((skip) => [`${skip.path}\0${skip.reason}`, skip])
    ).values(),
  ].toSorted(compareCollectionSkips);
  const unownedLocks = collection.files
    .filter((file) => {
      const authoredPath =
        authoredLockPathByPhysicalPath.get(file.path) ?? file.path;
      return !expectedLockPaths.has(authoredPath);
    })
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
  return { collectionSkips, configuredAppRootDirectories, unownedLocks };
};
