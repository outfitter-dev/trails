/**
 * Config resolution engine — merges config from multiple sources through
 * a deterministic stack: defaults → base → profile → local → env.
 */

import type { z } from 'zod';

import { Result, ValidationError } from '@ontrails/core';

import { collectConfigMeta } from './collect.js';
import { deepMerge } from './merge.js';
import {
  coerceEnvValue,
  getSchemaAtPath,
  isZodContainer,
  zodDef,
} from './zod-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for resolving config through the full stack. */
export interface DeriveConfigOptions<T extends z.ZodType> {
  readonly schema: T;
  readonly base?: Record<string, unknown> | undefined;
  readonly profiles?: Record<string, Record<string, unknown>> | undefined;
  readonly profile?: string | undefined;
  readonly localOverrides?: Record<string, unknown> | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

/** Navigate one step of a nested object, creating an intermediate if needed. */
const navigateOrCreate = (
  current: Record<string, unknown>,
  key: string
): Record<string, unknown> => {
  const next = current[key];
  if (typeof next === 'object' && next !== null && !Array.isArray(next)) {
    return next as Record<string, unknown>;
  }
  const nested: Record<string, unknown> = {};
  current[key] = nested;
  return nested;
};

/** Ensure a nested path exists in an object, creating intermediates as needed. */
const ensurePath = (
  obj: Record<string, unknown>,
  parts: readonly string[]
): Record<string, unknown> => {
  let current = obj;
  for (const part of parts) {
    current = navigateOrCreate(current, part);
  }
  return current;
};

/** Set a value at a dot-separated path in a plain object. */
const setAtPath = (
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void => {
  const parts = path.split('.');
  const parent = ensurePath(obj, parts.slice(0, -1));
  parent[parts.at(-1) as string] = value;
};

// ---------------------------------------------------------------------------
// Env overlay
// ---------------------------------------------------------------------------

/** Coerce and set a single env override into the result object. */
const applyOneEnvOverride = (
  result: Record<string, unknown>,
  schema: z.ZodType,
  path: string,
  envValue: string
): void => {
  const fieldSchema = getSchemaAtPath(schema, path);
  if (fieldSchema && isZodContainer(fieldSchema)) {
    return;
  }
  const coerced = fieldSchema
    ? coerceEnvValue(envValue, fieldSchema)
    : envValue;
  setAtPath(result, path, coerced);
};

/** Resolve a single env binding: look up the var, apply if present. */
const resolveEnvBinding = (
  result: Record<string, unknown>,
  schema: z.ZodType,
  path: string,
  envVar: string,
  envVars: Record<string, string | undefined>
): void => {
  const envValue = envVars[envVar];
  if (envValue !== undefined) {
    applyOneEnvOverride(result, schema, path, envValue);
  }
};

/** Apply env var overrides based on schema metadata. */
const applyEnvOverrides = (
  merged: Record<string, unknown>,
  schema: z.ZodType,
  envVars: Record<string, string | undefined>
): Record<string, unknown> => {
  if (zodDef(schema)['type'] !== 'object') {
    return merged;
  }

  const meta = collectConfigMeta(
    schema as z.ZodObject<Record<string, z.ZodType>>
  );
  const result = deepMerge({}, merged);

  for (const [path, fieldMeta] of meta) {
    if (fieldMeta.env) {
      resolveEnvBinding(result, schema, path, fieldMeta.env, envVars);
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Merge pipeline
// ---------------------------------------------------------------------------

/** Apply the layered merge: base → profile → local overrides. */
const mergeLayers = (
  base: Record<string, unknown> | undefined,
  profiles: Record<string, Record<string, unknown>> | undefined,
  profile: string | undefined,
  localOverrides: Record<string, unknown> | undefined
): Record<string, unknown> => {
  let merged: Record<string, unknown> = {};
  if (base) {
    merged = deepMerge(merged, base);
  }

  const selected = profile && profiles ? profiles[profile] : undefined;
  if (selected) {
    merged = deepMerge(merged, selected);
  }

  if (localOverrides) {
    merged = deepMerge(merged, localOverrides);
  }
  return merged;
};

/** Format Zod issues into a human-readable error message. */
const formatValidationError = (
  issues: readonly { path: PropertyKey[]; message: string }[]
): string =>
  `Config validation failed: ${issues.map((i) => `${String(i.path.join('.'))}: ${i.message}`).join(', ')}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive config through the full stack: defaults → base → profile → local → env.
 * Returns `Result.ok` with the validated config, or `Result.err` on validation failure.
 */
export const deriveConfig = <T extends z.ZodType>(
  options: DeriveConfigOptions<T>
): Result<z.infer<T>, Error> => {
  let merged = mergeLayers(
    options.base,
    options.profiles,
    options.profile,
    options.localOverrides
  );

  if (options.env) {
    merged = applyEnvOverrides(merged, options.schema, options.env);
  }

  const parsed = options.schema.safeParse(merged);
  if (parsed.success) {
    return Result.ok(parsed.data as z.infer<T>);
  }

  return Result.err(
    new ValidationError(formatValidationError(parsed.error.issues))
  );
};
