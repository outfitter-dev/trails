/**
 * App config factory — declare a config contract once, discover and validate at runtime.
 */

import { dirname, join } from 'node:path';

import { NotFoundError, Result, ValidationError } from '@ontrails/core';
import type { z } from 'zod';

import type { CheckResult } from './doctor.js';
import { checkConfig } from './doctor.js';
import type { FieldDescription } from './describe.js';
import { describeConfig } from './describe.js';
import type { ExplainConfigOptions, ProvenanceEntry } from './explain.js';
import { explainConfig } from './explain.js';
import type { ConfigRef } from './ref.js';
import { configRef } from './ref.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported config file formats. */
export type ConfigFormat = 'toml' | 'json' | 'jsonc' | 'yaml';

/** Options for creating an app config. */
export interface AppConfigOptions<T extends z.ZodType> {
  readonly schema: T;
  readonly formats?: readonly ConfigFormat[];
  readonly dotfile?: boolean;
}

/** Options for resolving (discovering + parsing) a config file. */
export interface ResolveOptions {
  /** Working directory for discovery. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Explicit file path — skips discovery when provided. */
  readonly path?: string;
}

/** Options for the `explain()` method on AppConfig, excluding schema. */
export type AppConfigExplainOptions = Omit<
  ExplainConfigOptions<z.ZodType>,
  'schema'
>;

/** The resolved config contract returned by `appConfig()`. */
export interface AppConfig<T extends z.ZodType> {
  readonly name: string;
  readonly schema: T;
  readonly formats: readonly ConfigFormat[];
  readonly dotfile: boolean;
  resolve(options?: ResolveOptions): Promise<Result<z.infer<T>, Error>>;

  /** Describe all fields in the schema without needing values. */
  describe(): readonly FieldDescription[];

  /** Check a config object against the schema and return diagnostics. */
  check(
    values: Record<string, unknown>,
    options?: { readonly env?: Record<string, string | undefined> }
  ): CheckResult;

  /** Show which source won for each config field. */
  explain(options: AppConfigExplainOptions): readonly ProvenanceEntry[];

  /** Create a lazy reference to a config field for use as a trail input default. */
  ref(fieldPath: string): ConfigRef;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_FORMATS: readonly ConfigFormat[] = ['toml', 'json', 'yaml'];

// ---------------------------------------------------------------------------
// Internal helpers (defined before consumers — no-use-before-define)
// ---------------------------------------------------------------------------

/** Build the config filename for a given format. */
const configFileName = (
  name: string,
  format: ConfigFormat,
  dotfile: boolean
): string => (dotfile ? `.${name}rc.${format}` : `${name}.config.${format}`);

/** Check whether a file exists at the given path. */
const fileExists = (filePath: string): Promise<boolean> =>
  Bun.file(filePath).exists();

/** Read and parse a config file using Bun's native import. */
const readConfigFile = async (
  filePath: string
): Promise<Result<unknown, Error>> => {
  const exists = await fileExists(filePath);
  if (!exists) {
    return Result.err(
      new NotFoundError(`Config file not found: ${filePath}`, {
        context: { path: filePath },
      })
    );
  }

  try {
    // Bun natively imports TOML, JSON, JSONC, and YAML — result has `.default`
    const mod: Record<string, unknown> = await import(filePath);
    return Result.ok(mod['default'] ?? mod);
  } catch (error) {
    return Result.err(
      new ValidationError(`Failed to parse config file: ${filePath}`, {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { path: filePath },
      })
    );
  }
};

/** Validate parsed data against a Zod schema. */
const validateConfig = <T extends z.ZodType>(
  schema: T,
  data: unknown,
  filePath: string
): Result<z.infer<T>, Error> => {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return Result.ok(parsed.data as z.infer<T>);
  }
  return Result.err(
    new ValidationError(`Config validation failed: ${filePath}`, {
      context: {
        issues: parsed.error.issues,
        path: filePath,
      },
    })
  );
};

/** Check all format candidates in a single directory. */
const findInDir = async (
  dir: string,
  name: string,
  formats: readonly ConfigFormat[],
  dotfile: boolean
): Promise<string | undefined> => {
  for (const format of formats) {
    const candidate = join(dir, configFileName(name, format, dotfile));
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

/** Walk up from `startDir` looking for any matching config filename. */
const discoverConfigFile = async (
  name: string,
  formats: readonly ConfigFormat[],
  dotfile: boolean,
  startDir: string
): Promise<string | undefined> => {
  let dir = startDir;

  for (let depth = 0; depth < 64; depth += 1) {
    const found = await findInDir(dir, name, formats, dotfile);
    if (found !== undefined) {
      return found;
    }
    const parent = dirname(dir);
    // Reached filesystem root
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return undefined;
};

/** Resolve a config file — either from an explicit path or via discovery. */
const resolveConfig = async <T extends z.ZodType>(
  name: string,
  schema: T,
  formats: readonly ConfigFormat[],
  dotfile: boolean,
  options?: ResolveOptions
): Promise<Result<z.infer<T>, Error>> => {
  const filePath =
    options?.path ??
    (await discoverConfigFile(
      name,
      formats,
      dotfile,
      options?.cwd ?? process.cwd()
    ));

  if (filePath === undefined) {
    return Result.err(
      new NotFoundError(`No config file found for "${name}"`, {
        context: { dotfile, formats: [...formats], name },
      })
    );
  }

  const readResult = await readConfigFile(filePath);
  if (readResult.isErr()) {
    return readResult;
  }

  return validateConfig(schema, readResult.value, filePath);
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Declare a config contract for an app.
 *
 * The returned `AppConfig` exposes `resolve()` to discover, parse, and validate
 * a config file matching the app name and format conventions.
 *
 * @example
 * ```ts
 * const config = appConfig('myapp', {
 *   schema: z.object({
 *     output: z.string().default('./output'),
 *     verbose: z.boolean().default(false),
 *   }),
 * });
 *
 * const result = await config.resolve();
 * if (result.isOk()) console.log(result.value.output);
 * ```
 */
export const appConfig = <T extends z.ZodType>(
  name: string,
  options: AppConfigOptions<T>
): AppConfig<T> => {
  const formats = options.formats ?? DEFAULT_FORMATS;
  const dotfile = options.dotfile ?? false;

  const { schema } = options;

  return {
    check: (values, checkOpts) => checkConfig(schema, values, checkOpts),
    describe: () =>
      describeConfig(
        schema as unknown as z.ZodObject<Record<string, z.ZodType>>
      ),
    dotfile,
    explain: (explainOpts) => explainConfig({ ...explainOpts, schema }),
    formats,
    name,
    ref: (fieldPath) => configRef(fieldPath),
    resolve: (resolveOptions?: ResolveOptions) =>
      resolveConfig(name, schema, formats, dotfile, resolveOptions),
    schema,
  };
};
