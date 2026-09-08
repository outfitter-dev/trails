import {
  ConflictError,
  InternalError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const errorCause = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

interface FileDigestEntry {
  readonly bytes: Uint8Array;
  readonly path: string;
}

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

export const collectRegularFiles = async (
  root: string,
  current = root
): Promise<
  TrailsResult<readonly FileDigestEntry[], ValidationError | InternalError>
> => {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    return Result.err(
      new InternalError('Package source files could not be enumerated.', {
        cause: errorCause(error),
        context: { current, root },
      })
    );
  }
  const files: FileDigestEntry[] = [];
  for (const entry of entries.toSorted((left, right) =>
    compareCodeUnits(left.name, right.name)
  )) {
    const absolutePath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      return Result.err(
        new ValidationError('Package source contains a symbolic link.', {
          context: { path: relative(root, absolutePath) },
        })
      );
    }
    if (entry.isDirectory()) {
      const nested = await collectRegularFiles(root, absolutePath);
      if (nested.isErr()) {
        return nested;
      }
      files.push(...nested.value);
      continue;
    }
    if (!entry.isFile()) {
      return Result.err(
        new ValidationError('Package source contains a non-regular file.', {
          context: { path: relative(root, absolutePath) },
        })
      );
    }
    try {
      files.push({
        bytes: await readFile(absolutePath),
        path: relative(root, absolutePath).split(sep).join('/'),
      });
    } catch (error) {
      return Result.err(
        new InternalError('Package source file could not be read.', {
          cause: errorCause(error),
          context: { path: relative(root, absolutePath) },
        })
      );
    }
  }
  return Result.ok(files);
};

const contentDigest = (files: readonly FileDigestEntry[]): string => {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(String(Buffer.byteLength(file.path)));
    hash.update('\0');
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.bytes.byteLength));
    hash.update('\0');
    hash.update(file.bytes);
  }
  return hash.digest('hex');
};

export const compareInstalledFiles = async (
  artifactFiles: readonly FileDigestEntry[],
  installedRoot: string
): Promise<
  TrailsResult<string, ConflictError | InternalError | ValidationError>
> => {
  for (const artifactFile of artifactFiles) {
    const installedPath = join(installedRoot, artifactFile.path);
    try {
      const installedRealPath = await realpath(installedPath);
      const installedRelative = relative(
        await realpath(installedRoot),
        installedRealPath
      );
      if (
        installedRelative === '..' ||
        installedRelative.startsWith(`..${sep}`) ||
        isAbsolute(installedRelative)
      ) {
        return Result.err(
          new ConflictError(
            'Installed package file resolves outside its package root.',
            {
              context: { path: artifactFile.path },
            }
          )
        );
      }
      const status = await lstat(installedPath);
      if (!status.isFile() || status.isSymbolicLink()) {
        return Result.err(
          new ConflictError('Installed package file is not a regular file.', {
            context: { path: artifactFile.path },
          })
        );
      }
      const installedBytes = await readFile(installedPath);
      if (
        !Buffer.from(installedBytes).equals(Buffer.from(artifactFile.bytes))
      ) {
        return Result.err(
          new ConflictError(
            'Installed package bytes do not match the selected artifact.',
            {
              context: { path: artifactFile.path },
            }
          )
        );
      }
    } catch (error) {
      return Result.err(
        new ConflictError(
          'Installed package is missing a shipped artifact file.',
          {
            cause: errorCause(error),
            context: { path: artifactFile.path },
          }
        )
      );
    }
  }
  const installedFiles = await collectRegularFiles(installedRoot);
  if (installedFiles.isErr()) {
    return installedFiles;
  }
  const artifactPaths = new Set(artifactFiles.map((file) => file.path));
  const installedPaths = new Set(installedFiles.value.map((file) => file.path));
  const missingInstalledFile = artifactFiles.find(
    (file) => !installedPaths.has(file.path)
  );
  if (missingInstalledFile !== undefined) {
    return Result.err(
      new ConflictError(
        'Installed package is missing a shipped artifact file.',
        { context: { path: missingInstalledFile.path } }
      )
    );
  }
  const extraInstalledFile = installedFiles.value.find(
    (file) => !artifactPaths.has(file.path)
  );
  if (extraInstalledFile !== undefined) {
    return Result.err(
      new ConflictError(
        'Installed package contains a regular file not shipped by the selected artifact.',
        { context: { path: extraInstalledFile.path } }
      )
    );
  }
  return Result.ok(contentDigest(artifactFiles));
};
