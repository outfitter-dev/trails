/**
 * Project-context helpers shared by the Warden runner and resolver-backed
 * rules.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  collectImportResolutionsForFile,
  createWardenResolver,
  normalizePath,
} from './resolve.js';
import type {
  WardenImportResolution,
  WardenResolverOptions,
} from './resolve.js';

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const setResolutionsForFile = (
  resolutionsByFile: Map<string, readonly WardenImportResolution[]>,
  sourceFilePath: string,
  resolutions: readonly WardenImportResolution[]
): void => {
  const normalizedFilePath =
    resolutions[0]?.importerPath ?? normalizeRealPath(sourceFilePath);
  resolutionsByFile.set(normalizedFilePath, resolutions);
  if (normalizedFilePath !== sourceFilePath) {
    resolutionsByFile.set(sourceFilePath, resolutions);
  }
};

export interface WardenProjectContextSourceFile {
  readonly filePath: string;
  readonly kind: 'text' | 'typescript';
  readonly sourceCode: string;
}

export const collectProjectImportResolutions = ({
  resolveOptions,
  rootDir,
  sourceFiles,
}: {
  readonly resolveOptions?: WardenResolverOptions['resolveOptions'];
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenImportResolution[]> => {
  const resolver = createWardenResolver({ resolveOptions, rootDir });
  const resolutionsByFile = new Map<
    string,
    readonly WardenImportResolution[]
  >();

  for (const sourceFile of sourceFiles) {
    if (sourceFile.kind !== 'typescript') {
      continue;
    }
    const resolutions = collectImportResolutionsForFile({
      filePath: sourceFile.filePath,
      resolver,
      sourceCode: sourceFile.sourceCode,
    });
    if (resolutions.length > 0) {
      setResolutionsForFile(
        resolutionsByFile,
        sourceFile.filePath,
        resolutions
      );
    }
  }

  return resolutionsByFile;
};
