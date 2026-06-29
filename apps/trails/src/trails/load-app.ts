import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  deriveSafePath,
  isTrailsError,
  listWorkspacePackages,
  PermissionError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { CliCommandAliasInput, Topo } from '@ontrails/core';
import { findAppModule } from '@ontrails/cli';

import {
  createLoadAppMirrorRootPath,
  ensureLoadAppMirrorDirectory,
  LOAD_APP_MIRROR_ENTRY_PREFIX,
  LOAD_APP_MIRROR_PARENT_DIRNAME,
  removeLoadAppMirrorRootQuietly,
  resolveLoadAppMirrorFilePath,
  writeLoadAppMirrorFile,
} from '../load-app-mirror.js';

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

type TranspilerLoader = 'ts' | 'tsx' | 'js' | 'jsx';

/** Extension → Bun.Transpiler loader, so JSX-bearing files parse correctly. */
const LOADER_BY_EXTENSION: Record<string, TranspilerLoader> = {
  '.cjs': 'js',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.mts': 'ts',
  '.ts': 'ts',
  '.tsx': 'tsx',
};

const SCANNABLE_EXTENSIONS = new Set(Object.keys(LOADER_BY_EXTENSION));

const TRANSPILER_CACHE = new Map<TranspilerLoader, Bun.Transpiler>();

const getImportScanner = (loader: TranspilerLoader): Bun.Transpiler => {
  const cached = TRANSPILER_CACHE.get(loader);
  if (cached !== undefined) {
    return cached;
  }
  const scanner = new Bun.Transpiler({ loader });
  TRANSPILER_CACHE.set(loader, scanner);
  return scanner;
};

/**
 * Mirror roots kept alive for the lifetime of the process.
 *
 * @remarks
 * A fresh-loaded module may expose functions whose deferred relative imports
 * are resolved only when those functions run (for example inside a trail's
 * `blaze`). If we deleted the mirror tree immediately after the initial
 * `import()` resolved, those later resolutions would hit an ENOENT. We keep
 * the mirrors on disk and clean them up once, on process exit.
 */
const ACTIVE_MIRROR_ROOTS = new Set<string>();
const RETAINED_MIRROR_ROOTS = new Set<string>();

const cleanupAllMirrorRoots = (): void => {
  for (const root of [...ACTIVE_MIRROR_ROOTS, ...RETAINED_MIRROR_ROOTS]) {
    removeLoadAppMirrorRootQuietly(root);
  }
  ACTIVE_MIRROR_ROOTS.clear();
  RETAINED_MIRROR_ROOTS.clear();
};

const mirrorCleanup = (() => {
  let registered = false;
  return {
    ensureRegistered(): void {
      if (registered) {
        return;
      }
      registered = true;
      process.once('exit', cleanupAllMirrorRoots);
    },
  };
})();

const ensureMirrorCleanupHook = (): void => {
  mirrorCleanup.ensureRegistered();
};

/**
 * Retain a fresh-import mirror for the lifetime of the process. A previously
 * returned `loadApp` result may hold deferred relative `import()` calls whose
 * resolution requires the mirror directory to still exist, so we cannot prune
 * these by age without risking ENOENT in long-lived sessions (dev server,
 * survey polling, concurrent fresh loads). Cleanup happens once on process
 * exit via `cleanupAllMirrorRoots`.
 */
const retainMirrorRoot = (mirrorRoot: string): void => {
  if (RETAINED_MIRROR_ROOTS.has(mirrorRoot)) {
    return;
  }
  RETAINED_MIRROR_ROOTS.add(mirrorRoot);
  ensureMirrorCleanupHook();
};

const acquireMirrorLease = (mirrorRoot: string): (() => void) => {
  ACTIVE_MIRROR_ROOTS.add(mirrorRoot);
  ensureMirrorCleanupHook();

  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;
    ACTIVE_MIRROR_ROOTS.delete(mirrorRoot);
    removeLoadAppMirrorRootQuietly(mirrorRoot);
  };
};

