/**
 * Public Warden resolver helper surface.
 *
 * These helpers wrap `oxc-resolver` behind Warden-owned import-resolution
 * facts so rules never depend on resolver binding internals directly.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { ResolverFactory } from 'oxc-resolver';
import type { NapiResolveOptions, ResolveResult } from 'oxc-resolver';

import {
  getNodeArguments,
  getNodeCallee,
  getNodeName,
  getNodeSource,
  getStringValue,
  isStringLiteral,
  offsetToLine,
  parse,
  walk,
} from './rules/ast.js';
import type { AstNode } from './rules/ast.js';

export const wardenImportResolutionErrorKinds = [
  'builtin',
  'ignored',
  'not-found',
  'package-path-not-exported',
  'other',
] as const;

export type WardenImportResolutionErrorKind =
  (typeof wardenImportResolutionErrorKinds)[number];

export interface WardenImportResolution {
  readonly importerPath: string;
  readonly importSource: string;
  readonly line: number;
  readonly resolvedPath?: string | undefined;
  readonly packageName?: string | undefined;
  readonly packageRoot?: string | undefined;
  readonly crossesPackageBoundary: boolean;
  /**
   * True when a bare package specifier resolves successfully while the target
   * package declares an exports map. This is a coarse resolver fact; it does
   * not prove the resolved file matched a specific export entry.
   */
  readonly usesPublicExport: boolean;
  /**
   * True when a resolved file lands inside an internal/private package path.
   * Export-map-blocked internal specifiers do not have a resolved file path;
   * combine this with errorKind/importSource checks when guarding specifiers.
   */
  readonly isInternalTarget: boolean;
  readonly errorKind?: WardenImportResolutionErrorKind | undefined;
  readonly errorMessage?: string | undefined;
  readonly builtinModule?: string | undefined;
}

export interface WardenImportSpecifier {
  readonly importSource: string;
  readonly line: number;
}

export interface WardenResolverOptions {
  readonly rootDir?: string | undefined;
  readonly resolveOptions?: NapiResolveOptions | undefined;
}

export interface WardenProjectResolver {
  readonly rootDir: string;
  readonly resolveOptions: NapiResolveOptions;
  clearCache(): void;
  resolveImport(
    importerPath: string,
    importSource: string,
    line?: number
  ): WardenImportResolution;
}

interface PackageInfo {
  readonly name?: string | undefined;
  readonly packageJsonPath: string;
  readonly root: string;
  readonly exports?: unknown;
}

const conditionNames = ['bun', 'node', 'import', 'default'] as const;
export const packagePathNotExportedErrorFragment =
  'is not exported under the conditions';

export const defaultWardenResolveOptions = {
  builtinModules: true,
  conditionNames: [...conditionNames],
  extensionAlias: {
    '.cjs': ['.cts', '.cjs'],
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
  },
  extensions: [
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
  ],
  moduleType: true,
  symlinks: true,
  tsconfig: 'auto',
} satisfies NapiResolveOptions;

export const normalizePath = (path: string): string =>
  path.replaceAll('\\', '/');

const mergeStringLists = (
  base: readonly string[] = [],
  override: readonly string[] = []
): string[] => [...new Set([...base, ...override])];

const mergeExtensionAlias = (
  base: NonNullable<NapiResolveOptions['extensionAlias']>,
  override: NapiResolveOptions['extensionAlias'] | undefined
): NonNullable<NapiResolveOptions['extensionAlias']> => {
  const merged: Record<string, string[]> = Object.fromEntries(
    Object.entries(base).map(([extension, aliases]) => [
      extension,
      [...aliases],
    ])
  );

  for (const [extension, aliases] of Object.entries(override ?? {})) {
    merged[extension] = mergeStringLists(merged[extension], aliases);
  }

  return merged;
};

const mergeWardenResolveOptions = (
  overrides: NapiResolveOptions | undefined
): NapiResolveOptions => ({
  ...defaultWardenResolveOptions,
  ...overrides,
  conditionNames: mergeStringLists(
    defaultWardenResolveOptions.conditionNames,
    overrides?.conditionNames
  ),
  extensionAlias: mergeExtensionAlias(
    defaultWardenResolveOptions.extensionAlias,
    overrides?.extensionAlias
  ),
  extensions: mergeStringLists(
    defaultWardenResolveOptions.extensions,
    overrides?.extensions
  ),
});

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const readPackageJson = (
  packageJsonPath: string
): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const packageInfoFromPackageJson = (
  packageJsonPath: string
): PackageInfo | null => {
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  const json = readPackageJson(packageJsonPath);
  if (!json) {
    return null;
  }
  const root = normalizeRealPath(dirname(packageJsonPath));
  return {
    ...(json['exports'] === undefined ? {} : { exports: json['exports'] }),
    ...(typeof json['name'] === 'string' ? { name: json['name'] } : {}),
    packageJsonPath: normalizeRealPath(packageJsonPath),
    root,
  };
};

