import { mkdirSync, rmSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
} from 'node:path';

import {
  deriveSafePath,
  InternalError,
  PermissionError,
  Result,
  ValidationError,
} from '@ontrails/core';
// Result is imported as a value for factories above; this alias keeps returned
// Result types readable without colliding with the value import.
import type { Result as TrailsResult } from '@ontrails/core';

export const LOAD_APP_MIRROR_PARENT_DIRNAME = '.trails-tmp';

export const LOAD_APP_MIRROR_ENTRY_PREFIX = 'load-app-fresh-';

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const validateMirrorRoot = (
  mirrorRoot: string
): TrailsResult<string, PermissionError> => {
  const resolved = resolve(mirrorRoot);
  const mirrorParent = dirname(resolved);

  return basename(mirrorParent) === LOAD_APP_MIRROR_PARENT_DIRNAME &&
    basename(resolved).startsWith(LOAD_APP_MIRROR_ENTRY_PREFIX)
    ? Result.ok(resolved)
    : Result.err(
        new PermissionError(
          `Refusing to write or remove non-load-app mirror path "${mirrorRoot}"`,
          { context: { mirrorRoot: resolved } }
        )
      );
};

const resolveAbsoluteSourcePath = (
  sourcePath: string
): TrailsResult<string, ValidationError> =>
  isAbsolute(sourcePath)
    ? Result.ok(sourcePath)
    : Result.err(
        new ValidationError(
          `Load-app mirror source path must be absolute: "${sourcePath}"`,
          { context: { sourcePath } }
        )
      );

/**
 * Convert an absolute source path to the deterministic location inside a
 * load-app fresh mirror.
 */
export const resolveLoadAppMirrorFilePath = (
  sourcePath: string,
  mirrorRoot: string
): TrailsResult<string, Error> => {
  const root = validateMirrorRoot(mirrorRoot);
  if (root.isErr()) {
    return root;
  }

  const source = resolveAbsoluteSourcePath(sourcePath);
  if (source.isErr()) {
    return source;
  }

  const mirrorRelativePath = relative(
    parsePath(source.value).root,
    source.value
  );
  return deriveSafePath(root.value, mirrorRelativePath);
};

/**
 * Copy a source file into its load-app fresh mirror by raw bytes.
 *
 * @remarks
 * Reading via `.bytes()` rather than `.text()` preserves binary payloads
 * (`.wasm`, `.node`, compiled assets) that may sit alongside source files in
 * the app's graph. Text decoding would corrupt them on the way through the
 * mirror.
 */
export const writeLoadAppMirrorFile = async (
  sourcePath: string,
  mirrorRoot: string
): Promise<TrailsResult<string, Error>> => {
  const mirrorPath = resolveLoadAppMirrorFilePath(sourcePath, mirrorRoot);
  if (mirrorPath.isErr()) {
    return mirrorPath;
  }

  try {
    mkdirSync(dirname(mirrorPath.value), { recursive: true });
    const bytes = await Bun.file(sourcePath).bytes();
    await Bun.write(mirrorPath.value, bytes);
    return Result.ok(mirrorPath.value);
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to mirror load-app file "${sourcePath}"`, {
        cause: asError(error),
        context: { mirrorPath: mirrorPath.value, mirrorRoot, sourcePath },
      })
    );
  }
};

export const removeLoadAppMirrorRoot = (
  mirrorRoot: string
): TrailsResult<void, Error> => {
  const root = validateMirrorRoot(mirrorRoot);
  if (root.isErr()) {
    return root;
  }

  try {
    rmSync(root.value, { force: true, recursive: true });
    return Result.ok();
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to remove load-app mirror "${mirrorRoot}"`, {
        cause: asError(error),
        context: { mirrorRoot: root.value },
      })
    );
  }
};

/**
 * Best-effort cleanup for process-exit and stale-sweep paths.
 *
 * This intentionally suppresses validation and filesystem failures because the
 * caller is already abandoning a temporary mirror and cleanup must not turn
 * into an application-load failure.
 */
export const removeLoadAppMirrorRootQuietly = (mirrorRoot: string): void => {
  try {
    removeLoadAppMirrorRoot(mirrorRoot);
  } catch {
    // Best-effort cleanup must never become the failure path.
  }
};

export const createLoadAppMirrorRootPath = (cwd: string): string =>
  join(
    resolve(cwd),
    LOAD_APP_MIRROR_PARENT_DIRNAME,
    `${LOAD_APP_MIRROR_ENTRY_PREFIX}${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
  );
