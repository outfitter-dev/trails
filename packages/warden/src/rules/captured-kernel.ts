import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  extractStringLiteral,
  getNodeDeclaration,
  getNodeImportKind,
  getNodeLocal,
  getNodeSource,
  getNodeSpecifiers,
  identifierName,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isImportDeclaration,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type { WardenImportResolution } from '../resolve.js';
import type { WardenPublicWorkspace } from '../workspaces.js';
import { hasIgnoreCommentOnLine, splitSourceLines } from './source/pragmas.js';
import { isTestFile } from './scan.js';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'captured-kernel';

interface InternalReExportSite {
  readonly importSource: string;
  readonly line: number;
  readonly resolutionLine: number;
}

interface ImportedBindingSite {
  readonly importSource: string;
  readonly resolutionLine: number;
}

interface ExportTarget {
  readonly specifier: string;
  readonly workspace: WardenPublicWorkspace;
}

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const pathIsInside = (filePath: string, rootDir: string): boolean => {
  const absoluteFilePath = normalizeRealPath(filePath);
  const absoluteRootDir = normalizeRealPath(rootDir);
  return (
    absoluteFilePath === absoluteRootDir ||
    absoluteFilePath.startsWith(`${absoluteRootDir}/`)
  );
};

const sourcePackageNameForFile = (
  filePath: string,
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): string | undefined => {
  for (const workspace of workspaces.values()) {
    if (pathIsInside(filePath, workspace.rootDir)) {
      return workspace.name;
    }
  }
  return undefined;
};

const exportTargetsForFile = (
  filePath: string,
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): readonly ExportTarget[] => {
  const normalizedFilePath = normalizeRealPath(filePath);
  const targets: ExportTarget[] = [];
  for (const workspace of workspaces.values()) {
    for (const [specifier, target] of Object.entries(
      workspace.exportTargets ?? {}
    )) {
      if (specifier === workspace.name) {
        continue;
      }
      if (normalizeRealPath(target) === normalizedFilePath) {
        targets.push({ specifier, workspace });
      }
    }
  }
  return targets.toSorted((left, right) =>
    left.specifier.localeCompare(right.specifier)
  );
};

const collectReExportSites = (
  sourceCode: string,
  filePath: string
): readonly InternalReExportSite[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  const sites: InternalReExportSite[] = [];
  const importedBindings = new Map<string, ImportedBindingSite>();
  walk(ast, (node) => {
    if (!isImportDeclaration(node)) {
      return;
    }
    if (getNodeImportKind(node) === 'type') {
      return;
    }
    const value = extractStringLiteral(getNodeSource(node));
    if (typeof value !== 'string') {
      return;
    }
    const resolutionLine = offsetToLine(sourceCode, node.start);
    for (const specifier of getNodeSpecifiers(node) ?? []) {
      if (getNodeImportKind(specifier) === 'type') {
        continue;
      }
      const localName = identifierName(getNodeLocal(specifier));
      if (localName !== null) {
        importedBindings.set(localName, {
          importSource: value,
          resolutionLine,
        });
      }
    }
  });

  const siteKeys = new Set<string>();
  const addSite = (site: InternalReExportSite): void => {
    const key = `${site.importSource}:${site.line}:${site.resolutionLine}`;
    if (!siteKeys.has(key)) {
      siteKeys.add(key);
      sites.push(site);
    }
  };
  walk(ast, (node) => {
    if (isExportDefaultDeclaration(node)) {
      const localName = identifierName(getNodeDeclaration(node));
      if (localName === null) {
        return;
      }
      const imported = importedBindings.get(localName);
      if (imported !== undefined) {
        addSite({
          ...imported,
          line: offsetToLine(sourceCode, node.start),
        });
      }
      return;
    }

    if (
      node.type !== 'ExportNamedDeclaration' &&
      node.type !== 'ExportAllDeclaration'
    ) {
      return;
    }

    const line = offsetToLine(sourceCode, node.start);
    const value = extractStringLiteral(getNodeSource(node));
    if (typeof value === 'string') {
      addSite({ importSource: value, line, resolutionLine: line });
      return;
    }

    if (!isExportNamedDeclaration(node)) {
      return;
    }
    for (const specifier of getNodeSpecifiers(node) ?? []) {
      const localName = identifierName(getNodeLocal(specifier));
      if (localName === null) {
        continue;
      }
      const imported = importedBindings.get(localName);
      if (imported !== undefined) {
        addSite({ ...imported, line });
      }
    }
  });
  return sites.toSorted((left, right) => left.line - right.line);
};

const importResolutionsForFile = (
  context: ProjectContext,
  filePath: string
): readonly WardenImportResolution[] =>
  context.importResolutionsByFile?.get(filePath) ?? [];

const reExportResolution = (
  resolutions: readonly WardenImportResolution[],
  site: InternalReExportSite
): WardenImportResolution | undefined =>
  resolutions.find(
    (resolution) =>
      resolution.importSource === site.importSource &&
      resolution.line === site.resolutionLine
  );

