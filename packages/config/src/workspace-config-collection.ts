import { dirname, relative, resolve } from 'node:path';

import { ValidationError } from '@ontrails/core';
import { collectSourceTree } from '@ontrails/source';

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

const validateOneConfigPerDirectory = (
  configPaths: readonly string[]
): void => {
  const pathsByDirectory = new Map<string, string[]>();
  for (const configPath of configPaths) {
    const directory = dirname(canonicalBoundaryPath(configPath));
    const paths = pathsByDirectory.get(directory) ?? [];
    paths.push(configPath);
    pathsByDirectory.set(directory, paths);
  }
  for (const paths of pathsByDirectory.values()) {
    if (paths.length > 1) {
      throw new ValidationError(
        `Multiple Trails config files found: ${paths.join(', ')}. Keep one config file per project root.`
      );
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

export const findConfigPathsThroughBoundary = (
  startDir: string,
  boundaryDir: string
): readonly string[] => {
  const start = resolve(startDir);
  const boundary = resolve(boundaryDir);
  const canonicalBoundary = canonicalBoundaryPath(boundary);
  let canonicalCurrent = canonicalBoundaryPath(start);
  if (!isWithinBoundary(canonicalBoundary, canonicalCurrent)) {
    throw new ValidationError(
      `Static project identity start directory "${start}" is outside discovery boundary "${boundary}".`,
      { context: { boundaryDir: boundary, startDir: start } }
    );
  }
  const found: string[] = [];
  while (true) {
    const current = resolve(
      boundary,
      relative(canonicalBoundary, canonicalCurrent)
    );
    const paths = findTrailsConfigPaths(current);
    if (paths.length > 1) {
      throw new ValidationError(
        `Multiple Trails config files found: ${paths.join(', ')}. Keep one config file per project root.`
      );
    }
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

export const collectConfigPathsWithinBoundary = (
  boundaryDir: string
): readonly string[] => {
  const boundary = resolve(boundaryDir);
  const collection = collectSourceTree(boundary, {
    classify: (entry) => {
      if (
        entry.kind === 'directory' &&
        ignoredCollectionDirectories.has(entry.name)
      ) {
        return { action: 'skip', reason: 'ignored-directory' };
      }
      if (entry.kind === 'directory') {
        return { action: 'recurse' };
      }
      if (entry.kind === 'file' && configCandidateNames.has(entry.name)) {
        return { action: 'collect' };
      }
      return { action: 'skip', reason: 'not-trails-config' };
    },
  });
  if (collection === null) {
    throw new ValidationError(
      `Unable to read static project identity discovery boundary "${boundaryDir}".`,
      { context: { boundaryDir: boundary } }
    );
  }
  const uncertain = collection.skipped.filter((entry) =>
    entry.reason.startsWith('unreadable-')
  );
  if (uncertain.length > 0) {
    throw new ValidationError(
      `Unable to prove static project identity inside "${boundaryDir}" because collection evidence is unreadable.`,
      { context: { boundaryDir: boundary, skipped: uncertain } }
    );
  }
  const paths = dedupeConfigPaths(
    collection.files.map((file) => file.absolutePath)
  );
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
