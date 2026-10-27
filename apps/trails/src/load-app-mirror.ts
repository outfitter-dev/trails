import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

export const LOAD_APP_MIRROR_PARENT_DIRNAME = `trails-load-app-${process.getuid?.() ?? 'user'}`;

export const LOAD_APP_MIRROR_ENTRY_PREFIX = 'load-app-fresh-';

const MIRROR_OWNERS = new Set<string>();

const filesystemCode = (error: unknown): string =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN';

export const loadAppMirrorFailure = (
  operation: 'allocate' | 'write',
  error: unknown
): PermissionError | ValidationError => {
  const code = filesystemCode(error);
  const ErrorClass =
    error instanceof PermissionError ||
    ['EACCES', 'EPERM', 'EROFS'].includes(code)
      ? PermissionError
      : ValidationError;
  return new ErrorClass(
    `Cannot ${operation} fresh app-load scratch data in the OS temporary owner. Check temporary-directory permissions and free space, or set TMPDIR to a writable location outside the target worktree.`,
    { context: { boundary: 'load-app-scratch', code, operation } }
  );
};

const unsafeMirrorPath = (): PermissionError =>
  new PermissionError('Refusing an unsafe load-app scratch path.', {
    context: { boundary: 'load-app-scratch' },
  });

const validateMirrorOwner = (owner: string): void => {
  const stat = lstatSync(owner);
  // oxlint-disable-next-line no-bitwise -- filesystem permission mask
  const exposedPermissions = stat.mode & 0o077;
  if (
    !stat.isDirectory() ||
    realpathSync(owner) !== owner ||
    (process.getuid !== undefined &&
      (stat.uid !== process.getuid() || exposedPermissions !== 0))
  ) {
    throw unsafeMirrorPath();
  }
};

const validateMirrorRoot = (
  mirrorRoot: string
): TrailsResult<string, PermissionError> => {
  const resolved = resolve(mirrorRoot);
  const mirrorParent = dirname(resolved);

  if (
    !MIRROR_OWNERS.has(mirrorParent) ||
    !/^load-app-fresh-\d+-[\dA-Za-z]+$/.test(basename(resolved))
  ) {
    return Result.err(unsafeMirrorPath());
  }
  try {
    validateMirrorOwner(mirrorParent);
    const stat = lstatSync(resolved, { throwIfNoEntry: false });
    return stat === undefined || (stat.isDirectory() && !stat.isSymbolicLink())
      ? Result.ok(resolved)
      : Result.err(unsafeMirrorPath());
  } catch {
    return Result.err(unsafeMirrorPath());
  }
};

const isPathInside = (root: string, target: string): boolean => {
  const candidate = relative(root, target);
  return (
    candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))
  );
};

const assertNoMirrorSymlinks = (target: string, root: string): void => {
  let current = target;
  while (current !== root) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw unsafeMirrorPath();
    }
    current = dirname(current);
  }
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

export const ensureLoadAppMirrorDirectory = (
  directoryPath: string,
  mirrorRoot: string
): TrailsResult<void, Error> => {
  const root = validateMirrorRoot(mirrorRoot);
  if (root.isErr()) {
    return root;
  }

  const target = resolve(directoryPath);
  if (!isPathInside(root.value, target)) {
    return Result.err(unsafeMirrorPath());
  }

  try {
    assertNoMirrorSymlinks(target, root.value);
    mkdirSync(target, { recursive: true });
    return Result.ok();
  } catch (error) {
    return Result.err(
      error instanceof PermissionError
        ? error
        : loadAppMirrorFailure('write', error)
    );
  }
};

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

  let bytes: Uint8Array;
  try {
    bytes = await Bun.file(sourcePath).bytes();
  } catch (error) {
    return Result.err(
      new ValidationError('Failed to read app-load source file.', {
        context: { boundary: 'load-app-source', code: filesystemCode(error) },
      })
    );
  }

  try {
    assertNoMirrorSymlinks(mirrorPath.value, resolve(mirrorRoot));
    mkdirSync(dirname(mirrorPath.value), { recursive: true });
    await Bun.write(mirrorPath.value, bytes);
    return Result.ok(mirrorPath.value);
  } catch (error) {
    return Result.err(
      error instanceof PermissionError
        ? error
        : loadAppMirrorFailure('write', error)
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
      new InternalError('Failed to remove load-app scratch data.', {
        context: { boundary: 'load-app-scratch', code: filesystemCode(error) },
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

export const createLoadAppMirrorRootPath = (
  cwd: string,
  temporaryDirectory: string = tmpdir()
): string => {
  try {
    const owner = join(
      realpathSync(temporaryDirectory),
      LOAD_APP_MIRROR_PARENT_DIRNAME
    );
    if (isPathInside(realpathSync(cwd), owner)) {
      throw unsafeMirrorPath();
    }
    mkdirSync(owner, { mode: 0o700, recursive: true });
    validateMirrorOwner(owner);
    MIRROR_OWNERS.add(owner);
    return mkdtempSync(
      join(owner, `${LOAD_APP_MIRROR_ENTRY_PREFIX}${process.pid}-`)
    );
  } catch (error) {
    throw loadAppMirrorFailure('allocate', error);
  }
};
