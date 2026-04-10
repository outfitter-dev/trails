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
 * Returns relative candidate paths in priority order: single-app layout
 * first, then monorepo entries in filesystem scan order.
 */
export const discoverAppModules = (cwd: string): string[] => {
  const candidates: string[] = [];

  if (existsSync(join(cwd, 'src/app.ts'))) {
    candidates.push('src/app.ts');
  }

  const glob = new Bun.Glob('apps/*/src/app.ts');
  for (const match of glob.scanSync({ cwd, onlyFiles: true })) {
    candidates.push(match);
  }

  return candidates;
};

/** Resolve the app module path, using discovery when no explicit path is provided. */
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
