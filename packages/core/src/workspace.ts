/**
 * Workspace detection utilities.
 *
 * Walks the filesystem to find monorepo workspace roots and provides
 * helpers for working with paths relative to a workspace.
 */

import { resolve, relative, dirname, join, isAbsolute } from 'node:path';

import { NotFoundError } from './errors.js';
import { Result } from './result.js';

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
export const getRelativePath = (
  filePath: string,
  workspaceRoot: string
): string => relative(resolve(workspaceRoot), resolve(filePath));
