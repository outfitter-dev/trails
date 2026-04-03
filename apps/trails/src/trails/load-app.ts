import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Topo } from '@ontrails/core';

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

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

const freshModuleCopyPath = (absolutePath: string): string =>
  join(
    dirname(absolutePath),
    `.__fresh-${Date.now()}-${Math.random().toString(36).slice(2)}-${basename(absolutePath)}`
  );

/**
 * Import a module bypassing the ESM cache for the entry file.
 *
 * @remarks
 * Cache-busting applies to the entry module only. Transitive imports resolved
 * by the entry file are still served from Bun's module cache. This is
 * acceptable for the draft promotion workflow (the only caller) because
 * promotion changes which modules the entry file imports, not the modules
 * themselves. If a deeper cache-bust is needed in the future, consider
 * Bun's `Loader.registry` or a full process restart.
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

  const freshPath = freshModuleCopyPath(absolutePath);
  await Bun.write(freshPath, await Bun.file(absolutePath).text());

  try {
    return (await import(pathToFileURL(freshPath).href)) as Record<
      string,
      unknown
    >;
  } finally {
    rmSync(freshPath, { force: true });
  }
};

/** Load a Topo export from a module path relative to cwd. */
export const loadApp = async (
  modulePath: string,
  cwd: string,
  options: { fresh?: boolean | undefined } = {}
): Promise<Topo> => {
  const resolvedModulePath = resolveAbsoluteModulePath(modulePath, cwd);
  const mod =
    options.fresh === true
      ? await importFreshModule(modulePath, cwd)
      : ((await import(
          URL_SCHEME.test(resolvedModulePath) &&
            !resolvedModulePath.startsWith('/')
            ? new URL(resolvedModulePath).href
            : pathToFileURL(resolvedModulePath).href
        )) as Record<string, unknown>);
  const app = (mod['default'] ?? mod['app']) as Topo | undefined;
  if (!app?.trails) {
    throw new Error(
      `Could not find a Topo export in "${modulePath}". ` +
        "Expected a default or named 'app' export created with topo()."
    );
  }
  return app;
};
