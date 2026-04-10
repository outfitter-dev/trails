import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AmbiguousError, NotFoundError } from '@ontrails/core';

/**
 * Scan for Trails app entry points using fast heuristics (no AST parsing).
 *
 * Checks candidates in priority order:
 * 1. `src/app.ts` relative to cwd (single-app layout)
 * 2. `apps/* /src/app.ts` via glob (monorepo convention)
 *
 * Returns candidate module paths sorted by specificity (most specific first).
 */
export const discoverAppModules = (cwd: string): string[] => {
  const candidates: string[] = [];

  const singleApp = join(cwd, 'src/app.ts');
  if (existsSync(singleApp)) {
    candidates.push(singleApp);
  }

  const glob = new Bun.Glob('apps/*/src/app.ts');
  for (const match of glob.scanSync({ cwd, onlyFiles: true })) {
    candidates.push(join(cwd, match));
  }

  return candidates;
};

/**
 * Resolve the app module path, using discovery when no explicit path is provided.
 *
 * When `explicit` is provided, returns it as-is without discovery.
 * Otherwise discovers candidates and returns the single match, or throws
 * `NotFoundError` (none found) or `AmbiguousError` (multiple found).
 */
export const resolveAppModule = (cwd: string, explicit?: string): string => {
  if (explicit !== undefined) {
    return explicit;
  }

  const candidates = discoverAppModules(cwd);

  const [first] = candidates;
  if (candidates.length === 1 && first !== undefined) {
    return first;
  }

  if (candidates.length > 1) {
    const listing = candidates.map((c) => `  - ${c}`).join('\n');
    throw new AmbiguousError(
      `Found multiple Trails app entry points:\n${listing}\n\nUse --module to select one explicitly.`
    );
  }

  throw new NotFoundError(
    'No Trails app entry point found. Expected src/app.ts or apps/*/src/app.ts. Use --module to specify the path.'
  );
};
