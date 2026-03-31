/**
 * Config resolution engine — merges config from multiple sources through
 * a deterministic stack: defaults → base → loadout → local → env.
 */

import type { z } from 'zod';

import { Result } from '@ontrails/core';

import { collectConfigMeta } from './collect.js';
import { deepMerge } from './merge.js';
import { zodDef } from './zod-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for resolving config through the full stack. */
export interface ResolveConfigOptions<T extends z.ZodType> {
  readonly schema: T;
  readonly base?: Record<string, unknown> | undefined;
  readonly loadouts?: Record<string, Record<string, unknown>> | undefined;
  readonly loadout?: string | undefined;
  readonly localOverrides?: Record<string, unknown> | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
}

// ---------------------------------------------------------------------------
// Env coercion helpers (defined before consumers)
// ---------------------------------------------------------------------------

/** Boolean string values we accept from environment variables. */
const BOOL_TRUE = new Set(['true', '1']);
const BOOL_FALSE = new Set(['false', '0']);

/** Primitive type names we can coerce env strings into. */
const PRIMITIVE_TYPES = new Set(['number', 'boolean', 'string']);

/** Try to advance one level through a Zod wrapper, returning the inner type or undefined. */
const unwrapOne = (
  schema: z.ZodType
): { typeName: string | undefined; inner: z.ZodType | undefined } => {
  const def = zodDef(schema);
  return {
    inner: def['innerType'] as z.ZodType | undefined,
    typeName: def['type'] as string | undefined,
  };
};

/** Unwrap ZodDefault / ZodOptional / ZodNullable to find the base type name. */
const resolveBaseTypeName = (schema: z.ZodType): string => {
  let current: z.ZodType = schema;

  for (let depth = 0; depth < 10; depth += 1) {
    const { typeName, inner } = unwrapOne(current);
    if (typeName && PRIMITIVE_TYPES.has(typeName)) {
      return typeName;
    }
    if (!inner) {
      break;
    }
    current = inner;
  }

  return 'string';
};

/** Coerce a boolean env string. Returns the original string if unrecognized. */
const coerceBooleanEnv = (raw: string): unknown => {
  if (BOOL_TRUE.has(raw)) {
    return true;
  }
  if (BOOL_FALSE.has(raw)) {
    return false;
  }
  return raw;
};

/** Coerce env var lookup table keyed by base type name. */
const ENV_COERCERS: Record<string, (raw: string) => unknown> = {
  boolean: coerceBooleanEnv,
  number: Number,
};

/** Coerce a string env value to the type expected by the schema field. */
const coerceEnvValue = (raw: string, schema: z.ZodType): unknown => {
  const coercer = ENV_COERCERS[resolveBaseTypeName(schema)];
  return coercer ? coercer(raw) : raw;
};

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

/** Resolve one step of a Zod shape walk: find the field schema for a key. */
const resolveShapeStep = (
  current: z.ZodType,
  key: string
): z.ZodType | undefined => {
  const shape = zodDef(current)['shape'] as
    | Record<string, z.ZodType>
    | undefined;
  return shape?.[key];
};

/** Walk a Zod schema shape to find the field at a dot-separated path. */
const getFieldSchema = (
  schema: z.ZodType,
  path: string
): z.ZodType | undefined => {
  let current: z.ZodType = schema;
  for (const part of path.split('.')) {
    const next = resolveShapeStep(current, part);
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return current;
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
  const fieldSchema = getFieldSchema(schema, path);
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

/** Apply the layered merge: base → loadout → local overrides. */
const mergeLayers = (
  base: Record<string, unknown> | undefined,
  loadouts: Record<string, Record<string, unknown>> | undefined,
  loadout: string | undefined,
  localOverrides: Record<string, unknown> | undefined
): Record<string, unknown> => {
  let merged: Record<string, unknown> = {};
  if (base) {
    merged = deepMerge(merged, base);
  }

  const selected = loadout && loadouts ? loadouts[loadout] : undefined;
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
 * Resolve config through the full stack: defaults → base → loadout → local → env.
 * Returns `Result.ok` with the validated config, or `Result.err` on validation failure.
 */
export const resolveConfig = <T extends z.ZodType>(
  options: ResolveConfigOptions<T>
): Result<z.infer<T>, Error> => {
  let merged = mergeLayers(
    options.base,
    options.loadouts,
    options.loadout,
    options.localOverrides
  );

  if (options.env) {
    merged = applyEnvOverrides(merged, options.schema, options.env);
  }

  const parsed = options.schema.safeParse(merged);
  if (parsed.success) {
    return Result.ok(parsed.data as z.infer<T>);
  }

  return Result.err(new Error(formatValidationError(parsed.error.issues)));
};
