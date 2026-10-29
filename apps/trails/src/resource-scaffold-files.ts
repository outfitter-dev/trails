import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  ConflictError,
  InternalError,
  Result,
  ValidationError,
} from '@ontrails/core';

import { resolveProjectPath } from './project-writes.js';

const preflightResourceFiles = (
  cwd: string,
  files: ReadonlyMap<string, string>
): Result<Map<string, string>, Error> => {
  try {
    for (const parent of ['src', 'src/resources', '__tests__']) {
      const path = resolveProjectPath(cwd, parent);
      if (path.isErr()) {
        return path;
      }
      const entry = lstatSync(path.value, { throwIfNoEntry: false });
      if (entry?.isSymbolicLink()) {
        return Result.err(
          new ValidationError(
            `Resource scaffold parent "${parent}" must not be a symbolic link.`
          )
        );
      }
      if (entry !== undefined && !entry.isDirectory()) {
        return Result.err(
          new ConflictError(
            `Resource scaffold parent "${parent}" is not a directory.`
          )
        );
      }
    }
    const targets = new Map<string, string>();
    for (const [name, content] of files) {
      const path = resolveProjectPath(cwd, name);
      if (path.isErr()) {
        return path;
      }
      if (lstatSync(path.value, { throwIfNoEntry: false }) !== undefined) {
        return Result.err(
          new ConflictError(`Resource scaffold file "${name}" already exists.`)
        );
      }
      targets.set(path.value, content);
    }
    return Result.ok(targets);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to inspect resource scaffold paths.', {
        cause: error instanceof Error ? error : new Error(String(error)),
      })
    );
  }
};

/**
 * Unlike independent writes in project-writes.ts:95, this resource pair must
 * create exclusively and remove only invocation-owned files on failure.
 * Path and identity checks are best-effort; they are not filesystem transactions.
 */
const writeResourceFiles = (
  files: ReadonlyMap<string, string>
): Result<void, Error> => {
  const owned: { path: string; dev: number; ino: number }[] = [];
  try {
    for (const [path, content] of files) {
      mkdirSync(dirname(path), { recursive: true });
      const fd = openSync(path, 'wx');
      try {
        const { dev, ino } = fstatSync(fd);
        owned.push({ dev, ino, path });
        writeFileSync(fd, content);
      } finally {
        closeSync(fd);
      }
    }
    return Result.ok();
  } catch (error) {
    const remaining: string[] = [];
    for (const { path, dev, ino } of owned.toReversed()) {
      try {
        if (!existsSync(path)) {
          continue;
        }
        const current = lstatSync(path);
        if (current.dev !== dev || current.ino !== ino) {
          continue;
        }
        unlinkSync(path);
      } catch {
        remaining.push(path);
      }
    }
    if (remaining.length > 0) {
      return Result.err(
        new InternalError(
          'Resource scaffold failed and some created files could not be removed.',
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            context: { remaining },
          }
        )
      );
    }
    return Result.err(
      error instanceof Error && 'code' in error && error.code === 'EEXIST'
        ? new ConflictError(
            'A resource scaffold target appeared during creation.',
            { cause: error }
          )
        : new InternalError('Failed to create resource scaffold files.', {
            cause: error instanceof Error ? error : new Error(String(error)),
          })
    );
  }
};

/** Create the resource definition/test pair with preflight, exclusive creation, and bounded rollback. */
export const writeResourceScaffoldFiles = (
  cwd: string,
  files: ReadonlyMap<string, string>
): Result<void, Error> => {
  const targets = preflightResourceFiles(cwd, files);
  return targets.isErr() ? targets : writeResourceFiles(targets.value);
};
