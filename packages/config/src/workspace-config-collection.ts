import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { ValidationError } from '@ontrails/core';
import { collectSourceTree } from '@ontrails/source';

import {
  findTrailsConfigPaths,
  trailsConfigFileCandidates,
} from './trails-conventions.js';

const ignoredCollectionDirectories = new Set([
  '.cache',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

const configCandidateNames = new Set<string>(trailsConfigFileCandidates);

export const isWithinBoundary = (
  boundaryDir: string,
  targetDir: string
): boolean => {
  const path = relative(boundaryDir, targetDir);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

const validateOneConfigPerDirectory = (
  configPaths: readonly string[]
): void => {
  const pathsByDirectory = new Map<string, string[]>();
  for (const configPath of configPaths) {
    const directory = dirname(configPath);
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

export const findConfigPathsThroughBoundary = (
  startDir: string,
  boundaryDir: string
): readonly string[] => {
  let current = resolve(startDir);
  const boundary = resolve(boundaryDir);
  if (!isWithinBoundary(boundary, current)) {
    throw new ValidationError(
      `Static project identity start directory "${current}" is outside discovery boundary "${boundary}".`,
      { context: { boundaryDir: boundary, startDir: current } }
    );
  }
  const found: string[] = [];
  while (true) {
    const paths = findTrailsConfigPaths(current);
    if (paths.length > 1) {
      throw new ValidationError(
        `Multiple Trails config files found: ${paths.join(', ')}. Keep one config file per project root.`
      );
    }
    if (paths[0] !== undefined) {
      found.push(paths[0]);
    }
    if (current === boundary) {
      return found;
    }
    const parent = dirname(current);
    if (parent === current) {
      return found;
    }
    current = parent;
  }
};

export const collectConfigPathsWithinBoundary = (
  boundaryDir: string
): readonly string[] => {
  const collection = collectSourceTree(boundaryDir, {
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
      { context: { boundaryDir } }
    );
  }
  const uncertain = collection.skipped.filter((entry) =>
    entry.reason.startsWith('unreadable-')
  );
  if (uncertain.length > 0) {
    throw new ValidationError(
      `Unable to prove static project identity inside "${boundaryDir}" because collection evidence is unreadable.`,
      { context: { boundaryDir, skipped: uncertain } }
    );
  }
  const paths = collection.files.map((file) => file.absolutePath);
  validateOneConfigPerDirectory(paths);
  return paths;
};

export const combineConfigPaths = (
  collectedPaths: readonly string[],
  selectedPaths: readonly string[]
): readonly string[] => {
  const locatedPaths = [...new Set([...collectedPaths, ...selectedPaths])];
  validateOneConfigPerDirectory(locatedPaths);
  return locatedPaths;
};
