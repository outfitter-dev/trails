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
import { offsetToLine } from './rules/ast.js';
import { collectPublicWorkspaces } from './workspaces.js';
import type { WardenPublicWorkspace } from './workspaces.js';

const ONTRAILS_DOCUMENTATION_SPECIFIER_PATTERN =
  /@ontrails\/[a-z0-9-]+(?:\/[A-Za-z0-9._~-]+)+/g;

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
  readonly kind: 'documentation' | 'text' | 'typescript';
  readonly sourceCode: string;
}

const collectDocumentationImportSpecifiers = (
  sourceCode: string
): readonly { readonly importSource: string; readonly line: number }[] => {
  const specifiers: { importSource: string; line: number }[] = [];
  for (const match of sourceCode.matchAll(
    ONTRAILS_DOCUMENTATION_SPECIFIER_PATTERN
  )) {
    if (match.index === undefined) {
      continue;
    }
    specifiers.push({
      importSource: match[0],
      line: offsetToLine(sourceCode, match.index),
    });
  }
  return specifiers;
};

const exportAliasesForWorkspaces = (
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): Record<string, string[]> => {
  const aliases: Record<string, string[]> = {};
  for (const workspace of workspaces.values()) {
    for (const [specifier, target] of Object.entries(
      workspace.exportTargets ?? {}
    )) {
      aliases[`${specifier}$`] = [target];
    }
  }
  return aliases;
};

const resolveOptionsWithWorkspaceAliases = (
  publicWorkspaces: ReadonlyMap<string, WardenPublicWorkspace> | undefined,
  resolveOptions: WardenResolverOptions['resolveOptions'] | undefined
): WardenResolverOptions['resolveOptions'] => {
  if (!publicWorkspaces) {
    return resolveOptions;
  }

  const workspaceAliases = exportAliasesForWorkspaces(publicWorkspaces);
  return {
    ...resolveOptions,
    alias: {
      ...workspaceAliases,
      ...resolveOptions?.alias,
    },
  };
};

export const collectProjectImportResolutions = ({
  publicWorkspaces,
  resolveOptions,
  rootDir,
  sourceFiles,
}: {
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  readonly resolveOptions?: WardenResolverOptions['resolveOptions'];
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenImportResolution[]> => {
  const resolver = createWardenResolver({
    resolveOptions: resolveOptionsWithWorkspaceAliases(
      publicWorkspaces,
      resolveOptions
    ),
    rootDir,
  });
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

export const collectProjectDocumentationImportResolutions = ({
  publicWorkspaces: providedPublicWorkspaces,
  rootDir,
  sourceFiles,
}: {
  readonly publicWorkspaces?: ReadonlyMap<string, WardenPublicWorkspace>;
  readonly rootDir: string;
  readonly sourceFiles: readonly WardenProjectContextSourceFile[];
}): ReadonlyMap<string, readonly WardenImportResolution[]> => {
  const publicWorkspaces =
    providedPublicWorkspaces ?? collectPublicWorkspaces(rootDir);
  const resolver = createWardenResolver({
    resolveOptions: { alias: exportAliasesForWorkspaces(publicWorkspaces) },
    rootDir,
  });
  const resolutionsByFile = new Map<
    string,
    readonly WardenImportResolution[]
  >();

  for (const sourceFile of sourceFiles) {
    if (sourceFile.kind !== 'documentation') {
      continue;
    }
    const resolutions = collectDocumentationImportSpecifiers(
      sourceFile.sourceCode
    ).map((specifier) =>
      resolver.resolveImport(
        sourceFile.filePath,
        specifier.importSource,
        specifier.line
      )
    );
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

export { collectPublicWorkspaces };
export type { WardenPublicWorkspace } from './workspaces.js';
