import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { ValidationError } from '@ontrails/core';

export const isWithinBoundary = (
  boundaryDir: string,
  targetDir: string
): boolean => {
  const path = relative(boundaryDir, targetDir);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

/** Resolve symlinks in the existing prefix without requiring the leaf to exist. */
export const canonicalBoundaryPath = (path: string): string => {
  let existing = resolve(path);
  const missingSegments: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      throw new ValidationError(
        `Unable to resolve project discovery path "${path}" canonically.`,
        { context: { path } }
      );
    }
    missingSegments.unshift(basename(existing));
    existing = parent;
  }
  try {
    return resolve(realpathSync(existing), ...missingSegments);
  } catch (error) {
    throw new ValidationError(
      `Unable to resolve project discovery path "${path}" canonically.`,
      {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { path },
      }
    );
  }
};
