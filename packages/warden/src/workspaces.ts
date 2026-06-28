/**
 * Workspace-manifest discovery for Warden project-aware rules.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { matchesAnyPathPattern } from './path-scope.js';

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
  readonly ignore?: readonly string[];
}

interface RootManifest {
  readonly workspaces?: unknown;
}

interface PackageManifest {
  readonly bin?: unknown;
  readonly exports?: unknown;
  readonly files?: unknown;
  readonly name?: unknown;
  readonly private?: unknown;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const workspacePatternsFromManifest = (
  manifest: RootManifest | undefined
): readonly string[] => {
  const { workspaces } = manifest ?? {};
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }

  const packages = isRecord(workspaces) ? workspaces['packages'] : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const workspaceDirsForPattern = (
  rootDir: string,
  pattern: string
): readonly string[] => {
  if (!pattern.endsWith('/*')) {
    const workspaceDir = join(rootDir, pattern);
    return existsSync(workspaceDir) ? [workspaceDir] : [];
  }

  const groupDir = join(rootDir, pattern.slice(0, -2));
  if (!existsSync(groupDir)) {
    return [];
  }

  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name))
    .toSorted();
};

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
  const rootManifest = readJson<RootManifest>(
    join(normalizedRoot, 'package.json')
  );
  const workspaces = new Map<string, WardenPublicWorkspace>();

  for (const pattern of workspacePatternsFromManifest(rootManifest)) {
    for (const workspaceDir of workspaceDirsForPattern(
      normalizedRoot,
      pattern
    )) {
      const packageJsonPath = join(workspaceDir, 'package.json');
      const manifest = readJson<PackageManifest>(packageJsonPath);
      if (!manifest) {
        continue;
      }

      const workspace = publicWorkspaceFromManifest(packageJsonPath, manifest);
      if (
        workspace &&
        !matchesAnyPathPattern(
          rootRelativePath(normalizedRoot, workspace.rootDir),
          options.ignore ?? []
        ) &&
        !matchesAnyPathPattern(
          rootRelativePath(normalizedRoot, workspace.packageJsonPath),
          options.ignore ?? []
        )
      ) {
        workspaces.set(workspace.name, workspace);
      }
    }
  }

  return workspaces;
};
