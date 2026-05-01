import { Result, ValidationError } from '@ontrails/core';

const ROOT_DIR_MESSAGE =
  'Trail execution requires rootDir input or ctx.cwd from the runtime context.';

export const resolveTrailRootDir = (
  rootDir: string | undefined,
  cwd: string | undefined
): Result<string, ValidationError> => {
  const resolved = rootDir ?? cwd;
  return resolved === undefined
    ? Result.err(new ValidationError(ROOT_DIR_MESSAGE))
    : Result.ok(resolved);
};

export const requireTrailRootDir = (rootDir: string | undefined): string => {
  if (rootDir === undefined) {
    throw new ValidationError(ROOT_DIR_MESSAGE);
  }
  return rootDir;
};
