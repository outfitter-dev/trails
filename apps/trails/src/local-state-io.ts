import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  deriveSafePath,
  InternalError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';

const EXAMPLE_ROOT_PARENT = join(tmpdir(), 'ontrails-trails-examples');
const EXAMPLE_ROOT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const resolveExampleRoot = (name: string): TrailsResult<string, Error> => {
  if (!EXAMPLE_ROOT_NAME_PATTERN.test(name)) {
    return Result.err(
      new ValidationError(
        'Example root name must be lowercase and contain only letters, digits, ".", "_", or "-".',
        { context: { name } }
      )
    );
  }

  return deriveSafePath(EXAMPLE_ROOT_PARENT, name);
};

export const createIsolatedExampleRoot = (name: string): string => {
  const root = resolveExampleRoot(name);
  if (root.isErr()) {
    throw root.error;
  }

  try {
    rmSync(root.value, { force: true, recursive: true });
    mkdirSync(root.value, { recursive: true });
    return root.value;
  } catch (error) {
    throw new InternalError(`Failed to recreate example root "${name}"`, {
      cause: asError(error),
      context: { name, rootDir: root.value },
    });
  }
};

export const writeIsolatedExampleAppModule = (
  rootDir: string,
  sourceModulePath: string
): string => {
  if (!isAbsolute(sourceModulePath)) {
    throw new ValidationError(
      'Example app source module path must be absolute.',
      {
        context: { rootDir, sourceModulePath },
      }
    );
  }

  const modulePath = './src/app.ts';
  const target = deriveSafePath(rootDir, modulePath);
  if (target.isErr()) {
    throw target.error;
  }

  try {
    mkdirSync(dirname(target.value), { recursive: true });
    writeFileSync(
      target.value,
      `export { app } from ${JSON.stringify(pathToFileURL(sourceModulePath).href)};\n`
    );
    return modulePath;
  } catch (error) {
    throw new InternalError('Failed to write isolated example app module', {
      cause: asError(error),
      context: { rootDir, sourceModulePath, targetPath: target.value },
    });
  }
};

export const writeIsolatedExampleJsonFile = (
  rootDir: string,
  relativePath: string,
  value: unknown
): string => {
  const target = deriveSafePath(rootDir, relativePath);
  if (target.isErr()) {
    throw target.error;
  }

  try {
    mkdirSync(dirname(target.value), { recursive: true });
    writeFileSync(target.value, `${JSON.stringify(value, null, 2)}\n`);
    return relativePath;
  } catch (error) {
    throw new InternalError('Failed to write isolated example JSON file', {
      cause: asError(error),
      context: { relativePath, rootDir, targetPath: target.value },
    });
  }
};

export const removeRootRelativeFileIfPresent = (
  rootDir: string,
  relativePath: string
): TrailsResult<boolean, Error> => {
  const target = deriveSafePath(rootDir, relativePath);
  if (target.isErr()) {
    return target;
  }

  if (!existsSync(target.value)) {
    return Result.ok(false);
  }

  try {
    rmSync(target.value, { force: true });
    return Result.ok(true);
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to remove local state file "${relativePath}"`, {
        cause: asError(error),
        context: { relativePath, rootDir, targetPath: target.value },
      })
    );
  }
};
