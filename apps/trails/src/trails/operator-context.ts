import type { Result } from '@ontrails/core';

import { tryLoadFreshAppLease } from './load-app.js';
import type { FreshAppLease } from './load-app.js';
import { resolveTrailRootDir } from './root-dir.js';

interface RootDirInput {
  readonly rootDir?: string | undefined;
}

interface FreshAppInput extends RootDirInput {
  readonly module?: string | undefined;
}

interface RootDirContext {
  readonly cwd?: string | undefined;
}

interface FreshAppContext {
  readonly lease: FreshAppLease;
  readonly rootDir: string;
}

export const withOperatorRootDir = async <T>(
  input: RootDirInput,
  ctx: RootDirContext,
  consume: (rootDir: string) => Result<T, Error> | Promise<Result<T, Error>>
): Promise<Result<T, Error>> => {
  const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
  if (rootDirResult.isErr()) {
    return rootDirResult;
  }
  return await consume(rootDirResult.value);
};

export const withFreshAppLease = async <T>(
  modulePath: string | undefined,
  rootDir: string,
  consume: (
    lease: FreshAppLease
  ) => Result<T, Error> | Promise<Result<T, Error>>
): Promise<Result<T, Error>> => {
  const leaseResult = await tryLoadFreshAppLease(modulePath, rootDir);
  if (leaseResult.isErr()) {
    return leaseResult;
  }
  const lease = leaseResult.value;
  try {
    return await consume(lease);
  } finally {
    lease.release();
  }
};

export const withFreshOperatorApp = async <T>(
  input: FreshAppInput,
  ctx: RootDirContext,
  consume: (
    context: FreshAppContext
  ) => Result<T, Error> | Promise<Result<T, Error>>
): Promise<Result<T, Error>> =>
  withOperatorRootDir(input, ctx, (rootDir) =>
    withFreshAppLease(input.module, rootDir, (lease) =>
      consume({ lease, rootDir })
    )
  );