const findNearestPackageJson = (fromPath: string): string | null => {
  let dir = dirname(resolve(fromPath));
  while (true) {
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

const findPackageInfoForPath = (path: string): PackageInfo | null => {
  const packageJsonPath = findNearestPackageJson(path);
  return packageJsonPath ? packageInfoFromPackageJson(packageJsonPath) : null;
};

const parseBarePackageName = (specifier: string): string | null => {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.startsWith('node:') ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
  ) {
    return null;
  }

  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    const [scope, name] = parts;
    return scope && name ? `${scope}/${name}` : null;
  }
  return parts[0] ?? null;
};

const packageSpecifierParts = (
  specifier: string
): { readonly packageName: string; readonly subpath: string } | null => {
  const packageName = parseBarePackageName(specifier);
  if (!packageName) {
    return null;
  }
  const suffix = specifier.slice(packageName.length);
  return {
    packageName,
    subpath: suffix.length === 0 ? '.' : `.${suffix}`,
  };
};

const findNodeModulesPackageInfo = (
  importerPath: string,
  packageName: string
): PackageInfo | null => {
  const packageSegments = packageName.split('/');
  let dir = dirname(resolve(importerPath));
  while (true) {
    const packageJsonPath = join(
      dir,
      'node_modules',
      ...packageSegments,
      'package.json'
    );
    const info = packageInfoFromPackageJson(packageJsonPath);
    if (info) {
      return info;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
};

const hasExportsMap = (info: PackageInfo | null): boolean =>
  info?.exports !== undefined;

const classifyResolverError = (
  error: string
): WardenImportResolutionErrorKind => {
  if (error.includes(packagePathNotExportedErrorFragment)) {
    return 'package-path-not-exported';
  }
  if (error.includes('ignored')) {
    return 'ignored';
  }
  if (error.includes('not found') || error.includes('Cannot find')) {
    return 'not-found';
  }
  return 'other';
};

const isInternalTargetPath = (
  packageRoot: string | undefined,
  resolvedPath: string | undefined
): boolean => {
  if (!packageRoot || !resolvedPath) {
    return false;
  }
  const relativePath = normalizePath(relative(packageRoot, resolvedPath));
  return /(?:^|\/)(?:src\/)?(?:internal|private|_internal|_private)(?:\/|$)/.test(
    relativePath
  );
};

const resolveResultPackageInfo = (
  result: ResolveResult
): PackageInfo | null => {
  if (result.packageJsonPath) {
    return packageInfoFromPackageJson(result.packageJsonPath);
  }
  if (result.path) {
    return findPackageInfoForPath(result.path);
  }
  return null;
};

const resolveErrorKind = (
  errorMessage: string | undefined,
  builtinModule: string | undefined
): WardenImportResolutionErrorKind | undefined => {
  if (errorMessage) {
    return classifyResolverError(errorMessage);
  }
  return builtinModule ? 'builtin' : undefined;
};

const optionalResolutionFields = ({
  builtinModule,
  errorKind,
  errorMessage,
  packageName,
  packageRoot,
  resolvedPath,
}: {
  readonly builtinModule: string | undefined;
  readonly errorKind: WardenImportResolutionErrorKind | undefined;
  readonly errorMessage: string | undefined;
  readonly packageName: string | undefined;
  readonly packageRoot: string | undefined;
  readonly resolvedPath: string | undefined;
}): Partial<WardenImportResolution> => ({
  ...(builtinModule ? { builtinModule } : {}),
  ...(errorKind ? { errorKind } : {}),
  ...(errorMessage ? { errorMessage } : {}),
  ...(packageName ? { packageName } : {}),
  ...(packageRoot ? { packageRoot } : {}),
  ...(resolvedPath ? { resolvedPath } : {}),
});

const buildResolution = ({
  importSource,
  importerPath,
  line,
  result,
}: {
  readonly importSource: string;
  readonly importerPath: string;
  readonly line: number;
  readonly result: ResolveResult;
}): WardenImportResolution => {
  const normalizedImporter = normalizeRealPath(importerPath);
  const importerInfo = findPackageInfoForPath(normalizedImporter);
  const specifier = packageSpecifierParts(importSource);
  const resolvedInfo = resolveResultPackageInfo(result);
  const packageInfo =
    resolvedInfo ??
    (specifier
      ? findNodeModulesPackageInfo(normalizedImporter, specifier.packageName)
      : null);
  const resolvedPath = result.path ? normalizeRealPath(result.path) : undefined;
  const packageRoot = packageInfo?.root;
  const packageName = packageInfo?.name ?? specifier?.packageName;
  const errorMessage = result.error;
  const builtinModule = result.builtin?.resolved;
  const errorKind = resolveErrorKind(errorMessage, builtinModule);
  const crossesPackageBoundary = Boolean(
    importerInfo?.root && packageRoot && importerInfo.root !== packageRoot
  );
  const usesPublicExport = Boolean(
    !errorMessage && specifier && hasExportsMap(packageInfo)
  );
  const isInternalTarget = isInternalTargetPath(packageRoot, resolvedPath);

  return {
    crossesPackageBoundary,
    importSource,
    importerPath: normalizedImporter,
    isInternalTarget,
    line,
    usesPublicExport,
    ...optionalResolutionFields({
      builtinModule,
      errorKind,
      errorMessage,
      packageName,
      packageRoot,
      resolvedPath,
    }),
  };
};

const getModuleSourceNode = (node: AstNode): AstNode | undefined =>
  getNodeSource(node);

const isStaticImportNode = (node: AstNode): boolean =>
  node.type === 'ImportDeclaration' ||
  node.type === 'ExportNamedDeclaration' ||
  node.type === 'ExportAllDeclaration';

const isDynamicImportExpression = (node: AstNode): boolean =>
  node.type === 'ImportExpression';

const isTypeImportNode = (node: AstNode): boolean =>
  node.type === 'TSImportType';

const isRequireCallExpression = (node: AstNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = getNodeCallee(node);
  return callee?.type === 'Identifier' && getNodeName(callee) === 'require';
};

const getRequireSourceNode = (node: AstNode): AstNode | undefined =>
  getNodeArguments(node)?.[0];

export const collectImportSpecifiers = (
  filePath: string,
  sourceCode: string
): readonly WardenImportSpecifier[] => {
  const ast = parse(filePath, sourceCode);
  if (!ast) {
    return [];
  }

  const specifiers: WardenImportSpecifier[] = [];
  walk(ast, (node) => {
    if (
      !isStaticImportNode(node) &&
      !isDynamicImportExpression(node) &&
      !isTypeImportNode(node) &&
      !isRequireCallExpression(node)
    ) {
      return;
    }
    const source = isRequireCallExpression(node)
      ? getRequireSourceNode(node)
      : getModuleSourceNode(node);
    const importSource =
      source && isStringLiteral(source) ? getStringValue(source) : null;
    if (!importSource) {
      return;
    }
    specifiers.push({
      importSource,
      line: offsetToLine(sourceCode, node.start),
    });
  });
  return specifiers;
};

export const createWardenResolver = (
  options: WardenResolverOptions = {}
): WardenProjectResolver => {
  const rootDir = normalizeRealPath(options.rootDir ?? process.cwd());
  const resolveOptions = mergeWardenResolveOptions(options.resolveOptions);
  const resolver = new ResolverFactory(resolveOptions);
  const cache = new Map<string, ResolveResult>();

  return {
    clearCache: () => {
      cache.clear();
      resolver.clearCache();
    },
    resolveImport: (
      importerPath: string,
      importSource: string,
      line = 1
    ): WardenImportResolution => {
      const absoluteImporterPath = isAbsolute(importerPath)
        ? importerPath
        : resolve(rootDir, importerPath);
      const normalizedImporterPath = normalizeRealPath(absoluteImporterPath);
      const key = `${normalizedImporterPath}\0${importSource}`;
      const cached = cache.get(key);
      if (cached) {
        return buildResolution({
          importSource,
          importerPath: normalizedImporterPath,
          line,
          result: cached,
        });
      }
      const result = resolver.resolveFileSync(
        normalizedImporterPath,
        importSource
      );
      const resolution = buildResolution({
        importSource,
        importerPath: normalizedImporterPath,
        line,
        result,
      });
      cache.set(key, result);
      return resolution;
    },
    resolveOptions,
    rootDir,
  };
};

export const collectImportResolutionsForFile = ({
  filePath,
  resolver,
  sourceCode,
}: {
  readonly filePath: string;
  readonly resolver: WardenProjectResolver;
  readonly sourceCode: string;
}): readonly WardenImportResolution[] =>
  collectImportSpecifiers(filePath, sourceCode).map((specifier) =>
    resolver.resolveImport(filePath, specifier.importSource, specifier.line)
  );
