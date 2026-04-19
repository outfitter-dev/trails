import { existsSync, mkdirSync, rmSync } from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Topo } from '@ontrails/core';
import { findAppModule } from '@ontrails/cli';

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

const cleanupAllMirrorRoots = (): void => {
  for (const root of ACTIVE_MIRROR_ROOTS) {
    rmSync(root, { force: true, recursive: true });
  }
  ACTIVE_MIRROR_ROOTS.clear();
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

/** Resolve a module path from cwd so CLI defaults behave like shell paths. */
const resolveAbsoluteModulePath = (modulePath: string, cwd: string): string =>
  URL_SCHEME.test(modulePath)
    ? resolveUrlModulePath(modulePath)
    : resolveFilesystemModulePath(modulePath, cwd);

const freshMirrorRootPath = (cwd: string): string =>
  join(
    cwd,
    '.trails-tmp',
    `load-app-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

/**
 * Convert an absolute path to a drive-safe relative form before appending it
 * to the mirror root. `path.parse(...).root` returns `'/'` on POSIX and
 * `'C:\\'` (or similar) on Windows, so `relative` strips the platform root
 * in both cases.
 */
const freshMirrorPath = (absolutePath: string, mirrorRoot: string): string =>
  join(mirrorRoot, relative(parsePath(absolutePath).root, absolutePath));

const isLocalFilesystemImport = (importPath: string): boolean =>
  importPath.startsWith('.') ||
  importPath.startsWith('/') ||
  importPath.startsWith('file:');

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
    .filter(isLocalFilesystemImport)
    .map((importPath) => resolveImportedModulePath(modulePath, importPath));
};

const mirrorFreshImportGraph = async (
  entryPath: string,
  mirrorRoot: string
): Promise<string> => {
  const seen = new Set<string>();

  const visit = async (modulePath: string): Promise<void> => {
    if (seen.has(modulePath)) {
      return;
    }
    seen.add(modulePath);

    const source = await Bun.file(modulePath).text();
    if (isScannableModule(modulePath)) {
      for (const importedPath of collectImportedModulePaths(
        modulePath,
        source
      )) {
        await visit(importedPath);
      }
    }

    const mirrorPath = freshMirrorPath(modulePath, mirrorRoot);
    mkdirSync(dirname(mirrorPath), { recursive: true });
    await Bun.write(mirrorPath, source);
  };

  await visit(entryPath);
  return freshMirrorPath(entryPath, mirrorRoot);
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
    rmSync(mirrorRoot, { force: true, recursive: true });
    throw error;
  }
};

const importFreshModule = async (
  modulePath: string,
  cwd: string
): Promise<Record<string, unknown>> => {
  const absolutePath = resolveAbsoluteModulePath(modulePath, cwd);
  if (URL_SCHEME.test(absolutePath) && !absolutePath.startsWith('/')) {
    return await importWithCacheBust(absolutePath);
  }

  const { mirrorRoot, freshPath } = await prepareMirror(absolutePath, cwd);
  ACTIVE_MIRROR_ROOTS.add(mirrorRoot);
  ensureMirrorCleanupHook();
  return (await import(pathToFileURL(freshPath).href)) as Record<
    string,
    unknown
  >;
};

/** Load a Topo export from a module path relative to cwd. */
export const loadApp = async (
  modulePath: string | undefined,
  cwd: string,
  options: { fresh?: boolean | undefined } = {}
): Promise<Topo> => {
  const effectivePath =
    modulePath === undefined ? findAppModule(cwd) : modulePath;
  const resolvedModulePath = resolveAbsoluteModulePath(effectivePath, cwd);
  const mod =
    options.fresh === true
      ? await importFreshModule(resolvedModulePath, cwd)
      : ((await import(
          URL_SCHEME.test(resolvedModulePath) &&
            !resolvedModulePath.startsWith('/')
            ? new URL(resolvedModulePath).href
            : pathToFileURL(resolvedModulePath).href
        )) as Record<string, unknown>);
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
