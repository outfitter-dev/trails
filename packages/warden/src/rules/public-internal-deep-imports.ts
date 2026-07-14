import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { matchesPathGlob } from '@ontrails/core';

import { hasIgnoreCommentOnLine, splitSourceLines } from './source/pragmas.js';
import {
  extractStringLiteral,
  getNodeSource,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';
import type { WardenImportResolution } from '../resolve.js';
import type { WardenPublicWorkspace } from '../workspaces.js';

const RULE_NAME = 'public-internal-deep-imports';
const ONTRAILS_SPECIFIER_PATTERN = /^(@ontrails\/[^/]+)(?:\/(.+))?$/;
const ROOT_BARREL_INTERNAL_RE_EXPORT_ALLOWLIST = new Set<string>();

interface ReExportSite {
  readonly importSource: string;
  readonly line: number;
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

const packageNameFromSpecifier = (specifier: string): string | undefined => {
  const match = ONTRAILS_SPECIFIER_PATTERN.exec(specifier);
  return match?.[1];
};

const specifierHasSubpath = (specifier: string): boolean =>
  Boolean(ONTRAILS_SPECIFIER_PATTERN.exec(specifier)?.[2]);

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

const importResolutionsForFile = (
  context: ProjectContext,
  filePath: string
): readonly WardenImportResolution[] =>
  context.importResolutionsByFile?.get(filePath) ?? [];

const documentedImportResolutionsForFile = (
  context: ProjectContext,
  filePath: string
): readonly WardenImportResolution[] =>
  context.documentedImportResolutionsByFile?.get(filePath) ?? [];

const diagnosticMessage = (
  resolution: WardenImportResolution,
  packageName: string
): string => {
  if (resolution.errorKind === 'not-found') {
    return `@ontrails specifier "${resolution.importSource}" could not be resolved from the public workspace package ${packageName}. Use the package root, an exported subpath, or the package binary when the package is bin-only.`;
  }

  return (
    `@ontrails specifier "${resolution.importSource}" is not exported by ${packageName}. ` +
    'Use the package root or an exported subpath; if the API is missing, add an owner export follow-up instead of importing internals.'
  );
};

const shouldReportResolution = (
  resolution: WardenImportResolution,
  workspace: WardenPublicWorkspace,
  sourcePackageName: string | undefined,
  isDocumentation: boolean
): boolean => {
  if (!isDocumentation && sourcePackageName === workspace.name) {
    return false;
  }

  if (resolution.errorKind === 'package-path-not-exported') {
    return true;
  }

  if (resolution.errorKind === 'not-found') {
    return isDocumentation
      ? specifierHasSubpath(resolution.importSource)
      : resolution.importSource === workspace.name ||
          specifierHasSubpath(resolution.importSource);
  }

  if (isDocumentation && specifierHasSubpath(resolution.importSource)) {
    return !resolution.usesPublicExport;
  }

  return false;
};

const diagnosticsForResolutions = ({
  context,
  filePath,
  isDocumentation,
  sourceCode,
}: {
  readonly context: ProjectContext;
  readonly filePath: string;
  readonly isDocumentation: boolean;
  readonly sourceCode: string;
}): readonly WardenDiagnostic[] => {
  const workspaces = context.publicWorkspaces;
  if (!workspaces || workspaces.size === 0) {
    return [];
  }

  const sourcePackageName = sourcePackageNameForFile(filePath, workspaces);
  const lines = splitSourceLines(sourceCode);
  const resolutions = isDocumentation
    ? documentedImportResolutionsForFile(context, filePath)
    : importResolutionsForFile(context, filePath);
  const diagnostics: WardenDiagnostic[] = [];

  for (const resolution of resolutions) {
    if (hasIgnoreCommentOnLine(lines, resolution.line)) {
      continue;
    }

    const packageName =
      resolution.packageName ??
      packageNameFromSpecifier(resolution.importSource);
    const workspace = packageName ? workspaces.get(packageName) : undefined;
    if (!packageName || !workspace) {
      continue;
    }

    if (
      shouldReportResolution(
        resolution,
        workspace,
        sourcePackageName,
        isDocumentation
      )
    ) {
      diagnostics.push({
        filePath,
        line: resolution.line,
        message: diagnosticMessage(resolution, packageName),
        rule: RULE_NAME,
        severity: 'error',
      });
    }
  }

  return diagnostics;
};

const isRootBarrel = (
  filePath: string,
  workspace: WardenPublicWorkspace
): boolean => {
  const rootExportTarget = workspace.exportTargets?.[workspace.name];
  if (rootExportTarget) {
    return normalizeRealPath(filePath) === rootExportTarget;
  }
  return (
    normalizeRealPath(filePath) ===
    normalizeRealPath(resolve(workspace.rootDir, 'src/index.ts'))
  );
};

const rootBarrelWorkspace = (
  filePath: string,
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): WardenPublicWorkspace | undefined => {
  for (const workspace of workspaces.values()) {
    if (isRootBarrel(filePath, workspace)) {
      return workspace;
    }
  }
  return undefined;
};

const collectReExportSites = (
  sourceCode: string,
  filePath: string
): readonly ReExportSite[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  const sites: ReExportSite[] = [];
  walk(ast, (node) => {
    if (
      node.type !== 'ExportNamedDeclaration' &&
      node.type !== 'ExportAllDeclaration'
    ) {
      return;
    }

    const source = getNodeSource(node);
    const value = extractStringLiteral(source);
    if (typeof value !== 'string') {
      return;
    }

    sites.push({
      importSource: value,
      line: offsetToLine(sourceCode, node.start),
    });
  });
  return sites;
};

const reExportResolution = (
  resolutions: readonly WardenImportResolution[],
  site: ReExportSite
): WardenImportResolution | undefined =>
  resolutions.find(
    (resolution) =>
      resolution.importSource === site.importSource &&
      resolution.line === site.line
  );

const isAllowlistedRootBarrelInternalExport = (
  workspace: WardenPublicWorkspace,
  importSource: string
): boolean =>
  ROOT_BARREL_INTERNAL_RE_EXPORT_ALLOWLIST.has(
    `${workspace.name}:${importSource}`
  );

const rootBarrelDiagnostics = (
  sourceCode: string,
  filePath: string,
  context: ProjectContext
): readonly WardenDiagnostic[] => {
  const workspaces = context.publicWorkspaces;
  if (!workspaces || workspaces.size === 0) {
    return [];
  }

  const workspace = rootBarrelWorkspace(filePath, workspaces);
  if (!workspace) {
    return [];
  }

  const resolutions = importResolutionsForFile(context, filePath);
  const lines = splitSourceLines(sourceCode);
  const diagnostics: WardenDiagnostic[] = [];
  for (const site of collectReExportSites(sourceCode, filePath)) {
    if (isAllowlistedRootBarrelInternalExport(workspace, site.importSource)) {
      continue;
    }
    if (hasIgnoreCommentOnLine(lines, site.line)) {
      continue;
    }

    const resolution = reExportResolution(resolutions, site);
    if (!resolution?.isInternalTarget) {
      continue;
    }

    diagnostics.push({
      filePath,
      line: site.line,
      message:
        `${workspace.name} root barrel re-exports internal target "${site.importSource}". ` +
        'Move the symbol behind an explicit public module or keep it private to the package.',
      rule: RULE_NAME,
      severity: 'error',
    });
  }

  return diagnostics;
};

const stripLeadingDotSlash = (path: string): string =>
  path.startsWith('./') ? path.slice(2) : path;

const filePatternCovers = (filePath: string, pattern: string): boolean => {
  const normalizedFilePath = normalizePath(stripLeadingDotSlash(filePath));
  const normalizedPattern = normalizePath(stripLeadingDotSlash(pattern));
  if (normalizedPattern.startsWith('!')) {
    return false;
  }
  if (normalizedPattern === normalizedFilePath) {
    return true;
  }
  if (normalizedPattern === '**') {
    return true;
  }
  if (!normalizedPattern.includes('*') && !normalizedPattern.includes('?')) {
    return normalizedFilePath.startsWith(`${normalizedPattern}/`);
  }
  return matchesPathGlob(normalizedFilePath, normalizedPattern);
};

const filesCoverTarget = (
  files: readonly string[] | undefined,
  target: string
): boolean => {
  if (!files || files.length === 0) {
    return true;
  }
  let covered = false;
  for (const pattern of files) {
    const normalizedPattern = normalizePath(stripLeadingDotSlash(pattern));
    if (normalizedPattern.startsWith('!')) {
      if (filePatternCovers(target, normalizedPattern.slice(1))) {
        covered = false;
      }
      continue;
    }
    if (filePatternCovers(target, normalizedPattern)) {
      covered = true;
    }
  }
  return covered;
};

const workspaceForPackageJson = (
  filePath: string,
  workspaces: ReadonlyMap<string, WardenPublicWorkspace>
): WardenPublicWorkspace | undefined => {
  const normalizedFilePath = normalizeRealPath(filePath);
  for (const workspace of workspaces.values()) {
    if (normalizePath(workspace.packageJsonPath) === normalizedFilePath) {
      return workspace;
    }
  }
  return undefined;
};

const binSurfaceDiagnostics = (
  filePath: string,
  context: ProjectContext
): readonly WardenDiagnostic[] => {
  if (
    !filePath.endsWith(`${sep}package.json`) &&
    !filePath.endsWith('/package.json')
  ) {
    return [];
  }

  const workspaces = context.publicWorkspaces;
  if (!workspaces || workspaces.size === 0) {
    return [];
  }

  const workspace = workspaceForPackageJson(filePath, workspaces);
  if (!workspace) {
    return [];
  }

  const diagnostics: WardenDiagnostic[] = [];
  const binEntries = Object.entries(workspace.bin ?? {});
  if (!workspace.hasExports && binEntries.length === 0) {
    diagnostics.push({
      filePath,
      line: 1,
      message:
        `Public workspace ${workspace.name} has no exports map and no bin surface. ` +
        'Add an exports map for library APIs or declare the package binary surface explicitly.',
      rule: RULE_NAME,
      severity: 'error',
    });
  }

  for (const [binName, target] of binEntries) {
    const targetPath = resolve(workspace.rootDir, target);
    if (!existsSync(targetPath)) {
      diagnostics.push({
        filePath,
        line: 1,
        message: `Bin "${binName}" for ${workspace.name} points at missing file ${target}.`,
        rule: RULE_NAME,
        severity: 'error',
      });
    }

    if (!filesCoverTarget(workspace.files, target)) {
      diagnostics.push({
        filePath,
        line: 1,
        message:
          `Bin "${binName}" for ${workspace.name} points at ${target}, ` +
          'but the package files list does not include that target.',
        rule: RULE_NAME,
        severity: 'error',
      });
    }
  }

  return diagnostics;
};

export const publicInternalDeepImports: ProjectAwareWardenRule = {
  check(): readonly WardenDiagnostic[] {
    return [];
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    if (filePath.endsWith('.md')) {
      return diagnosticsForResolutions({
        context,
        filePath,
        isDocumentation: true,
        sourceCode,
      });
    }

    return [
      ...diagnosticsForResolutions({
        context,
        filePath,
        isDocumentation: false,
        sourceCode,
      }),
      ...rootBarrelDiagnostics(sourceCode, filePath, context),
      ...binSurfaceDiagnostics(filePath, context),
    ];
  },
  description:
    'Keep @ontrails/* imports, docs specifiers, root barrels, and bin-only surfaces aligned with public package exports.',
  name: RULE_NAME,
  severity: 'error',
};
