import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractStringLiteral,
  identifierName,
  offsetToLine,
  parse,
  walk,
} from './ast.js';
import type { AstNode } from './ast.js';
import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'public-internal-deep-imports';
const WORKSPACE_ROOT = resolve(
  fileURLToPath(new URL('../../../../', import.meta.url))
);
const ONTRAILS_SPECIFIER_PATTERN = /^(@ontrails\/[^/]+)(?:\/(.+))?$/;

interface ExportPattern {
  readonly prefix: string;
  readonly suffix: string;
}

interface WorkspacePackage {
  readonly exportedSpecifiers: ReadonlySet<string>;
  readonly name: string;
  readonly patterns: readonly ExportPattern[];
  readonly rootDir: string;
}

interface PackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly workspaces?: unknown;
}

interface ImportSite {
  readonly node: AstNode;
  readonly specifier: string;
}

/**
 * Workspace package metadata is stable during a normal Warden run, so cache it
 * once per process instead of re-reading every package manifest for each file.
 *
 * Long-running callers that mutate manifests or workspace layout between runs
 * should call `clearPublicInternalDeepImportsCache()` before checking again.
 */
let workspacePackagesCache: ReadonlyMap<string, WorkspacePackage> | undefined;

export const clearPublicInternalDeepImportsCache = (): void => {
  workspacePackagesCache = undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readPackageManifest = (
  packageDir: string
): PackageManifest | undefined => {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return undefined;
  }
};

const exportKeys = (exportsValue: unknown): readonly string[] => {
  if (!isRecord(exportsValue)) {
    return [];
  }
  return Object.keys(exportsValue).filter((key) => key.startsWith('.'));
};

const exportPatternFromKey = (
  packageName: string,
  key: string
): ExportPattern | undefined => {
  if (!key.includes('*')) {
    return undefined;
  }
  const subpath = key.slice(2);
  const [prefix = '', suffix = ''] = subpath.split('*');
  return {
    prefix: `${packageName}/${prefix}`,
    suffix,
  };
};

const exportedSpecifierFromKey = (
  packageName: string,
  key: string
): string | undefined => {
  if (key === '.') {
    return packageName;
  }
  if (key.includes('*')) {
    return undefined;
  }
  if (!key.startsWith('./')) {
    return undefined;
  }
  return `${packageName}/${key.slice(2)}`;
};

const buildWorkspacePackage = (
  packageDir: string,
  manifest: PackageManifest
): WorkspacePackage | undefined => {
  if (typeof manifest.name !== 'string') {
    return undefined;
  }
  if (!manifest.name.startsWith('@ontrails/')) {
    return undefined;
  }

  const exportedSpecifiers = new Set<string>([manifest.name]);
  const patterns: ExportPattern[] = [];
  for (const key of exportKeys(manifest.exports)) {
    const exactSpecifier = exportedSpecifierFromKey(manifest.name, key);
    if (exactSpecifier) {
      exportedSpecifiers.add(exactSpecifier);
      continue;
    }
    const pattern = exportPatternFromKey(manifest.name, key);
    if (pattern) {
      patterns.push(pattern);
    }
  }

  return {
    exportedSpecifiers,
    name: manifest.name,
    patterns,
    rootDir: resolve(packageDir),
  };
};

const workspacePatterns = (): readonly string[] => {
  const rootManifest = readPackageManifest(WORKSPACE_ROOT);
  const { workspaces } = rootManifest ?? {};
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }
  const workspacePackages = isRecord(workspaces)
    ? workspaces['packages']
    : undefined;
  if (Array.isArray(workspacePackages)) {
    return workspacePackages.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }
  return [];
};

const packageDirsForPattern = (pattern: string): readonly string[] => {
  if (!pattern.endsWith('/*')) {
    const packageDir = join(WORKSPACE_ROOT, pattern);
    return existsSync(packageDir) ? [packageDir] : [];
  }

  const groupDir = join(WORKSPACE_ROOT, pattern.slice(0, -2));
  if (!existsSync(groupDir)) {
    return [];
  }
  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name))
    .toSorted();
};

const collectWorkspacePackages = (): ReadonlyMap<string, WorkspacePackage> => {
  const workspacePackages = new Map<string, WorkspacePackage>();

  for (const packageDir of workspacePatterns().flatMap(packageDirsForPattern)) {
    const manifest = readPackageManifest(packageDir);
    if (!manifest) {
      continue;
    }
    const workspacePackage = buildWorkspacePackage(packageDir, manifest);
    if (workspacePackage) {
      workspacePackages.set(workspacePackage.name, workspacePackage);
    }
  }

  return workspacePackages;
};