const isOwnedInternalReExport = (
  workspace: WardenPublicWorkspace,
  resolution: WardenImportResolution | undefined
): boolean => {
  if (!resolution?.isInternalTarget) {
    return false;
  }
  if (resolution.packageName === workspace.name) {
    return true;
  }
  if (
    resolution.packageRoot &&
    normalizeRealPath(resolution.packageRoot) ===
      normalizeRealPath(workspace.rootDir)
  ) {
    return true;
  }
  return resolution.resolvedPath
    ? pathIsInside(resolution.resolvedPath, workspace.rootDir)
    : false;
};

const isNonProductionEvidenceFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return (
    isTestFile(filePath) ||
    /(?:^|\/)(?:__fixtures__|fixtures?|migrations?|historical|changelogs?|changesets?|agent-notes?)(?:\/|$)/.test(
      normalized
    ) ||
    /(?:^|\/)\.(?:changeset|agents)(?:\/|$)/.test(normalized) ||
    /(?:^|\/)(?:CHANGELOG|changeset)\.md$/i.test(normalized)
  );
};

const externalProductionConsumerPackages = ({
  context,
  exportSpecifier,
  hostPackage,
  workspaces,
}: {
  readonly context: ProjectContext;
  readonly exportSpecifier: string;
  readonly hostPackage: string;
  readonly workspaces: ReadonlyMap<string, WardenPublicWorkspace>;
}): readonly string[] => {
  const consumers = new Set<string>();
  for (const resolutions of context.importResolutionsByFile?.values() ?? []) {
    for (const resolution of resolutions) {
      if (resolution.importSource !== exportSpecifier) {
        continue;
      }
      if (resolution.errorKind || !resolution.usesPublicExport) {
        continue;
      }
      if (!resolution.crossesPackageBoundary) {
        continue;
      }
      if (resolution.packageName !== hostPackage) {
        continue;
      }
      if (isNonProductionEvidenceFile(resolution.importerPath)) {
        continue;
      }

      const sourcePackageName = sourcePackageNameForFile(
        resolution.importerPath,
        workspaces
      );
      if (!sourcePackageName || sourcePackageName === hostPackage) {
        continue;
      }
      consumers.add(sourcePackageName);
    }
  }
  return [...consumers].toSorted();
};

const diagnosticMessage = ({
  consumers,
  exportSpecifier,
  hostPackage,
  importSource,
}: {
  readonly consumers: readonly string[];
  readonly exportSpecifier: string;
  readonly hostPackage: string;
  readonly importSource: string;
}): string =>
  `${hostPackage} export target "${exportSpecifier}" re-exports internal target "${importSource}" and is consumed by external production packages ${consumers.join(
    ', '
  )}. Review ownership of the exported subpath and its captured kernel before it becomes a durable public seam.`;

export const capturedKernel: ProjectAwareWardenRule = {
  check(): readonly WardenDiagnostic[] {
    return [];
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const workspaces = context.publicWorkspaces;
    if (!workspaces || workspaces.size === 0) {
      return [];
    }

    const exportTargets = exportTargetsForFile(filePath, workspaces);
    if (exportTargets.length === 0) {
      return [];
    }

    const lines = splitSourceLines(sourceCode);
    const resolutions = importResolutionsForFile(context, filePath);
    const diagnostics: WardenDiagnostic[] = [];

    for (const exportTarget of exportTargets) {
      const consumers = externalProductionConsumerPackages({
        context,
        exportSpecifier: exportTarget.specifier,
        hostPackage: exportTarget.workspace.name,
        workspaces,
      });
      if (consumers.length < 2) {
        continue;
      }

      for (const site of collectReExportSites(sourceCode, filePath)) {
        if (hasIgnoreCommentOnLine(lines, site.line)) {
          continue;
        }

        const resolution = reExportResolution(resolutions, site);
        if (!isOwnedInternalReExport(exportTarget.workspace, resolution)) {
          continue;
        }

        diagnostics.push({
          filePath,
          guidance: {
            steps: [
              'Review whether the public subpath should become an owned package surface, move back behind the package root, or be split into a better-owned package.',
              'If the imported capability is reusable source-code machinery, serves at least two independently owned toolchain capabilities, exposes one genuinely shared contract, and owns no verdict, migration plan, graph query, or surface rendering, consider relocating it to @ontrails/source.',
              'Otherwise, preserve the current owner or choose another doctrinal owner.',
            ],
            summary:
              'Review ownership before an internal re-exported kernel hardens into a public package seam.',
          },
          line: site.line,
          message: diagnosticMessage({
            consumers,
            exportSpecifier: exportTarget.specifier,
            hostPackage: exportTarget.workspace.name,
            importSource: site.importSource,
          }),
          rule: RULE_NAME,
          severity: 'warn',
        });
      }
    }

    return diagnostics;
  },
  description:
    'Flag public subpath exports that capture internal kernels after multiple production packages consume them.',
  name: RULE_NAME,
  severity: 'warn',
};
