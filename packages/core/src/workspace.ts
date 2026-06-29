/**
 * Workspace detection utilities.
 *
 * Walks the filesystem to find monorepo workspace roots and provides
 * helpers for working with paths relative to a workspace.
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, join, isAbsolute } from 'node:path';

import { NotFoundError } from './errors.js';
import { Result } from './result.js';

export interface WorkspaceRootManifest {
  readonly workspaces?: unknown;
}

export interface WorkspacePackage<
  Manifest extends object = Record<string, unknown>,
> {
  readonly manifest: Manifest;
  readonly packageJsonPath: string;
  readonly packageRoot: string;
  readonly workspacePath: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizePath = (path: string): string => path.replaceAll('\\', '/');

const normalizeRealPath = (path: string): string => {
  try {
    return normalizePath(realpathSync(path));
  } catch {
    return normalizePath(resolve(path));
  }
};

const readJsonSync = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

/** Check if a directory has a package.json with a `workspaces` field. */
const hasWorkspacesField = async (dir: string): Promise<boolean> => {
  const pkgPath = join(dir, 'package.json');
  const file = Bun.file(pkgPath);
  if (!(await file.exists())) {
    return false;
  }
  try {
    const pkg: unknown = await file.json();
    return typeof pkg === 'object' && pkg !== null && 'workspaces' in pkg;
  } catch {
    return false;
  }
};

/**
 * List workspace patterns from a root package manifest.
 *
 * Supports npm/Bun's array form and Yarn-style `{ packages: [] }` form.
 *
 * @example
 * ```ts
 * listWorkspacePatterns({ workspaces: ['packages/*'] });
 * ```
 */
export const listWorkspacePatterns = (
  manifest: WorkspaceRootManifest | undefined
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
    return existsSync(join(workspaceDir, 'package.json')) ? [workspaceDir] : [];
  }

  const groupDir = join(rootDir, pattern.slice(0, -2));
  if (!existsSync(groupDir)) {
    return [];
  }

  return readdirSync(groupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(groupDir, entry.name))
    .filter((workspaceDir) => existsSync(join(workspaceDir, 'package.json')))
    .toSorted();
};

/**
 * List package directories matched by workspace patterns.
 *
 * Only directories containing `package.json` are returned.
 *
 * @example
 * ```ts
 * listWorkspacePackageDirs('/repo', ['packages/*']);
 * ```
 */
export const listWorkspacePackageDirs = (
  rootDir: string,
  patterns: readonly string[]
): readonly string[] =>
  patterns.flatMap((pattern) => workspaceDirsForPattern(rootDir, pattern));

/**
 * List workspace package manifests from a workspace root.
 *
 * @example
 * ```ts
 * const packages = listWorkspacePackages('/repo');
 * ```
 */
export const listWorkspacePackages = <
  Manifest extends { readonly name?: unknown } = { readonly name?: unknown },
>(
  rootDir: string
): readonly WorkspacePackage<Manifest>[] => {
  const normalizedRoot = normalizeRealPath(rootDir);
  const rootManifest = readJsonSync<WorkspaceRootManifest>(
    join(normalizedRoot, 'package.json')
  );
  const packages: WorkspacePackage<Manifest>[] = [];

  for (const workspaceDir of listWorkspacePackageDirs(
    normalizedRoot,
    listWorkspacePatterns(rootManifest)
  )) {
    const packageJsonPath = join(workspaceDir, 'package.json');
    const manifest = readJsonSync<Manifest>(packageJsonPath);
    if (!manifest || typeof manifest.name !== 'string') {
      continue;
    }

    const packageRoot = normalizeRealPath(dirname(packageJsonPath));
    packages.push({
      manifest,
      packageJsonPath: normalizeRealPath(packageJsonPath),
      packageRoot,
      workspacePath: normalizePath(relative(normalizedRoot, packageRoot)),
    });
  }

  return packages.toSorted((left, right) =>
    left.workspacePath.localeCompare(right.workspacePath)
  );
};

/**
 * Find a workspace package by its package name.
 *
 * @example
 * ```ts
 * const workspace = findWorkspacePackage('/repo', '@ontrails/core');
 * ```
 */
export const findWorkspacePackage = <
  Manifest extends { readonly name?: unknown } = { readonly name?: unknown },
>(
  rootDir: string,
  packageName: string
): WorkspacePackage<Manifest> | undefined =>
  listWorkspacePackages<Manifest>(rootDir).find(
    (workspacePackage) => workspacePackage.manifest.name === packageName
  );

/**
 * Walks up from `startDir` (defaults to `process.cwd()`) looking for a
 * `package.json` that contains a `"workspaces"` field.
 *
 * Returns the directory path of the workspace root on success, or a
 * `NotFoundError` if no workspace root is found.
 */
export const findWorkspaceRoot = async (
  startDir?: string
): Promise<Result<string, NotFoundError>> => {
  let current = resolve(startDir ?? process.cwd());

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await hasWorkspacesField(current)) {
      return Result.ok(current);
    }

    const parent = dirname(current);

    if (parent === current) {
      return Result.err(
        new NotFoundError(
          `No workspace root found from "${startDir ?? process.cwd()}"`
        )
      );
    }

    current = parent;
  }
};

/**
 * Returns `true` if `filePath` is inside `workspaceRoot`.
 */
export const isInsideWorkspace = (
  filePath: string,
  workspaceRoot: string
): boolean => {
  const rel = relative(resolve(workspaceRoot), resolve(filePath));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * Returns the relative path from `workspaceRoot` to `filePath`.
 */
export const deriveRelativePath = (
  filePath: string,
  workspaceRoot: string
): string => relative(resolve(workspaceRoot), resolve(filePath));
