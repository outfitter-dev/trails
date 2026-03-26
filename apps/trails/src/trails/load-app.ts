import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Topo } from '@ontrails/core';

const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/** Resolve a module path from cwd so CLI defaults behave like shell paths. */
const resolveModuleSpecifier = (modulePath: string, cwd: string): string => {
  if (URL_SCHEME.test(modulePath)) {
    return modulePath;
  }

  const absolutePath = isAbsolute(modulePath)
    ? modulePath
    : resolve(cwd, modulePath);
  return pathToFileURL(absolutePath).href;
};

/** Load a Topo export from a module path relative to cwd. */
export const loadApp = async (
  modulePath: string,
  cwd: string
): Promise<Topo> => {
  const mod = (await import(resolveModuleSpecifier(modulePath, cwd))) as Record<
    string,
    unknown
  >;
  const app = (mod['default'] ?? mod['app']) as Topo | undefined;
  if (!app?.trails) {
    throw new Error(
      `Could not find a Topo export in "${modulePath}". ` +
        "Expected a default or named 'app' export created with topo()."
    );
  }
  return app;
};