const resolveUrlModulePath = (modulePath: string): string => {
  const url = new URL(modulePath);
  return url.protocol === 'file:' ? fileURLToPath(url) : modulePath;
};

const resolveFilesystemModulePath = (
  modulePath: string,
  cwd: string
): string => {
  const absolutePath = isAbsolute(modulePath)
    ? modulePath
    : resolve(cwd, modulePath);
  if (!absolutePath.endsWith('.js') || existsSync(absolutePath)) {
    return absolutePath;
  }

  const tsPath = absolutePath.replace(/\.js$/, '.ts');
  return existsSync(tsPath) ? tsPath : absolutePath;
};

const trustBoundaryError = (reason: string): PermissionError =>
  new PermissionError(
    `Refusing to load an app module outside the workspace trust boundary (${reason}). Use a workspace-relative module path, or pass trustedModulePath: true from trusted code.`
  );

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const toLoadAppError = (error: unknown): Error => {
  if (isTrailsError(error)) {
    return error;
  }
  const cause = asError(error);
  return new ValidationError(`Failed to load app module: ${cause.message}`, {
    cause,
    context: { detail: cause.message },
  });
};

const isPathInside = (root: string, target: string): boolean => {
  const candidate = relative(root, target);
  return (
    candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))
  );
};

const realpathIfPresent = (path: string): string | undefined => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

const ensureRealPathInsideCwd = (
  resolvedModulePath: string,
  cwd: string
): string => {
  const realRoot = realpathIfPresent(cwd);
  const realModule = realpathIfPresent(resolvedModulePath);
  if (
    realRoot !== undefined &&
    realModule !== undefined &&
    !isPathInside(realRoot, realModule)
  ) {
    throw trustBoundaryError('symlink_escape');
  }

  return resolvedModulePath;
};

/** Resolve a caller-trusted module path using the legacy escape hatch policy. */
const resolveTrustedModulePath = (modulePath: string, cwd: string): string =>
  URL_SCHEME.test(modulePath)
    ? resolveUrlModulePath(modulePath)
    : resolveFilesystemModulePath(modulePath, cwd);

/**
 * Resolve the default app module path inside cwd.
 *
 * @remarks
 * CLI and trail callers accept user-supplied module specifiers, so the default
 * policy is deliberately narrower than `import()` itself: no URL schemes, no
 * absolute paths, and no parent traversal. Internal callers that intentionally
 * load a path outside cwd must opt into `trustedModulePath`.
 */
const resolveContainedModulePath = (
  modulePath: string,
  cwd: string
): string => {
  if (URL_SCHEME.test(modulePath)) {
    throw trustBoundaryError('url_scheme');
  }
  if (isAbsolute(modulePath)) {
    throw trustBoundaryError('absolute_path');
  }

  const safePath = deriveSafePath(cwd, modulePath);
  if (safePath.isErr()) {
    throw trustBoundaryError('parent_escape');
  }

  return ensureRealPathInsideCwd(
    resolveFilesystemModulePath(safePath.value, cwd),
    cwd
  );
};

interface LoadAppTrustOptions {
  readonly trustedModulePath?: boolean | undefined;
}

const resolveLoadAppModulePath = (
  modulePath: string,
  cwd: string,
  options: LoadAppTrustOptions = {}
): string =>
  options.trustedModulePath === true
    ? resolveTrustedModulePath(modulePath, cwd)
    : resolveContainedModulePath(modulePath, cwd);

const findWorkspaceRelativeAppModule = (cwd: string): string => {
  const discovered = findAppModule(cwd);
  return isAbsolute(discovered) ? relative(cwd, discovered) : discovered;
};

const isLocalFilesystemImport = (importPath: string): boolean =>
  importPath.startsWith('.') ||
  importPath.startsWith('/') ||
  importPath.startsWith('file:');

interface PackageJson {
  readonly exports?: unknown;
  readonly imports?: unknown;
  readonly main?: unknown;
  readonly module?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly workspaces?: unknown;
}

type NamedPackageJson = PackageJson & { readonly name: string };

const readPackageJson = (packagePath: string): PackageJson | undefined => {
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
};

