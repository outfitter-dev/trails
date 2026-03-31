/**
 * Shared Zod introspection helpers used by config resolution, doctor,
 * describe, explain, and collect modules.
 */

import type { z } from 'zod';

/** Extract the Zod def record from any ZodType. */
export const zodDef = (schema: z.ZodType): Record<string, unknown> =>
  schema.def as unknown as Record<string, unknown>;

/** Check if a schema is a ZodObject by inspecting its def. */
export const isZodObject = (
  schema: z.ZodType
): schema is z.ZodObject<Record<string, z.ZodType>> => {
  const def = zodDef(schema);
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
