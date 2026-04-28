import { mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  DRAFT_ID_PREFIX,
  deriveSafePath,
  InternalError,
  Result,
  ValidationError,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';

export const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
export const PROJECT_NAME_MESSAGE =
  'Project name must start with a lowercase letter or digit and contain only lowercase letters, digits, ".", "_", or "-".';

export const TRAIL_ID_PATTERN =
  /^(?:_draft\.)?[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/u;
export const TRAIL_ID_MESSAGE =
  'Trail ID must be lowercase dotted segments, optionally prefixed with "_draft.", with each non-draft segment starting with a letter and containing only letters or digits.';

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const validateProjectName = (
  name: string
): TrailsResult<string, ValidationError> =>
  PROJECT_NAME_PATTERN.test(name)
    ? Result.ok(name)
    : Result.err(new ValidationError(PROJECT_NAME_MESSAGE));

export const validateTrailId = (
  trailId: string
): TrailsResult<string, ValidationError> =>
  TRAIL_ID_PATTERN.test(trailId)
    ? Result.ok(trailId)
    : Result.err(new ValidationError(TRAIL_ID_MESSAGE));

export const trailIdToModuleName = (trailId: string): string =>
  trailId.startsWith(DRAFT_ID_PREFIX)
    ? `${DRAFT_ID_PREFIX}${trailId.slice(DRAFT_ID_PREFIX.length).replaceAll('.', '-')}`
    : trailId.replaceAll('.', '-');

export const trailIdToExportName = (trailId: string): string =>
  trailId.replaceAll('.', '_');

export const resolveProjectDir = (
  parentDir: string,
  projectName: string
): TrailsResult<string, Error> => {
  const validated = validateProjectName(projectName);
  if (validated.isErr()) {
    return validated;
  }

  return deriveSafePath(resolve(parentDir), validated.value);
};

export const resolveProjectPath = (
  projectDir: string,
  relativePath: string
): TrailsResult<string, Error> => deriveSafePath(projectDir, relativePath);

export const ensureProjectDirectory = (
  projectDir: string,
  relativePath: string
): TrailsResult<string, Error> => {
  const target = resolveProjectPath(projectDir, relativePath);
  if (target.isErr()) {
    return target;
  }

  try {
    mkdirSync(target.value, { recursive: true });
    return Result.ok(target.value);
  } catch (error) {
    return Result.err(
      new InternalError(
        `Failed to create project directory "${relativePath}"`,
        {
          cause: asError(error),
          context: { projectDir, relativePath },
        }
      )
    );
  }
};

export const writeProjectFile = async (
  projectDir: string,
  relativePath: string,
  content: string | Uint8Array
): Promise<TrailsResult<string, Error>> => {
  const target = resolveProjectPath(projectDir, relativePath);
  if (target.isErr()) {
    return target;
  }

  try {
    mkdirSync(dirname(target.value), { recursive: true });
    await Bun.write(target.value, content);
    return Result.ok(relativePath);
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to write project file "${relativePath}"`, {
        cause: asError(error),
        context: { projectDir, relativePath },
      })
    );
  }
};

export const writeProjectPath = async (
  projectDir: string,
  filePath: string,
  content: string | Uint8Array
): Promise<TrailsResult<string, Error>> => {
  const target = resolveProjectPath(projectDir, filePath);
  if (target.isErr()) {
    return target;
  }

  try {
    mkdirSync(dirname(target.value), { recursive: true });
    await Bun.write(target.value, content);
    return Result.ok(target.value);
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to write project path "${filePath}"`, {
        cause: asError(error),
        context: { filePath, projectDir },
      })
    );
  }
};

export const renameProjectPath = (
  projectDir: string,
  fromPath: string,
  toPath: string
): TrailsResult<void, Error> => {
  const from = resolveProjectPath(projectDir, fromPath);
  if (from.isErr()) {
    return Result.err(from.error);
  }

  const to = resolveProjectPath(projectDir, toPath);
  if (to.isErr()) {
    return Result.err(to.error);
  }

  try {
    renameSync(from.value, to.value);
    return Result.ok();
  } catch (error) {
    return Result.err(
      new InternalError(`Failed to rename project path "${fromPath}"`, {
        cause: asError(error),
        context: { fromPath, projectDir, toPath },
      })
    );
  }
};
