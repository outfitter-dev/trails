import { Result, ValidationError } from '@ontrails/core';

export const resolveCiRootDir = (
  rootDir: string | undefined,
  cwd: string | undefined
): Result<string, ValidationError> => {
  const resolved = rootDir ?? cwd;
  return resolved === undefined
    ? Result.err(
        new ValidationError(
          'CI trail execution requires rootDir input or ctx.cwd from the runtime context.'
        )
      )
    : Result.ok(resolved);
};
