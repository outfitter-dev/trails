import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
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

import { deriveSafePath, PermissionError } from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { findAppModule } from '@ontrails/cli';

import {
  createLoadAppMirrorRootPath,
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

const readPackageName = (packagePath: string): string | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as
      | { readonly name?: unknown }
      | undefined;
    return typeof parsed?.name === 'string' && parsed.name.length > 0
      ? parsed.name
      : undefined;
  } catch {
    return undefined;
  }
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

const shouldMirrorImportSpecifier = (
  importerPath: string,
  importPath: string
): boolean =>
  isLocalFilesystemImport(importPath) ||
  isPackageLocalImport(importerPath, importPath);

const isScannableModule = (modulePath: string): boolean =>
  SCANNABLE_EXTENSIONS.has(extname(modulePath));

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

const collectImportedModulePaths = (
  modulePath: string,
  source: string
): readonly string[] => {
  const extension = extname(modulePath);
  const loader = LOADER_BY_EXTENSION[extension];
  if (loader === undefined) {
    return [];
  }

  return getImportScanner(loader)
    .scanImports(source)
    .map((entry) => entry.path)
    .filter((importPath) => shouldMirrorImportSpecifier(modulePath, importPath))
    .map((importPath) => resolveImportedModulePath(modulePath, importPath));
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
  readonly mirrorRoot: string;
  readonly copied: Set<string>;
  readonly visitedDirectories: Set<string>;
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
  visit: (path: string) => Promise<void>
): Promise<void> => {
  if (!isScannableModule(modulePath)) {
    return;
  }
  const source = await Bun.file(modulePath).text();
  for (const importedPath of collectImportedModulePaths(modulePath, source)) {
    await visit(importedPath);
  }
};

const mirrorFreshImportGraph = async (
  entryPath: string,
  mirrorRoot: string
): Promise<string> => {
  const scanned = new Set<string>();
  const context: MirrorWalkContext = {
    copied: new Set<string>(),
    mirrorRoot,
    visitedDirectories: new Set<string>(),
  };

  const visit = async (modulePath: string): Promise<void> => {
    if (scanned.has(modulePath)) {
      return;
    }
    scanned.add(modulePath);
    await scanAndVisitLocalImports(modulePath, visit);
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
  const mirrorRoot = freshMirrorRootPath(cwd);
  try {
    const freshPath = await mirrorFreshImportGraph(absolutePath, mirrorRoot);
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
    throw new Error(
      `Could not find a Topo export in "${effectivePath}". ` +
        "Expected a default, 'graph', or 'app' named export created with topo()."
    );
  }
  return app;
};

export interface FreshAppLease {
  readonly app: Topo;
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
): Promise<FreshAppLease> => ({
  app: resolveLoadedTopo(
    effectivePath,
    await importWithCacheBust(absolutePath)
  ),
  mirrorRoot: absolutePath,
  release: noopRelease,
});

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
