import fs from 'node:fs';

import {
  ConflictError,
  InternalError,
  Result,
  TrailsError,
  ValidationError,
} from '@ontrails/core';

/** A selected regular file pinned open until recovery finishes. */
export interface OpenResolvedLock {
  readonly descriptor: number;
  readonly device: bigint;
  readonly inode: bigint;
  readonly path: string;
}

const changedLock = (path: string): ConflictError =>
  new ConflictError(
    `Lock identity or bytes changed during resolve: ${path}. Restore the selected regular lock and retry after the other writer stops.`
  );

const writeFailure = (error: unknown, path: string): TrailsError => {
  if (error instanceof TrailsError) {
    return error;
  }
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ELOOP' ||
      error.code === 'ENOENT' ||
      error.code === 'EISDIR' ||
      error.code === 'ENOTDIR')
  ) {
    return changedLock(path);
  }
  return new InternalError(
    `Unable to write the selected lock safely: ${path}.`,
    error instanceof Error ? { cause: error } : {}
  );
};

/** Close every acquired descriptor, including on preflight failures. */
export const closeResolvedLock = (
  file: Pick<OpenResolvedLock, 'descriptor' | 'path'>
): Result<void, TrailsError> => {
  try {
    fs.closeSync(file.descriptor);
    return Result.ok();
  } catch (error) {
    return Result.err(
      new InternalError(
        `Unable to close the selected lock: ${file.path}.`,
        error instanceof Error ? { cause: error } : {}
      )
    );
  }
};

/** Pin a readable file without demanding write access for a no-op recovery. */
export const openResolvedLock = (
  path: string
): Result<OpenResolvedLock, TrailsError> => {
  let descriptor: number | undefined;
  try {
    const expected = fs.lstatSync(path, {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (expected === undefined) {
      return Result.err(
        new ValidationError(
          'The selected trails.lock does not exist. Use trails compile for a first compile.'
        )
      );
    }
    if (!expected.isFile()) {
      return Result.err(
        new ValidationError(
          'The selected trails.lock must be a regular file, not a symbolic link or directory. Restore the selected generated lock before retrying.'
        )
      );
    }
    descriptor = fs.openSync(
      path,
      // eslint-disable-next-line no-bitwise -- POSIX open flags are combined as a bit mask.
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const actual = fs.fstatSync(descriptor, { bigint: true });
    if (
      !actual.isFile() ||
      actual.dev !== expected.dev ||
      actual.ino !== expected.ino
    ) {
      throw changedLock(path);
    }
    return Result.ok({
      descriptor,
      device: actual.dev,
      inode: actual.ino,
      path,
    });
  } catch (error) {
    if (descriptor !== undefined) {
      const closed = closeResolvedLock({ descriptor, path });
      if (closed.isErr()) {
        return closed;
      }
    }
    return Result.err(writeFailure(error, path));
  }
};

const selectedPathStillMatches = (file: OpenResolvedLock): boolean => {
  const current = fs.lstatSync(file.path, {
    bigint: true,
    throwIfNoEntry: false,
  });
  return (
    current !== undefined &&
    current.isFile() &&
    current.dev === file.device &&
    current.ino === file.inode
  );
};

/**
 * Acquire write access only for changed bytes, while the read pin stays open.
 *
 * Unlike the pathname write in project-writes.ts, verify the writable descriptor
 * against the preflight pin before writing. Later path swaps cannot redirect it.
 */
export const writeResolvedLock = (
  file: OpenResolvedLock,
  originalContent: string,
  content: string
): Result<void, TrailsError> => {
  try {
    if (
      !selectedPathStillMatches(file) ||
      fs.readFileSync(file.descriptor, 'utf8') !== originalContent
    ) {
      return Result.err(changedLock(file.path));
    }
    if (content === originalContent) {
      return selectedPathStillMatches(file)
        ? Result.ok()
        : Result.err(changedLock(file.path));
    }
    const descriptor = fs.openSync(
      file.path,
      // eslint-disable-next-line no-bitwise -- POSIX open flags are combined as a bit mask.
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0)
    );
    try {
      const writable = fs.fstatSync(descriptor, { bigint: true });
      if (
        !writable.isFile() ||
        writable.dev !== file.device ||
        writable.ino !== file.inode ||
        !selectedPathStillMatches(file) ||
        fs.readFileSync(descriptor, 'utf8') !== originalContent
      ) {
        return Result.err(changedLock(file.path));
      }
      const bytes = Buffer.from(content);
      let written = 0;
      while (written < bytes.length) {
        const count = fs.writeSync(
          descriptor,
          bytes,
          written,
          bytes.length - written,
          written
        );
        if (count === 0) {
          return Result.err(
            new InternalError(
              `Unable to complete the selected lock write: ${file.path}.`
            )
          );
        }
        written += count;
      }
      fs.ftruncateSync(descriptor, bytes.length);
      return selectedPathStillMatches(file)
        ? Result.ok()
        : Result.err(changedLock(file.path));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    return Result.err(writeFailure(error, file.path));
  }
};
