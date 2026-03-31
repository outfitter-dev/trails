/**
 * Shared Zod introspection helpers used by config resolution, doctor,
 * describe, explain, and collect modules.
 */

import type { z } from 'zod';

/** Extract the Zod def record from any ZodType. */
export const zodDef = (schema: z.ZodType): Record<string, unknown> =>
  schema.def as unknown as Record<string, unknown>;

/** Wrapper types that should be peeled before checking the base type. */
const WRAPPER_TYPES = new Set(['optional', 'default', 'nullable']);

/** Unwrap through optional/default/nullable wrappers to find the base schema. */
export const unwrapToBase = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = zodDef(current);
    if (!WRAPPER_TYPES.has(def['type'] as string)) {
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

/** Check if a schema is (or wraps) a ZodObject by inspecting its def. */
export const isZodObject = (
  schema: z.ZodType
): schema is z.ZodObject<Record<string, z.ZodType>> => {
  const def = zodDef(unwrapToBase(schema));
  return def['type'] === 'object' && 'shape' in def;
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
