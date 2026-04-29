import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

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

export type PlannedProjectOperation =
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  | { readonly kind: 'write'; readonly path: string };

export type ProjectWriteOperation =
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  | {
      readonly content: string | Uint8Array;
      readonly kind: 'write';
      readonly path: string;
    };

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

export const projectPathExists = (
  projectDir: string,
  pathWithinProject: string
): TrailsResult<boolean, Error> => {
  const target = resolveProjectPath(projectDir, pathWithinProject);
  if (target.isErr()) {
    return target;
  }

  return Result.ok(existsSync(target.value));
};

/** Write a generated project-relative file and return the relative path. */
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

/** Write an already-derived path that must stay contained under the project. */
export const writeContainedProjectPath = async (
  projectDir: string,
  pathWithinProject: string,
  content: string | Uint8Array
): Promise<TrailsResult<string, Error>> => {
  const target = resolveProjectPath(projectDir, pathWithinProject);
  if (target.isErr()) {
    return target;
  }

  try {
    mkdirSync(dirname(target.value), { recursive: true });
    await Bun.write(target.value, content);
    return Result.ok(target.value);
  } catch (error) {
    return Result.err(
      new InternalError(
        `Failed to write contained project path "${pathWithinProject}"`,
        {
          cause: asError(error),
          context: { pathWithinProject, projectDir },
        }
      )
    );
  }
};

export const renameContainedProjectPath = (
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
      new InternalError(
        `Failed to rename contained project path "${fromPath}"`,
        {
          cause: asError(error),
          context: { fromPath, projectDir, toPath },
        }
      )
    );
  }
};

const toProjectRelativePath = (
  projectDir: string,
  pathWithinProject: string
): TrailsResult<string, Error> => {
  const target = resolveProjectPath(projectDir, pathWithinProject);
  if (target.isErr()) {
    return target;
  }

  return Result.ok(
    relative(resolve(projectDir), target.value).replaceAll('\\', '/')
  );
};

export const planProjectOperation = (
  projectDir: string,
  operation: ProjectWriteOperation
): TrailsResult<PlannedProjectOperation, Error> => {
  switch (operation.kind) {
    case 'mkdir': {
      const path = toProjectRelativePath(projectDir, operation.path);
      return path.isErr()
        ? path
        : Result.ok({ kind: 'mkdir', path: path.value });
    }
    case 'rename': {
      const from = toProjectRelativePath(projectDir, operation.from);
      if (from.isErr()) {
        return from;
      }
      const to = toProjectRelativePath(projectDir, operation.to);
      return to.isErr()
        ? to
        : Result.ok({ from: from.value, kind: 'rename', to: to.value });
    }
    case 'write': {
      const path = toProjectRelativePath(projectDir, operation.path);
      return path.isErr()
        ? path
        : Result.ok({ kind: 'write', path: path.value });
    }
    default: {
      return Result.err(
        new InternalError('Unknown project operation kind', {
          context: { operation },
        })
      );
    }
  }
};

export const planProjectOperations = (
  projectDir: string,
  operations: readonly ProjectWriteOperation[]
): TrailsResult<PlannedProjectOperation[], Error> => {
  const planned: PlannedProjectOperation[] = [];
  for (const operation of operations) {
    const result = planProjectOperation(projectDir, operation);
    if (result.isErr()) {
      return Result.err(result.error);
    }
    planned.push(result.value);
  }
  return Result.ok(planned);
};

const applyProjectOperation = async (
  projectDir: string,
  operation: ProjectWriteOperation
): Promise<TrailsResult<void, Error>> => {
  switch (operation.kind) {
    case 'mkdir': {
      const target = resolveProjectPath(projectDir, operation.path);
      if (target.isErr()) {
        return Result.err(target.error);
      }
      try {
        mkdirSync(target.value, { recursive: true });
        return Result.ok();
      } catch (error) {
        return Result.err(
          new InternalError(
            `Failed to create project directory "${operation.path}"`,
            {
              cause: asError(error),
              context: { projectDir, relativePath: operation.path },
            }
          )
        );
      }
    }
    case 'rename': {
      return renameContainedProjectPath(
        projectDir,
        operation.from,
        operation.to
      );
    }
    case 'write': {
      const target = resolveProjectPath(projectDir, operation.path);
      if (target.isErr()) {
        return Result.err(target.error);
      }
      try {
        mkdirSync(dirname(target.value), { recursive: true });
        await Bun.write(target.value, operation.content);
        return Result.ok();
      } catch (error) {
        return Result.err(
          new InternalError(
            `Failed to write project file "${operation.path}"`,
            {
              cause: asError(error),
              context: { projectDir, relativePath: operation.path },
            }
          )
        );
      }
    }
    default: {
      return Result.err(
        new InternalError('Unknown project operation kind', {
          context: { operation },
        })
      );
    }
  }
};

export const applyProjectOperations = async (
  projectDir: string,
  operations: readonly ProjectWriteOperation[]
): Promise<TrailsResult<PlannedProjectOperation[], Error>> => {
  const planned = planProjectOperations(projectDir, operations);
  if (planned.isErr()) {
    return Result.err(planned.error);
  }

  for (const operation of operations) {
    const applied = await applyProjectOperation(projectDir, operation);
    if (applied.isErr()) {
      return Result.err(applied.error);
    }
  }

  return planned;
};
