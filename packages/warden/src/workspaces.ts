/**
 * Workspace-manifest discovery for Warden project-aware rules.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

import {
  listWorkspacePackages,
  listWorkspacePatterns,
  matchesAnyPathGlob,
} from '@ontrails/core';

export interface WardenPublicWorkspace {
  readonly name: string;
  readonly rootDir: string;
  readonly packageJsonPath: string;
  readonly hasExports: boolean;
  readonly bin?: Readonly<Record<string, string>> | undefined;
  readonly exportTargets?: Readonly<Record<string, string>> | undefined;
  readonly files?: readonly string[] | undefined;
}

export interface WardenWorkspaceCollectionOptions {
  /** Root-relative package manifests observed by the owning source collection. */
  readonly collectedPackageJsonPaths?: ReadonlySet<string> | undefined;
  readonly exclude?: readonly string[];
}

interface PackageManifest {
  readonly bin?: unknown;
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly name?: unknown;
  readonly private?: unknown;
  readonly workspaces?: unknown;
}

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const rootRelativePath = (rootDir: string, path: string): string =>
  normalizePath(relative(rootDir, path));

const readPackageManifest = (path: string): PackageManifest | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
  } catch {
    return undefined;
  }
};

const matchesWorkspacePattern = (
  workspacePath: string,
  pattern: string
): boolean => {
  const normalizedPattern = normalizePath(pattern).replace(/^\.\//, '');
  return normalizedPattern.endsWith('/*')
    ? posix.dirname(workspacePath) === normalizedPattern.slice(0, -2)
    : workspacePath === normalizedPattern;
};

interface WorkspaceManifestCandidate {
  readonly manifest: PackageManifest;
  readonly packageJsonPath: string;
}

const collectedWorkspaceManifests = (
  rootDir: string,
  packageJsonPaths: ReadonlySet<string>
): readonly WorkspaceManifestCandidate[] => {
  if (!packageJsonPaths.has('package.json')) {
    return [];
  }
  const rootManifest = readPackageManifest(join(rootDir, 'package.json'));
  const patterns = listWorkspacePatterns(rootManifest);

  return [...packageJsonPaths]
    .filter((path) => path !== 'package.json' && path.endsWith('/package.json'))
    .toSorted()
    .flatMap((path): readonly WorkspaceManifestCandidate[] => {
      const normalizedPath = normalizePath(path).replace(/^\.\//, '');
      const workspacePath = posix.dirname(normalizedPath);
      if (
        posix.isAbsolute(normalizedPath) ||
        normalizedPath.startsWith('../') ||
        !patterns.some((pattern) =>
          matchesWorkspacePattern(workspacePath, pattern)
        )
      ) {
        return [];
      }
      const packageJsonPath = resolve(rootDir, normalizedPath);
      const manifest = readPackageManifest(packageJsonPath);
      return manifest ? [{ manifest, packageJsonPath }] : [];
    });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const packageLocalName = (name: string): string =>
  name.split('/').at(-1) ?? name;

const normalizeBin = (
  name: string,
  value: unknown
): Readonly<Record<string, string>> | undefined => {
  if (typeof value === 'string') {
    return { [packageLocalName(name)]: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeFiles = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const files = value.filter(
    (entry): entry is string => typeof entry === 'string'
  );
  return files.length > 0 ? files : undefined;
};

const resolveExportTarget = (
  target: unknown,
  depth = 0
): string | undefined => {
  if (typeof target === 'string') {
    return target;
  }
  if (!isRecord(target) || depth > 8) {
    return undefined;
  }

  for (const condition of ['bun', 'import', 'default', 'require'] as const) {
    const conditionalTarget = target[condition];
    const resolvedTarget = resolveExportTarget(conditionalTarget, depth + 1);
    if (resolvedTarget) {
      return resolvedTarget;
    }
  }
  return undefined;
};

const exportSpecifierFromKey = (
  packageName: string,
  key: string
): string | undefined => {
  if (key === '.') {
    return packageName;
  }
  if (!key.startsWith('./') || key.includes('*')) {
    return undefined;
  }
  return `${packageName}/${key.slice(2)}`;
};

const normalizeExportTargets = (
  packageDir: string,
  packageName: string,
  exportsValue: unknown
): Readonly<Record<string, string>> | undefined => {
  if (!isRecord(exportsValue)) {
    return undefined;
  }

  const targets: Record<string, string> = {};
  for (const [key, value] of Object.entries(exportsValue)) {
    const specifier = exportSpecifierFromKey(packageName, key);
    const target = resolveExportTarget(value);
    if (!specifier || !target) {
      continue;
    }
    targets[specifier] = normalizeRealPath(join(packageDir, target));
  }

  return Object.keys(targets).length > 0 ? targets : undefined;
};

const publicWorkspaceFromManifest = (
  packageJsonPath: string,
  manifest: PackageManifest
): WardenPublicWorkspace | undefined => {
  if (typeof manifest.name !== 'string') {
    return undefined;
  }
  if (!manifest.name.startsWith('@ontrails/')) {
    return undefined;
  }
  if (manifest.private === true) {
    return undefined;
  }

  const packageDir = dirname(packageJsonPath);
  const bin = normalizeBin(manifest.name, manifest.bin);
  const exportTargets = normalizeExportTargets(
    packageDir,
    manifest.name,
    manifest.exports
  );
  const files = normalizeFiles(manifest.files);

  return {
    ...(bin ? { bin } : {}),
    ...(exportTargets ? { exportTargets } : {}),
    ...(files ? { files } : {}),
    hasExports: manifest.exports !== undefined,
    name: manifest.name,
    packageJsonPath: normalizeRealPath(packageJsonPath),
    rootDir: normalizeRealPath(dirname(packageJsonPath)),
  };
};

export const collectPublicWorkspaces = (
  rootDir: string,
  options: WardenWorkspaceCollectionOptions = {}
): ReadonlyMap<string, WardenPublicWorkspace> => {
  const normalizedRoot = normalizeRealPath(rootDir);
  const workspaces = new Map<string, WardenPublicWorkspace>();
  const candidates = options.collectedPackageJsonPaths
    ? collectedWorkspaceManifests(
        normalizedRoot,
        options.collectedPackageJsonPaths
      )
    : listWorkspacePackages<PackageManifest>(normalizedRoot);

  for (const workspacePackage of candidates) {
    const workspace = publicWorkspaceFromManifest(
      workspacePackage.packageJsonPath,
      workspacePackage.manifest
    );
    if (
      workspace &&
      !matchesAnyPathGlob(
        rootRelativePath(normalizedRoot, workspace.rootDir),
        options.exclude ?? []
      ) &&
      !matchesAnyPathGlob(
        rootRelativePath(normalizedRoot, workspace.packageJsonPath),
        options.exclude ?? []
      )
    ) {
      workspaces.set(workspace.name, workspace);
    }
  }

  return workspaces;
};
