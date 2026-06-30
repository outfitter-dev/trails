import { loadTrailsConfigValue } from '@ontrails/config';
import {
  InternalError,
  Result,
  ValidationError,
  pathScopeSchema,
} from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import { z } from 'zod';

export const regradeConfigSchema = z
  .object({
    scope: pathScopeSchema.optional(),
  })
  .default({});

export type RegradeConfig = z.output<typeof regradeConfigSchema>;

interface RegradeConfigLoadResult {
  readonly config?: RegradeConfig;
  readonly configPath?: string;
}

interface ResolvableConfig {
  readonly resolve: (options?: {
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
  }) => unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isResultLike = (
  value: unknown
): value is {
  readonly error?: unknown;
  readonly isErr: () => boolean;
  readonly isOk: () => boolean;
  readonly value?: unknown;
} =>
  isRecord(value) &&
  typeof value['isOk'] === 'function' &&
  typeof value['isErr'] === 'function';

const isResolvableConfig = (value: unknown): value is ResolvableConfig =>
  isRecord(value) && typeof value['resolve'] === 'function';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const extractRegradeConfig = (
  value: unknown
): TrailsResult<RegradeConfig | undefined, ValidationError> => {
  if (!(isRecord(value) && 'regrade' in value)) {
    return Result.ok();
  }

  const parsed = regradeConfigSchema.safeParse(value['regrade']);
  if (parsed.success) {
    return Result.ok(parsed.data);
  }

  return Result.err(
    new ValidationError('Invalid regrade config in Trails config file.', {
      context: { issues: parsed.error.issues },
    })
  );
};

export const loadRegradeConfig = async ({
  configPath,
  env = {},
  rootDir,
}: {
  readonly configPath?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly rootDir: string;
}): Promise<
  TrailsResult<RegradeConfigLoadResult, InternalError | ValidationError>
> => {
  try {
    const loaded = await loadTrailsConfigValue({
      configPath,
      rootDir,
    });
    const exported = loaded.value;
    if (exported === undefined) {
      return Result.ok({});
    }

    if (isResolvableConfig(exported)) {
      const resolved = await exported.resolve({ cwd: rootDir, env });
      if (isResultLike(resolved)) {
        if (resolved.isErr()) {
          return Result.err(
            new InternalError(
              `Failed to resolve regrade config: ${errorMessage(resolved.error)}`
            )
          );
        }
        const configResult = extractRegradeConfig(resolved.value);
        if (configResult.isErr()) {
          return configResult;
        }
        return Result.ok({
          ...(configResult.value === undefined
            ? {}
            : { config: configResult.value }),
          ...(loaded.configPath === undefined
            ? {}
            : { configPath: loaded.configPath }),
        });
      }

      const configResult = extractRegradeConfig(resolved);
      if (configResult.isErr()) {
        return configResult;
      }
      return Result.ok({
        ...(configResult.value === undefined
          ? {}
          : { config: configResult.value }),
        ...(loaded.configPath === undefined
          ? {}
          : { configPath: loaded.configPath }),
      });
    }

    const configResult = extractRegradeConfig(exported);
    if (configResult.isErr()) {
      return configResult;
    }
    return Result.ok({
      ...(configResult.value === undefined
        ? {}
        : { config: configResult.value }),
      ...(loaded.configPath === undefined
        ? {}
        : { configPath: loaded.configPath }),
    });
  } catch (error) {
    return Result.err(
      new InternalError(
        `Failed to load regrade config: ${errorMessage(error)}`,
        {
          cause: error instanceof Error ? error : new Error(String(error)),
        }
      )
    );
  }
};
