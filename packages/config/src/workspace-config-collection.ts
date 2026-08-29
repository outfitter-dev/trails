import { statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { ValidationError } from '@ontrails/core';
import { collectSourceTree } from '@ontrails/source';
import type {
  SourceCollectionBoundaryReason,
  SourceCollectionDecision,
} from '@ontrails/source';

import {
  findTrailsConfigPaths,
  trailsConfigFileCandidates,
} from './trails-conventions.js';
import { canonicalBoundaryPath, isWithinBoundary } from './path-boundary.js';

const ignoredCollectionDirectories = new Set([
  '.cache',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

const configCandidateNames = new Set<string>(trailsConfigFileCandidates);

type ConfigCollectionBoundaryReason =
  | SourceCollectionBoundaryReason
  | 'unreadable-git-boundary';

interface ConfigCollectionBoundary {
  readonly canonicalPath: string;
  readonly path: string;
  readonly reason: ConfigCollectionBoundaryReason;
}

const configCollectionBoundaryReasons = new Set<string>([
  'nested-repository',
  'nested-worktree',
  'submodule-boundary',
  'unreadable-git-boundary',
]);

const isConfigCollectionBoundaryReason = (
  reason: string
): reason is ConfigCollectionBoundaryReason =>
  configCollectionBoundaryReasons.has(reason);

const collectionBoundaries = (
  rootDir: string,
  skipped: readonly { readonly path: string; readonly reason: string }[]
): readonly ConfigCollectionBoundary[] =>
  skipped
    .filter(
      (
        entry
      ): entry is typeof entry & {
        readonly reason: ConfigCollectionBoundaryReason;
      } => isConfigCollectionBoundaryReason(entry.reason)
    )
    .map((entry) => {
      const path = resolve(rootDir, entry.path);
      return {
        canonicalPath: canonicalBoundaryPath(path),
        path,
        reason: entry.reason,
      };
    });

const assertReadableCollectionEvidence = (
  boundaryDir: string,
  skipped: readonly { readonly path: string; readonly reason: string }[]
): void => {
  const uncertain = skipped.filter(
    (entry) =>
      entry.reason.startsWith('unreadable-') &&
      entry.reason !== 'unreadable-git-boundary'
  );
  if (uncertain.length > 0) {
    throw new ValidationError(
      `Unable to prove static project identity inside "${boundaryDir}" because collection evidence is unreadable.`,
      { context: { boundaryDir: resolve(boundaryDir), skipped: uncertain } }
    );
  }
};

const validateOneConfigPerDirectory = (
  configPaths: readonly string[]
): void => {
  const pathsByLexicalDirectory = new Map<string, string[]>();
  const pathsByCanonicalDirectory = new Map<string, string[]>();
  for (const configPath of configPaths) {
    for (const [directory, pathsByDirectory] of [
      [dirname(resolve(configPath)), pathsByLexicalDirectory],
      [dirname(canonicalBoundaryPath(configPath)), pathsByCanonicalDirectory],
    ] as const) {
      const paths = pathsByDirectory.get(directory) ?? [];
      paths.push(configPath);
      pathsByDirectory.set(directory, paths);
    }
  }
  for (const pathsByDirectory of [
    pathsByLexicalDirectory,
    pathsByCanonicalDirectory,
  ]) {
    for (const paths of pathsByDirectory.values()) {
      if (paths.length > 1) {
        throw new ValidationError(
          `Multiple Trails config files found: ${paths.join(', ')}. Keep one config file per project root.`
        );
      }
    }
  }
};

const dedupeConfigPaths = (
  configPaths: readonly string[]
): readonly string[] => {
  const pathsByCanonicalIdentity = new Map<string, string>();
  for (const configPath of configPaths) {
    pathsByCanonicalIdentity.set(canonicalBoundaryPath(configPath), configPath);
  }
  return [...pathsByCanonicalIdentity.values()];
};

export const collectConfigBoundariesThroughPaths = (
  boundaryDir: string,
  targetPaths: readonly string[]
): readonly ConfigCollectionBoundary[] => {
  const canonicalBoundary = canonicalBoundaryPath(boundaryDir);
  const canonicalTargets = targetPaths.map(canonicalBoundaryPath);
  const collection = collectSourceTree(canonicalBoundary, {
    classify: (entry) => {
      if (entry.kind !== 'directory') {
        return { action: 'skip', reason: 'not-target-ancestor' };
      }
      const canonicalEntry = canonicalBoundaryPath(
        resolve(canonicalBoundary, entry.path)
      );
      return canonicalTargets.some((target) =>
        isWithinBoundary(canonicalEntry, target)
      )
        ? { action: 'recurse' }
        : { action: 'skip', reason: 'not-target-ancestor' };
    },
  });
  if (collection === null) {
    throw new ValidationError(
      `Unable to read static project identity discovery boundary "${boundaryDir}".`,
      { context: { boundaryDir: resolve(boundaryDir) } }
    );
  }
  assertReadableCollectionEvidence(boundaryDir, collection.skipped);
  return collectionBoundaries(canonicalBoundary, collection.skipped);
};

const assertPathDoesNotTraverseCollectionEdge = (
  boundaryDir: string,
  targetPath: string,
  label: string
): void => {
  const canonicalTarget = canonicalBoundaryPath(targetPath);
  const collectionEdge = collectConfigBoundariesThroughPaths(boundaryDir, [
    canonicalTarget,
  ]).find((boundary) =>
    isWithinBoundary(boundary.canonicalPath, canonicalTarget)
  );
  if (collectionEdge !== undefined) {
    throw new ValidationError(
      `Static project identity ${label} "${targetPath}" traverses a ${collectionEdge.reason} collection edge at "${collectionEdge.path}".`,
      {
        context: {
          boundaryDir: resolve(boundaryDir),
          boundaryPath: collectionEdge.path,
          boundaryReason: collectionEdge.reason,
          targetPath,
        },
      }
    );
  }
};

const isFollowedDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const findConfigPathsThroughBoundary = (
  startDir: string,
  boundaryDir: string
): readonly string[] => {
  const start = resolve(startDir);
  const boundary = resolve(boundaryDir);
  if (!isFollowedDirectory(start)) {
    throw new ValidationError(
      `Static project identity start directory "${start}" is not an existing directory.`,
      { context: { boundaryDir: boundary, startDir: start } }
    );
  }
  const canonicalBoundary = canonicalBoundaryPath(boundary);
  let canonicalCurrent = canonicalBoundaryPath(start);
  if (!isWithinBoundary(canonicalBoundary, canonicalCurrent)) {
    throw new ValidationError(
      `Static project identity start directory "${start}" is outside discovery boundary "${boundary}".`,
      { context: { boundaryDir: boundary, startDir: start } }
    );
  }
  assertPathDoesNotTraverseCollectionEdge(boundary, canonicalCurrent, 'target');
  const found: string[] = [];
  while (true) {
    const current = resolve(
      boundary,
      relative(canonicalBoundary, canonicalCurrent)
    );
    const paths = dedupeConfigPaths(findTrailsConfigPaths(current));
    validateOneConfigPerDirectory(paths);
    if (paths[0] !== undefined) {
      found.push(paths[0]);
    }
    if (canonicalCurrent === canonicalBoundary) {
      return found;
    }
    const parent = dirname(canonicalCurrent);
    if (parent === canonicalCurrent) {
      return found;
    }
    canonicalCurrent = parent;
  }
};

const isFollowedFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export const collectConfigPathsWithinBoundary = (
  boundaryDir: string,
  includedRootDirs: readonly string[] = [],
  collectionBoundaryDir: string = boundaryDir
): readonly string[] => {
  const boundary = resolve(boundaryDir);
  const collectionBoundary = resolve(collectionBoundaryDir);
  const canonicalBoundary = canonicalBoundaryPath(boundary);
  const canonicalCollectionBoundary = canonicalBoundaryPath(collectionBoundary);
  if (!isWithinBoundary(canonicalCollectionBoundary, canonicalBoundary)) {
    throw new ValidationError(
      `Static project identity boundary "${boundary}" is outside collection boundary "${collectionBoundary}".`,
      {
        context: {
          boundaryDir: boundary,
          collectionBoundaryDir: collectionBoundary,
        },
      }
    );
  }
  const includedRoots = includedRootDirs.map((rootDir) => resolve(rootDir));
  const visitedCanonicalDirectories = new Set([canonicalCollectionBoundary]);
  const recurseDirectoryOnce = (
    absoluteEntryPath: string
  ): SourceCollectionDecision => {
    const canonicalEntryPath = canonicalBoundaryPath(absoluteEntryPath);
    if (visitedCanonicalDirectories.has(canonicalEntryPath)) {
      return { action: 'skip', reason: 'already-visited-directory' };
    }
    visitedCanonicalDirectories.add(canonicalEntryPath);
    return { action: 'recurse' };
  };
  const collection = collectSourceTree(collectionBoundary, {
    classify: (entry) => {
      const absoluteEntryPath = resolve(collectionBoundary, entry.path);
      if (!isWithinBoundary(boundary, absoluteEntryPath)) {
        const traversesTowardBoundary = isWithinBoundary(
          absoluteEntryPath,
          boundary
        );
        return traversesTowardBoundary &&
          (entry.kind === 'directory' ||
            (entry.kind === 'other' && isFollowedDirectory(absoluteEntryPath)))
          ? recurseDirectoryOnce(absoluteEntryPath)
          : { action: 'skip', reason: 'outside-selected-boundary' };
      }
      const isIncludedRootAncestor = includedRoots.some((rootDir) =>
        isWithinBoundary(absoluteEntryPath, rootDir)
      );
      const isWithinIncludedRoot = includedRoots.some((rootDir) =>
        isWithinBoundary(rootDir, absoluteEntryPath)
      );
      if (configCandidateNames.has(entry.name)) {
        return entry.kind === 'file' || entry.kind === 'other'
          ? { action: 'collect' }
          : { action: 'skip', reason: 'invalid-trails-config-candidate' };
      }
      if (
        entry.kind === 'directory' &&
        ignoredCollectionDirectories.has(entry.name) &&
        !(isIncludedRootAncestor || isWithinIncludedRoot)
      ) {
        return { action: 'skip', reason: 'ignored-directory' };
      }
      if (entry.kind === 'directory') {
        return recurseDirectoryOnce(absoluteEntryPath);
      }
      if (entry.kind === 'other' && isFollowedDirectory(absoluteEntryPath)) {
        const canonicalEntryPath = canonicalBoundaryPath(absoluteEntryPath);
        return isWithinBoundary(canonicalBoundary, canonicalEntryPath)
          ? recurseDirectoryOnce(absoluteEntryPath)
          : { action: 'skip', reason: 'outside-selected-boundary' };
      }
      return { action: 'skip', reason: 'not-trails-config' };
    },
  });
  if (collection === null) {
    throw new ValidationError(
      `Unable to read static project identity discovery boundary "${collectionBoundaryDir}".`,
      { context: { boundaryDir: collectionBoundary } }
    );
  }
  assertReadableCollectionEvidence(collectionBoundaryDir, collection.skipped);
  const configPaths: string[] = [];
  for (const file of collection.files) {
    if (!isFollowedFile(file.absolutePath)) {
      continue;
    }
    const canonicalConfigPath = canonicalBoundaryPath(file.absolutePath);
    if (!isWithinBoundary(canonicalBoundary, canonicalConfigPath)) {
      throw new ValidationError(
        `Static project identity config marker "${file.absolutePath}" resolves outside discovery boundary "${boundary}".`,
        {
          context: {
            boundaryDir: boundary,
            canonicalConfigPath,
            configPath: file.absolutePath,
          },
        }
      );
    }
    assertPathDoesNotTraverseCollectionEdge(
      collectionBoundary,
      canonicalConfigPath,
      'config marker'
    );
    configPaths.push(file.absolutePath);
  }
  const paths = dedupeConfigPaths(configPaths);
  validateOneConfigPerDirectory(paths);
  return paths;
};

export const combineConfigPaths = (
  collectedPaths: readonly string[],
  selectedPaths: readonly string[]
): readonly string[] => {
  const pathsByCanonicalIdentity = new Map(
    collectedPaths.map((path) => [canonicalBoundaryPath(path), path])
  );
  for (const selectedPath of selectedPaths) {
    pathsByCanonicalIdentity.set(
      canonicalBoundaryPath(selectedPath),
      selectedPath
    );
  }
  const locatedPaths = [...pathsByCanonicalIdentity.values()];
  validateOneConfigPerDirectory(locatedPaths);
  return locatedPaths;
};
