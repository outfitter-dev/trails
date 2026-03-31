/**
 * Trails-specific config wrapper — `appConfig('trails', ...)` with
 * framework conventions for loadout selection and local overrides.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { z } from 'zod';

import { appConfig } from './app-config.js';
import { resolveConfig } from './resolve.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for defining a Trails app config. */
export interface DefineConfigOptions<T extends z.ZodType> {
  readonly schema: T;
  readonly base?: Partial<z.infer<T>>;
  readonly loadouts?: Record<string, Partial<z.infer<T>>>;
  /** When true, fall back to `NODE_ENV` when `TRAILS_ENV` is unset. */
  readonly envFromNodeEnv?: boolean;
}

/** Options passed to `resolve()` on a defined config. */
interface DefineConfigResolveOptions {
  readonly loadout?: string;
  readonly env?: Record<string, string | undefined>;
  /** Working directory for local overrides discovery. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Local overrides discovery
// ---------------------------------------------------------------------------

const LOCAL_OVERRIDE_CANDIDATES = ['local.ts', 'local.js'] as const;

/**
 * Discover and synchronously import a `.trails/config/local.{ts,js}` file.
 *
 * Skipped when `TRAILS_ENV=test` for hermetic test environments.
 */
const discoverLocalOverrides = async (
  cwd: string,
  envRecord: Record<string, string | undefined>
): Promise<Record<string, unknown> | undefined> => {
  if (envRecord['TRAILS_ENV'] === 'test') {
    return undefined;
  }

  for (const filename of LOCAL_OVERRIDE_CANDIDATES) {
    const candidate = join(cwd, '.trails', 'config', filename);
    if (existsSync(candidate)) {
      const mod: Record<string, unknown> = await import(candidate);
      return (mod['default'] ?? mod) as Record<string, unknown>;
    }
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Define Trails app config.
 *
 * This is `appConfig('trails', ...)` with the framework's own conventions:
 * `TRAILS_ENV` selects the loadout. When `envFromNodeEnv` is true,
 * `NODE_ENV` is used as a fallback when `TRAILS_ENV` is unset.
 *
 * @example
 * ```ts
 * const config = defineConfig({
 *   schema: z.object({
 *     port: z.number().default(3000),
 *     debug: z.boolean().default(false),
 *   }),
 *   base: { port: 8080 },
 *   loadouts: {
 *     production: { debug: false },
 *     test: { debug: true, port: 0 },
 *   },
 * });
 *
 * const result = config.resolve();
 * ```
 */
export const defineConfig = <T extends z.ZodType>(
  options: DefineConfigOptions<T>
) => {
  const config = appConfig('trails', {
    formats: ['toml', 'json'],
    schema: options.schema,
  });

  return {
    ...config,
    base: options.base,
    loadouts: options.loadouts,
    resolve: async (resolveOpts?: DefineConfigResolveOptions) => {
      const envRecord = {
        ...(resolveOpts?.env ?? process.env),
      } as Record<string, string | undefined>;

      if (
        options.envFromNodeEnv &&
        envRecord['TRAILS_ENV'] === undefined &&
        envRecord['NODE_ENV'] !== undefined
      ) {
        envRecord['TRAILS_ENV'] = envRecord['NODE_ENV'];
      }

      const cwd = resolveOpts?.cwd ?? process.cwd();
      const localOverrides = await discoverLocalOverrides(cwd, envRecord);

      return resolveConfig({
        base: options.base as Record<string, unknown> | undefined,
        env: envRecord,
        loadout: resolveOpts?.loadout ?? envRecord['TRAILS_ENV'],
        loadouts: options.loadouts as
          | Record<string, Record<string, unknown>>
          | undefined,
        localOverrides,
        schema: options.schema,
      });
    },
    schema: options.schema,
  };
};
