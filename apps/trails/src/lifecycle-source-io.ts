import { readFileSync, writeFileSync } from 'node:fs';

import { InternalError, Result } from '@ontrails/core';

export const readLifecycleSourceFile = (
  filePath: string
): Result<string, Error> => {
  try {
    return Result.ok(readFileSync(filePath, 'utf8'));
  } catch (error: unknown) {
    return Result.err(
      error instanceof Error
        ? error
        : new InternalError(`Unable to read lifecycle source file ${filePath}`)
    );
  }
};

export const writeLifecycleSourceFile = (
  filePath: string,
  source: string
): Result<void, Error> => {
  try {
    writeFileSync(filePath, source);
    return Result.ok();
  } catch (error: unknown) {
    return Result.err(
      error instanceof Error
        ? error
        : new InternalError(`Unable to write lifecycle source file ${filePath}`)
    );
  }
};
