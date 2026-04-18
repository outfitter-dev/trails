import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Topo } from '@ontrails/core';
import { findAppModule } from '@ontrails/cli';

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const IMPORT_SCANNER = new Bun.Transpiler({ loader: 'ts' });
const SCANNABLE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
]);

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

const freshMirrorPath = (absolutePath: string, mirrorRoot: string): string =>
  join(mirrorRoot, absolutePath.replace(/^\/+/, ''));

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
  if (!isScannableModule(modulePath)) {
    return [];
  }

  return IMPORT_SCANNER.scanImports(source)
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
    for (const importedPath of collectImportedModulePaths(modulePath, source)) {
      await visit(importedPath);
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
 * filesystem imports are mirrored into the fresh temp root.
 */
const importFreshModule = async (
  modulePath: string,
  cwd: string
): Promise<Record<string, unknown>> => {
  const absolutePath = resolveAbsoluteModulePath(modulePath, cwd);
  if (URL_SCHEME.test(absolutePath) && !absolutePath.startsWith('/')) {
    const url = new URL(absolutePath);
    url.searchParams.set('t', Date.now().toString());
    return (await import(url.href)) as Record<string, unknown>;
  }

  const mirrorRoot = freshMirrorRootPath(cwd);
  const freshPath = await mirrorFreshImportGraph(absolutePath, mirrorRoot);

  try {
    return (await import(pathToFileURL(freshPath).href)) as Record<
      string,
      unknown
    >;
  } finally {
    rmSync(mirrorRoot, { force: true, recursive: true });
  }
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