const getWorkspacePackages = (): ReadonlyMap<string, WorkspacePackage> => {
  workspacePackagesCache ??= collectWorkspacePackages();
  return workspacePackagesCache;
};

const pathIsInside = (filePath: string, rootDir: string): boolean => {
  const absoluteFilePath = resolve(filePath);
  const absoluteRootDir = resolve(rootDir);
  return (
    absoluteFilePath === absoluteRootDir ||
    absoluteFilePath.startsWith(`${absoluteRootDir}${sep}`)
  );
};

const sourcePackageNameForFile = (
  filePath: string,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>
): string | undefined => {
  for (const workspacePackage of workspacePackages.values()) {
    if (pathIsInside(filePath, workspacePackage.rootDir)) {
      return workspacePackage.name;
    }
  }
  return undefined;
};

const matchesExportPattern = (
  specifier: string,
  pattern: ExportPattern
): boolean => {
  if (!specifier.startsWith(pattern.prefix)) {
    return false;
  }
  if (!specifier.endsWith(pattern.suffix)) {
    return false;
  }

  const wildcardEnd =
    pattern.suffix.length === 0
      ? specifier.length
      : specifier.length - pattern.suffix.length;
  const wildcardSegment = specifier.slice(pattern.prefix.length, wildcardEnd);
  return wildcardSegment.length > 0 && !wildcardSegment.includes('/');
};

export const __matchesExportPatternForTest = (
  specifier: string,
  pattern: { readonly prefix: string; readonly suffix: string }
): boolean => matchesExportPattern(specifier, pattern);

const isExportedSpecifier = (
  specifier: string,
  workspacePackage: WorkspacePackage
): boolean => {
  if (workspacePackage.exportedSpecifiers.has(specifier)) {
    return true;
  }
  return workspacePackage.patterns.some((pattern) =>
    matchesExportPattern(specifier, pattern)
  );
};

const sourceFromModuleNode = (node: AstNode): string | null => {
  if (
    node.type === 'ExportAllDeclaration' ||
    node.type === 'ExportNamedDeclaration' ||
    node.type === 'ImportDeclaration' ||
    node.type === 'ImportExpression' ||
    node.type === 'TSImportType'
  ) {
    return extractStringLiteral(
      (node as unknown as { source?: AstNode }).source
    );
  }

  if (node.type !== 'CallExpression') {
    return null;
  }
  const { arguments: args, callee } = node as unknown as {
    arguments?: readonly AstNode[];
    callee?: AstNode;
  };
  if (identifierName(callee) !== 'require') {
    return null;
  }
  return extractStringLiteral(args?.[0]);
};

const collectImportSites = (ast: AstNode): readonly ImportSite[] => {
  const sites: ImportSite[] = [];
  walk(ast, (node) => {
    const specifier = sourceFromModuleNode(node);
    if (specifier) {
      sites.push({ node, specifier });
    }
  });
  return sites;
};

const packageNameFromSpecifier = (specifier: string): string | undefined => {
  const match = ONTRAILS_SPECIFIER_PATTERN.exec(specifier);
  return match?.[1];
};

const diagnosticForSite = (
  site: ImportSite,
  filePath: string,
  sourceCode: string,
  sourcePackageName: string | undefined,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>
): WardenDiagnostic | undefined => {
  const packageName = packageNameFromSpecifier(site.specifier);
  if (!packageName) {
    return undefined;
  }
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage) {
    return undefined;
  }
  if (sourcePackageName === packageName) {
    return undefined;
  }
  if (isExportedSpecifier(site.specifier, workspacePackage)) {
    return undefined;
  }

  return {
    filePath,
    line: offsetToLine(sourceCode, site.node.start),
    message:
      `${RULE_NAME}: cross-package import "${site.specifier}" is not exported by ${packageName}. ` +
      'Use the package root or an exported subpath; if the API is missing, add an owner export follow-up instead of importing internals.',
    rule: RULE_NAME,
    severity: 'error',
  };
};

export const publicInternalDeepImports: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const workspacePackages = getWorkspacePackages();
    if (workspacePackages.size === 0) {
      return [];
    }

    const sourcePackageName = sourcePackageNameForFile(
      filePath,
      workspacePackages
    );
    return collectImportSites(ast).flatMap((site) => {
      const diagnostic = diagnosticForSite(
        site,
        filePath,
        sourceCode,
        sourcePackageName,
        workspacePackages
      );
      return diagnostic ? [diagnostic] : [];
    });
  },
  description:
    'Disallow cross-package @ontrails/* deep imports that bypass the owner package exports map.',
  name: RULE_NAME,
  severity: 'error',
};