const readPackageName = (packagePath: string): string | undefined => {
  const parsed = readPackageJson(packagePath);
  return typeof parsed?.name === 'string' && parsed.name.length > 0
    ? parsed.name
    : undefined;
};

const findNearestPackageName = (directoryPath: string): string | undefined => {
  let current = directoryPath;
  while (true) {
    const name = readPackageName(join(current, 'package.json'));
    if (name !== undefined) {
      return name;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const isPackageLocalImport = (
  importerPath: string,
  importPath: string
): boolean => {
  if (importPath.startsWith('#')) {
    return true;
  }

  const packageName = findNearestPackageName(dirname(importerPath));
  return (
    packageName !== undefined &&
    (importPath === packageName || importPath.startsWith(`${packageName}/`))
  );
};

const isScannableModule = (modulePath: string): boolean =>
  SCANNABLE_EXTENSIONS.has(extname(modulePath));

const readDirectoryEntries = (directoryPath: string): readonly string[] => {
  try {
    return readdirSync(directoryPath);
  } catch {
    return [];
  }
};

const safeStat = (
  entryPath: string
): ReturnType<typeof statSync> | undefined => {
  try {
    return statSync(entryPath);
  } catch {
    return undefined;
  }
};

const resolveImportedModulePath = (
  importerPath: string,
  importPath: string
): string => {
  const resolved = import.meta.resolve(
    importPath,
    pathToFileURL(importerPath).href
  );
  return resolveFilesystemModulePath(
    fileURLToPath(resolved),
    dirname(importerPath)
  );
};

interface WorkspacePackage {
  readonly name: string;
  readonly packageJson: PackageJson;
  readonly packageRoot: string;
}

const readWorkspacePackages = (cwd: string): readonly WorkspacePackage[] =>
  listWorkspacePackages<NamedPackageJson>(cwd).map((workspacePackage) => ({
    name: workspacePackage.manifest.name,
    packageJson: workspacePackage.manifest,
    packageRoot: workspacePackage.packageRoot,
  }));

const parsePackageSpecifier = (
  importPath: string
): { packageName: string; subpath: string } | null => {
  if (URL_SCHEME.test(importPath)) {
    return null;
  }
  if (importPath.startsWith('.') || importPath.startsWith('#')) {
    return null;
  }
  const segments = importPath.split('/');
  const [firstSegment, secondSegment] = segments;
  if (firstSegment?.startsWith('@')) {
    const scope = firstSegment;
    const name = secondSegment;
    if (name === undefined) {
      return null;
    }
    const packageName = `${scope}/${name}`;
    const rest = segments.slice(2).join('/');
    return { packageName, subpath: rest.length > 0 ? `./${rest}` : '.' };
  }
  const [name] = segments;
  if (name === undefined || name.length === 0) {
    return null;
  }
  const rest = segments.slice(1).join('/');
  return { packageName: name, subpath: rest.length > 0 ? `./${rest}` : '.' };
};

const resolveConditionalExportTarget = (
  target: unknown
): string | undefined => {
  if (typeof target === 'string') {
    return target;
  }
  if (typeof target !== 'object' || target === null || Array.isArray(target)) {
    return undefined;
  }
  const record = target as Record<string, unknown>;
  return (
    resolveConditionalExportTarget(record['import']) ??
    resolveConditionalExportTarget(record['default']) ??
    resolveConditionalExportTarget(record['bun']) ??
    resolveConditionalExportTarget(record['node'])
  );
};

const resolveExportTarget = (
  packageJson: PackageJson,
  subpath: string
): string | undefined => {
  const { exports } = packageJson;
  if (exports === undefined) {
    if (subpath === '.') {
      if (typeof packageJson.module === 'string') {
        return packageJson.module;
      }
      if (typeof packageJson.main === 'string') {
        return packageJson.main;
      }
      return './src/index.ts';
    }
    return subpath;
  }
  if (typeof exports === 'string' || Array.isArray(exports)) {
    return subpath === '.'
      ? resolveConditionalExportTarget(exports)
      : undefined;
  }
  if (typeof exports !== 'object' || exports === null) {
    return undefined;
  }
  return resolveConditionalExportTarget(
    (exports as Record<string, unknown>)[subpath]
  );
};

interface WorkspacePackageResolution {
  readonly modulePath: string;
  readonly packageName: string;
  readonly packageRoot: string;
}

const resolveWorkspacePackageImport = (
  importPath: string,
  cwd: string
): WorkspacePackageResolution | null => {
  const parsed = parsePackageSpecifier(importPath);
  if (parsed === null) {
    return null;
  }
  const workspacePackage = readWorkspacePackages(cwd).find(
    (candidate) => candidate.name === parsed.packageName
  );
  if (workspacePackage === undefined) {
    return null;
  }
  const target = resolveExportTarget(
    workspacePackage.packageJson,
    parsed.subpath
  );
  if (target === undefined || !target.startsWith('.')) {
    return null;
  }
  const targetPath = deriveSafePath(workspacePackage.packageRoot, target);
  if (targetPath.isErr()) {
    return null;
  }
  return {
    modulePath: resolveFilesystemModulePath(
      ensureRealPathInsideCwd(targetPath.value, cwd),
      workspacePackage.packageRoot
    ),
    packageName: workspacePackage.name,
    packageRoot: workspacePackage.packageRoot,
  };
};

const findPackageRootForName = (
  directoryPath: string,
  packageName: string
): string | null => {
  let current = directoryPath;
  while (true) {
    const packagePath = join(current, 'package.json');
    if (readPackageName(packagePath) === packageName) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

interface ExternalPackageResolution {
  readonly packageName: string;
  readonly packageRoot: string;
}

const resolveExternalPackageImport = (
  importerPath: string,
  importPath: string
): ExternalPackageResolution | null => {
  const parsed = parsePackageSpecifier(importPath);
  if (parsed === null) {
    return null;
  }
  let resolved: string;
  try {
    resolved = import.meta.resolve(
      importPath,
      pathToFileURL(importerPath).href
    );
  } catch {
    return null;
  }
  if (!resolved.startsWith('file:')) {
    return null;
  }
  const packageRoot = findPackageRootForName(
    dirname(fileURLToPath(resolved)),
    parsed.packageName
  );
  return packageRoot === null
    ? null
    : { packageName: parsed.packageName, packageRoot };
};

type MirrorImportResolution =
  | {
      readonly kind: 'module';
      readonly modulePath: string;
    }
  | {
      readonly kind: 'external-package';
      readonly packageName: string;
      readonly packageRoot: string;
    }
  | {
      readonly kind: 'workspace-package';
      readonly modulePath: string;
      readonly packageName: string;
      readonly packageRoot: string;
    };

const resolveMirrorImport = (
  importerPath: string,
  importPath: string,
  cwd: string
): MirrorImportResolution | null => {
  if (
    isLocalFilesystemImport(importPath) ||
    isPackageLocalImport(importerPath, importPath)
  ) {
    return {
      kind: 'module',
      modulePath: resolveImportedModulePath(importerPath, importPath),
    };
  }

  const workspacePackage = resolveWorkspacePackageImport(importPath, cwd);
  if (workspacePackage !== null) {
    return { kind: 'workspace-package', ...workspacePackage };
  }

  const externalPackage = resolveExternalPackageImport(
    importerPath,
    importPath
  );
  return externalPackage === null
    ? null
    : { kind: 'external-package', ...externalPackage };
};

const collectImportedModuleResolutions = (
  modulePath: string,
  source: string,
  cwd: string
): readonly MirrorImportResolution[] => {
  const extension = extname(modulePath);
  const loader = LOADER_BY_EXTENSION[extension];
  if (loader === undefined) {
    return [];
  }

  return getImportScanner(loader)
    .scanImports(source)
    .map((entry) => entry.path)
    .map((importPath) => resolveMirrorImport(modulePath, importPath, cwd))
    .filter(
      (resolution): resolution is MirrorImportResolution => resolution !== null
    );
};

const copyFileToMirror = async (
  sourcePath: string,
  mirrorRoot: string,
  copied: Set<string>
): Promise<void> => {
  if (copied.has(sourcePath)) {
    return;
  }
  copied.add(sourcePath);

  const written = await writeLoadAppMirrorFile(sourcePath, mirrorRoot);
  if (written.isErr()) {
    throw written.error;
  }
};

/**
 * Directory basenames that are never worth mirroring.
 *
 * @remarks
 * These directories are excluded because they can be large and are never
 * sources of resolvable imports — they hold VCS metadata, package installs,
 * prior mirror artifacts, or build/tooling output that module resolution
 * should not touch.
 */
const MIRROR_SKIP_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.trails-tmp',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

/**
 * Recursively copy every regular file inside `directoryPath` into the
 * mirror, skipping well-known heavy directories.
 *
 * @remarks
 * `Bun.Transpiler#scanImports` only surfaces statically analyzable import
 * specifiers. Computed dynamic imports such as `import(\`./${name}.ts\`)`
 * never appear, so their targets would otherwise be missing from the
 * mirror. Shadowing each directory touched by the static walk with its
 * full subtree keeps those sibling modules resolvable under the mirror
 * root at runtime without pulling in package installs or nested mirror
 * artifacts.
 */
/**
 * Age threshold (ms) above which a mirror entry in `.trails-tmp/` is
 * considered stale and safe to remove opportunistically.
 *
 * @remarks
 * Fresh loads complete in seconds. Anything older than 10 minutes is almost
 * certainly left over from a crashed or signal-killed process. We intentionally
 * avoid registering SIGTERM/SIGINT handlers here because that would risk
 * clobbering host-app signal handlers (and still wouldn't rescue SIGKILL).
 * Opportunistic cleanup is self-healing across crashes from any cause.
 */
const STALE_MIRROR_THRESHOLD_MS = 10 * 60 * 1000;

const isStaleMirrorEntry = (entryPath: string, now: number): boolean => {
  if (
    ACTIVE_MIRROR_ROOTS.has(entryPath) ||
    RETAINED_MIRROR_ROOTS.has(entryPath)
  ) {
    return false;
  }
  const entryStat = safeStat(entryPath);
  if (entryStat === undefined) {
    return false;
  }
  const mtimeMs = Number(entryStat.mtimeMs);
  return now - mtimeMs >= STALE_MIRROR_THRESHOLD_MS;
};

const removeStaleMirrorEntry = (entryPath: string): void => {
  /*
   * Another concurrent load may own it. Safe to ignore — the next sweep
   * will retry.
   */
  removeLoadAppMirrorRootQuietly(entryPath);
};

/**
 * Best-effort removal of stale mirror directories left by previous (crashed or
 * signal-killed) processes. Called before creating a new mirror root.
 */
const cleanupStaleMirrorRoots = (mirrorParent: string): void => {
  const entries = readDirectoryEntries(mirrorParent);
  if (entries.length === 0) {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.startsWith(LOAD_APP_MIRROR_ENTRY_PREFIX)) {
      continue;
    }
    const entryPath = join(mirrorParent, entry);
    if (isStaleMirrorEntry(entryPath, now)) {
      removeStaleMirrorEntry(entryPath);
    }
  }
};

const freshMirrorRootPath = (cwd: string): string => {
  const mirrorParent = join(cwd, LOAD_APP_MIRROR_PARENT_DIRNAME);
  cleanupStaleMirrorRoots(mirrorParent);
  return createLoadAppMirrorRootPath(cwd);
};

interface MirrorWalkContext {
  readonly cwd: string;
  readonly mirrorRoot: string;
  readonly copied: Set<string>;
  readonly visitedDirectories: Set<string>;
  readonly linkedPackageNames: Set<string>;
}

type DirectoryEntryKind = 'directory' | 'file' | 'skip';

const classifyDirectoryEntry = (
  entry: string,
  entryPath: string
): DirectoryEntryKind => {
  const entryStat = safeStat(entryPath);
  if (entryStat === undefined) {
    return 'skip';
  }
  if (entryStat.isDirectory()) {
    return MIRROR_SKIP_DIRECTORIES.has(entry) ? 'skip' : 'directory';
  }
  return entryStat.isFile() ? 'file' : 'skip';
};

const copyDirectoryTreeToMirror = async (
  directoryPath: string,
  context: MirrorWalkContext
): Promise<void> => {
  if (context.visitedDirectories.has(directoryPath)) {
    return;
  }
  context.visitedDirectories.add(directoryPath);

  for (const entry of readDirectoryEntries(directoryPath)) {
    const entryPath = join(directoryPath, entry);
    const kind = classifyDirectoryEntry(entry, entryPath);
    if (kind === 'directory') {
      await copyDirectoryTreeToMirror(entryPath, context);
    } else if (kind === 'file') {
      await copyFileToMirror(entryPath, context.mirrorRoot, context.copied);
    }
  }
};

const copyNearestPackageJsonToMirror = async (
  directoryPath: string,
  context: MirrorWalkContext
): Promise<void> => {
  let current = directoryPath;
  while (true) {
    const packagePath = join(current, 'package.json');
    const packageStat = safeStat(packagePath);
    if (packageStat?.isFile()) {
      await copyFileToMirror(packagePath, context.mirrorRoot, context.copied);
      return;
    }

    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

const packageLinkSegments = (packageName: string): readonly string[] =>
  packageName.split('/').filter((segment) => segment.length > 0);

const createPackageMirrorLink = (
  packageName: string,
  targetRoot: string,
  context: MirrorWalkContext
): void => {
  if (context.linkedPackageNames.has(packageName)) {
    return;
  }
  const mirrorWorkspaceRoot = resolveLoadAppMirrorFilePath(
    context.cwd,
    context.mirrorRoot
  );
  if (mirrorWorkspaceRoot.isErr()) {
    throw mirrorWorkspaceRoot.error;
  }
  const linkPath = join(
    mirrorWorkspaceRoot.value,
    'node_modules',
    ...packageLinkSegments(packageName)
  );

  const ensured = ensureLoadAppMirrorDirectory(
    dirname(linkPath),
    context.mirrorRoot
  );
  if (ensured.isErr()) {
    throw ensured.error;
  }

  try {
    symlinkSync(targetRoot, linkPath, 'dir');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    ) {
      throw error;
    }
  }
  context.linkedPackageNames.add(packageName);
};

const createWorkspacePackageMirrorLink = (
  packageName: string,
  packageRoot: string,
  context: MirrorWalkContext
): void => {
  const mirrorPackageRoot = resolveLoadAppMirrorFilePath(
    packageRoot,
    context.mirrorRoot
  );
  if (mirrorPackageRoot.isErr()) {
    throw mirrorPackageRoot.error;
  }
  createPackageMirrorLink(packageName, mirrorPackageRoot.value, context);
};

const mirrorImportedModule = async (
  modulePath: string,
  context: MirrorWalkContext
): Promise<void> => {
  const moduleDirectory = dirname(modulePath);
  await copyNearestPackageJsonToMirror(moduleDirectory, context);
  if (context.visitedDirectories.has(moduleDirectory)) {
    await copyFileToMirror(modulePath, context.mirrorRoot, context.copied);
    return;
  }
  await copyDirectoryTreeToMirror(moduleDirectory, context);
};

const scanAndVisitLocalImports = async (
  modulePath: string,
  context: MirrorWalkContext,
  visit: (path: string) => Promise<void>
): Promise<void> => {
  if (!isScannableModule(modulePath)) {
    return;
  }
  const source = await Bun.file(modulePath).text();
  for (const imported of collectImportedModuleResolutions(
    modulePath,
    source,
    context.cwd
  )) {
    if (imported.kind === 'external-package') {
      createPackageMirrorLink(
        imported.packageName,
        imported.packageRoot,
        context
      );
      continue;
    }
    if (imported.kind === 'workspace-package') {
      createWorkspacePackageMirrorLink(
        imported.packageName,
        imported.packageRoot,
        context
      );
    }
    await visit(imported.modulePath);
  }
};

const mirrorFreshImportGraph = async (
  entryPath: string,
  cwd: string,
  mirrorRoot: string
): Promise<string> => {
  const scanned = new Set<string>();
  const context: MirrorWalkContext = {
    copied: new Set<string>(),
    cwd,
    linkedPackageNames: new Set<string>(),
    mirrorRoot,
    visitedDirectories: new Set<string>(),
  };

  const visit = async (modulePath: string): Promise<void> => {
    if (scanned.has(modulePath)) {
      return;
    }
    scanned.add(modulePath);
    await scanAndVisitLocalImports(modulePath, context, visit);
    await mirrorImportedModule(modulePath, context);
  };

  await visit(entryPath);
  const freshPath = resolveLoadAppMirrorFilePath(entryPath, mirrorRoot);
  if (freshPath.isErr()) {
    throw freshPath.error;
  }
  return freshPath.value;
};

/**
 * Import a module bypassing the ESM cache for the local filesystem import graph.
 *
 * @remarks
 * External packages and built-in modules still resolve normally. Only local
 * filesystem imports are mirrored into the fresh temp root. The mirror tree
 * is retained for the lifetime of the process so that deferred relative
 * `import()`/`require()` calls originating from the loaded module (e.g.
 * inside a trail's `blaze`) can still resolve. If the graph walk itself
 * fails, the partially-written mirror is removed immediately so failed
 * loads do not leak disk space.
 */
const importWithCacheBust = async (
  absolutePath: string
): Promise<Record<string, unknown>> => {
  const url = new URL(absolutePath);
  url.searchParams.set('t', Date.now().toString());
  return (await import(url.href)) as Record<string, unknown>;
};

const prepareMirror = async (
  absolutePath: string,
  cwd: string
): Promise<{ mirrorRoot: string; freshPath: string }> => {
  const resolvedCwd = resolve(cwd);
  const mirrorRoot = freshMirrorRootPath(resolvedCwd);
  try {
    const freshPath = await mirrorFreshImportGraph(
      absolutePath,
      resolvedCwd,
      mirrorRoot
    );
    return { freshPath, mirrorRoot };
  } catch (error) {
    removeLoadAppMirrorRootQuietly(mirrorRoot);
    throw error;
  }
};

const importFreshModule = async (
  resolvedModulePath: string,
  cwd: string
): Promise<Record<string, unknown>> => {
  const absolutePath = resolvedModulePath;
  if (URL_SCHEME.test(absolutePath) && !absolutePath.startsWith('/')) {
    return await importWithCacheBust(absolutePath);
  }

  const { mirrorRoot, freshPath } = await prepareMirror(absolutePath, cwd);
  retainMirrorRoot(mirrorRoot);
  return (await import(pathToFileURL(freshPath).href)) as Record<
    string,
    unknown
  >;
};

const resolveLoadedTopo = (
  effectivePath: string,
  mod: Record<string, unknown>
): Topo => {
  const app = (mod['default'] ?? mod['graph'] ?? mod['app']) as
    | Topo
    | undefined;
  if (!app?.trails) {
    throw new ValidationError(
      `Could not find a Topo export in "${effectivePath}". ` +
        "Expected a default, 'graph', or 'app' named export created with topo()."
    );
  }
  return app;
};

type LoadedCliAliases = Readonly<
  Record<string, readonly CliCommandAliasInput[]>
>;

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isCliAliasInput = (value: unknown): value is CliCommandAliasInput =>
  typeof value === 'string' || isStringArray(value);

const resolveLoadedCliAliases = (
  effectivePath: string,
  mod: Record<string, unknown>
): LoadedCliAliases | undefined => {
  const value = mod['trailsCliAliases'] ?? mod['cliAliases'];
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `CLI alias export in "${effectivePath}" must be a record from trail ID to alias list.`
    );
  }

  const aliases = value as Record<string, unknown>;
  for (const [trailId, trailAliases] of Object.entries(aliases)) {
    if (!Array.isArray(trailAliases)) {
      throw new ValidationError(
        `CLI alias export for trail "${trailId}" in "${effectivePath}" must be an array.`
      );
    }
    for (const alias of trailAliases) {
      if (!isCliAliasInput(alias)) {
        throw new ValidationError(
          `CLI alias export for trail "${trailId}" in "${effectivePath}" must contain string aliases or string-array paths.`
        );
      }
    }
  }

  return aliases as LoadedCliAliases;
};

export interface FreshAppLease {
  readonly app: Topo;
  readonly cliAliases?: LoadedCliAliases | undefined;
  readonly mirrorRoot: string;
  readonly release: () => void;
}

export type LoadAppLeaseOptions = LoadAppTrustOptions;

export interface LoadAppOptions extends LoadAppTrustOptions {
  readonly fresh?: boolean | undefined;
}

const noopRelease = (): void => undefined;

const createUrlSchemeLease = async (
  absolutePath: string,
  effectivePath: string
): Promise<FreshAppLease> => {
  const mod = (await importWithCacheBust(absolutePath)) as Record<
    string,
    unknown
  >;
  return {
    app: resolveLoadedTopo(effectivePath, mod),
    cliAliases: resolveLoadedCliAliases(effectivePath, mod),
    mirrorRoot: absolutePath,
    release: noopRelease,
  };
};

const createFilesystemLease = async (
  absolutePath: string,
  cwd: string,
  effectivePath: string
): Promise<FreshAppLease> => {
  const { mirrorRoot, freshPath } = await prepareMirror(absolutePath, cwd);
  const release = acquireMirrorLease(mirrorRoot);

  try {
    const mod = (await import(pathToFileURL(freshPath).href)) as Record<
      string,
      unknown
    >;

    return {
      app: resolveLoadedTopo(effectivePath, mod),
      cliAliases: resolveLoadedCliAliases(effectivePath, mod),
      mirrorRoot,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
};

export const loadFreshAppLease = async (
  modulePath: string | undefined,
  cwd: string,
  options: LoadAppLeaseOptions = {}
): Promise<FreshAppLease> => {
  const effectivePath =
    modulePath === undefined ? findWorkspaceRelativeAppModule(cwd) : modulePath;
  const absolutePath = resolveLoadAppModulePath(effectivePath, cwd, options);

  return URL_SCHEME.test(absolutePath) && !absolutePath.startsWith('/')
    ? await createUrlSchemeLease(absolutePath, effectivePath)
    : await createFilesystemLease(absolutePath, cwd, effectivePath);
};

export const tryLoadFreshAppLease = async (
  modulePath: string | undefined,
  cwd: string,
  options: LoadAppLeaseOptions = {}
): Promise<Result<FreshAppLease, Error>> => {
  try {
    return Result.ok(await loadFreshAppLease(modulePath, cwd, options));
  } catch (error) {
    return Result.err(toLoadAppError(error));
  }
};

/**
 * Load a Topo export from a module path relative to cwd.
 *
 * @remarks
 * By default, `modulePath` must be workspace-relative and stay under `cwd`.
 * URL-shaped, absolute, and parent-escape paths are rejected. Trusted internal
 * callers can pass `trustedModulePath: true` to deliberately use the broader
 * dynamic-import escape hatch.
 */
export const loadApp = async (
  modulePath: string | undefined,
  cwd: string,
  options: LoadAppOptions = {}
): Promise<Topo> => {
  const effectivePath =
    modulePath === undefined ? findWorkspaceRelativeAppModule(cwd) : modulePath;
  const resolvedModulePath = resolveLoadAppModulePath(
    effectivePath,
    cwd,
    options
  );
  const mod =
    options.fresh === true
      ? await importFreshModule(resolvedModulePath, cwd)
      : ((await import(
          URL_SCHEME.test(resolvedModulePath) &&
            !resolvedModulePath.startsWith('/')
            ? new URL(resolvedModulePath).href
            : pathToFileURL(resolvedModulePath).href
        )) as Record<string, unknown>);
  return resolveLoadedTopo(effectivePath, mod);
};
