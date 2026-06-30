/**
 * Shared Zod introspection helpers used by config resolution, doctor,
 * describe, explain, and collect modules.
 */

import type { z } from 'zod';

/** Extract the Zod def record from any ZodType. */
export const zodDef = (schema: z.ZodType): Record<string, unknown> =>
  schema.def as unknown as Record<string, unknown>;

/** Wrapper types that preserve object traversal shape. */
const TRAVERSAL_WRAPPER_TYPES = new Set(['optional', 'default', 'nullable']);

/** Wrapper types env overlay can inspect before coercing a string value. */
const ENV_WRAPPER_TYPES = new Set([
  ...TRAVERSAL_WRAPPER_TYPES,
  'catch',
  'nonoptional',
  'prefault',
  'readonly',
]);

/** Unwrap through selected wrappers to find the base schema. */
const unwrapWith = (
  schema: z.ZodType,
  wrapperTypes: ReadonlySet<string>
): z.ZodType => {
  let current = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = zodDef(current);
    if (!wrapperTypes.has(def['type'] as string)) {
      return current;
    }
    const inner = def['innerType'] as z.ZodType | undefined;
    if (!inner) {
      return current;
    }
    current = inner;
  }
  return current;
};

/** Unwrap through shape-preserving wrappers to find the base schema. */
export const unwrapToBase = (schema: z.ZodType): z.ZodType =>
  unwrapWith(schema, TRAVERSAL_WRAPPER_TYPES);

/** Unwrap through env-coercion wrappers to find the env target schema. */
const unwrapToEnvBase = (schema: z.ZodType): z.ZodType =>
  unwrapWith(schema, ENV_WRAPPER_TYPES);

/** Check if a schema is (or wraps) a ZodObject by inspecting its def. */
export const isZodObject = (
  schema: z.ZodType
): schema is z.ZodObject<Record<string, z.ZodType>> => {
  const def = zodDef(unwrapToBase(schema));
  return def['type'] === 'object' && 'shape' in def;
};

/** Container types an env string should not replace wholesale. */
const CONTAINER_TYPES = new Set([
  'object',
  'array',
  'tuple',
  'record',
  'map',
  'set',
]);

/** Check whether a schema is a container shape after unwrapping defaults. */
export const isZodContainer = (schema: z.ZodType): boolean => {
  const def = zodDef(unwrapToEnvBase(schema));
  return CONTAINER_TYPES.has(def['type'] as string);
};

/** Boolean string values we accept from environment variables. */
const BOOL_TRUE = new Set(['true', '1']);
const BOOL_FALSE = new Set(['false', '0']);

/** Primitive type names we can coerce env strings into. */
const PRIMITIVE_TYPES = new Set(['number', 'boolean', 'string']);

/** Resolve the primitive base type name after unwrapping defaults. */
const resolvePrimitiveBaseTypeName = (
  schema: z.ZodType
): string | undefined => {
  const def = zodDef(unwrapToEnvBase(schema));
  const typeName = def['type'] as string | undefined;
  return typeName && PRIMITIVE_TYPES.has(typeName) ? typeName : undefined;
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
  number: (raw: string) => {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  },
};

/** Coerce a string env value to the type expected by the schema field. */
export const coerceEnvValue = (raw: string, schema: z.ZodType): unknown => {
  const typeName = resolvePrimitiveBaseTypeName(schema);
  const coercer = typeName ? ENV_COERCERS[typeName] : undefined;
  return coercer ? coercer(raw) : raw;
};

/** Resolve a schema at a dot-separated path through nested object shapes. */
export const getSchemaAtPath = (
  schema: z.ZodType,
  path: string
): z.ZodType | undefined => {
  let current = schema;
  for (const part of path.split('.')) {
    const base = unwrapToBase(current);
    const shape = zodDef(base)['shape'] as
      | Record<string, z.ZodType>
      | undefined;
    const next = shape?.[part];
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return current;
};

/** Read a value at a dot-separated path from a plain object. */
export const getAtPath = (
  obj: Record<string, unknown>,
  path: string
): unknown => {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};
