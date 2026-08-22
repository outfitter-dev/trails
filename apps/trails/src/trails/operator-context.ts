import { Result } from '@ontrails/core';

import { tryLoadFreshAppLease } from './load-app.js';
import type { FreshAppLease } from './load-app.js';
import { assertConfiguredAppBinding } from './project-context.js';
import type {
  OperatorAppProjectContext,
  OperatorProjectContext,
} from './project-context.js';
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

const selectedAppContexts = (
  context: OperatorProjectContext
): readonly OperatorAppProjectContext[] =>
  context.selectedExtent === 'workspace'
    ? context.apps.map((app) => ({
        app,
        boundaryDir: context.boundaryDir,
        identity: context.identity,
        projectRoot: context.projectRoot,
        selectedExtent: 'configured-app',
        selectionProvenance: context.selectionProvenance,
      }))
    : [context];

/** Load every selected app and prove its live topo name matches Config. */
export const assertFreshProjectAppBindings = async (
  context: OperatorProjectContext
): Promise<Result<void, Error>> => {
  if (context.identity.workspace === undefined) {
    return Result.ok();
  }
  for (const selected of selectedAppContexts(context)) {
    const binding = await withFreshAppLease(
      selected.app.modulePath,
      selected.app.rootDir,
      (lease) => assertConfiguredAppBinding(selected, lease.app.name)
    );
    if (binding.isErr()) {
      return binding;
    }
  }
  return Result.ok();
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
