import { trailsLockFileName } from '@ontrails/config';
import type { ReadTrailsProjectIdentityResult } from '@ontrails/config';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

export interface ConfiguredAppAlias {
  readonly aliasEntryPaths: ReadonlySet<string>;
  readonly authoredLockPath: string;
  readonly authoredRoot: string;
  readonly physicalLockPath: string;
  readonly physicalAliasEntryPaths: ReadonlySet<string>;
  readonly physicalRoot: string;
  readonly physicalRootDir: string;
}

const toPosixRelative = (root: string, target: string): string => {
  const path = relative(root, target);
  return sep === posix.sep ? path : path.split(sep).join(posix.sep);
};

const isWithinBoundary = (boundary: string, target: string): boolean => {
  const path = relative(boundary, target);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
};

const isNormalizedConfiguredRoot = (root: string): boolean =>
  root !== '.' &&
  !posix.isAbsolute(root) &&
  posix.normalize(root) === root &&
  root.split('/').every((segment) => segment !== '' && segment !== '..');

/** Express an in-workspace target as segments to descend from the canonical root. */
const workspaceDescentSegments = (
  canonicalWorkspaceRoot: string,
  target: string
): readonly string[] | undefined => {
  const suffix: string[] = [];
  let ancestor = target;
  while (!isWithinBoundary(canonicalWorkspaceRoot, ancestor)) {
    if (realpathSync(ancestor) === canonicalWorkspaceRoot) {
      return suffix;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      return undefined;
    }
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const path = toPosixRelative(canonicalWorkspaceRoot, ancestor);
  return path === '' ? suffix : [...path.split(posix.sep), ...suffix];
};

/** Walk a target path segment by segment so parent alias hops stay visible. */
const physicalAliasTargetChain = (
  canonicalWorkspaceRoot: string,
  absoluteAliasPath: string,
  canonicalAliasTarget: string
): readonly string[] | undefined => {
  const entries: string[] = [];
  const visited = new Set<string>();
  const pending: string[] = [];
  let current = resolve(
    realpathSync(dirname(absoluteAliasPath)),
    basename(absoluteAliasPath)
  );
  while (true) {
    if (!isWithinBoundary(canonicalWorkspaceRoot, current)) {
      return undefined;
    }
    if (!lstatSync(current).isSymbolicLink()) {
      const segment = pending.shift();
      if (segment === undefined) {
        return realpathSync(current) === canonicalAliasTarget
          ? entries
          : undefined;
      }
      current = resolve(current, segment);
      continue;
    }
    if (visited.has(current)) {
      return undefined;
    }
    visited.add(current);
    entries.push(toPosixRelative(canonicalWorkspaceRoot, current));
    if (pending.length > 0) {
      entries.push(
        toPosixRelative(canonicalWorkspaceRoot, resolve(current, ...pending))
      );
    }
    const targetSegments = workspaceDescentSegments(
      canonicalWorkspaceRoot,
      resolve(dirname(current), readlinkSync(current))
    );
    if (targetSegments === undefined) {
      return undefined;
    }
    pending.unshift(...targetSegments);
    current = canonicalWorkspaceRoot;
  }
};

const configuredAliasEntryPaths = (
  workspaceRoot: string,
  canonicalWorkspaceRoot: string,
  authoredRoot: string
): {
  readonly authored: ReadonlySet<string>;
  readonly physical: ReadonlySet<string>;
} => {
  const authored = new Set<string>();
  const physical = new Set<string>();
  const segments = authoredRoot.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const path = segments.slice(0, index).join('/');
    const absolutePath = resolve(workspaceRoot, path);
    try {
      if (!lstatSync(absolutePath).isSymbolicLink()) {
        continue;
      }
      const canonicalAliasTarget = realpathSync(absolutePath);
      if (isWithinBoundary(canonicalWorkspaceRoot, canonicalAliasTarget)) {
        const physicalEntries = physicalAliasTargetChain(
          canonicalWorkspaceRoot,
          absolutePath,
          canonicalAliasTarget
        );
        if (physicalEntries !== undefined) {
          authored.add(path);
          for (const physicalEntry of physicalEntries) {
            physical.add(physicalEntry);
          }
        }
      }
    } catch {
      // A changing or unreadable alias remains an unsupported collection edge.
    }
  }
  return { authored, physical };
};

/** Reconcile only normalized, unique aliases whose real target stays in-workspace. */
export const deriveConfiguredAppAliases = (
  identity: ReadTrailsProjectIdentityResult
): readonly ConfiguredAppAlias[] => {
  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = realpathSync(identity.rootDir);
  } catch {
    return [];
  }

  const candidates = identity.apps.flatMap((app): ConfiguredAppAlias[] => {
    if (!isNormalizedConfiguredRoot(app.root)) {
      return [];
    }
    const authoredAppRoot = resolve(identity.rootDir, app.root);
    if (resolve(app.rootDir) !== authoredAppRoot) {
      return [];
    }

    let canonicalAppRoot: string;
    try {
      canonicalAppRoot = realpathSync(app.rootDir);
    } catch {
      return [];
    }
    if (!isWithinBoundary(canonicalWorkspaceRoot, canonicalAppRoot)) {
      return [];
    }

    const physicalRoot = toPosixRelative(
      canonicalWorkspaceRoot,
      canonicalAppRoot
    );
    if (physicalRoot === app.root) {
      return [];
    }
    const aliasEntryPaths = configuredAliasEntryPaths(
      identity.rootDir,
      canonicalWorkspaceRoot,
      app.root
    );
    if (aliasEntryPaths.authored.size === 0) {
      return [];
    }
    return [
      {
        aliasEntryPaths: aliasEntryPaths.authored,
        authoredLockPath: posix.join(app.root, trailsLockFileName),
        authoredRoot: app.root,
        physicalAliasEntryPaths: aliasEntryPaths.physical,
        physicalLockPath: posix.join(physicalRoot, trailsLockFileName),
        physicalRoot,
        physicalRootDir: canonicalAppRoot,
      },
    ];
  });

  const physicalLockOwners = new Map<string, number>();
  for (const alias of candidates) {
    physicalLockOwners.set(
      alias.physicalLockPath,
      (physicalLockOwners.get(alias.physicalLockPath) ?? 0) + 1
    );
  }
  return candidates.filter(
    (alias) => physicalLockOwners.get(alias.physicalLockPath) === 1
  );
};
