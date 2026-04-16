import { globalRegistry } from 'zod';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema introspection helpers
// ---------------------------------------------------------------------------

/** Unwrap `.default()`, `.optional()`, `.nullable()` to reach the inner type. */
export const unwrap = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const def = current.def as unknown as Record<string, unknown>;
    const inner = def['innerType'] as z.ZodType | undefined;
    if (!inner) {
      return current;
    }
    current = inner;
  }
};

/** Read the Zod type discriminant from a schema's def. */
export const zodTypeName = (schema: z.ZodType): string => {
  const def = schema.def as unknown as Record<string, unknown>;
  return (def['type'] as string) ?? 'unknown';
};

/** Walk the registry up through wrappers to find a metadata key. */
export const walkRegistryKey = (
  schema: z.ZodType,
  key: string
): unknown | undefined => {
  let current: z.ZodType | undefined = schema;
  while (current) {
    const meta = globalRegistry.get(current) as
      | Record<string, unknown>
      | undefined;
    if (meta?.[key] !== undefined) {
      return meta[key];
    }
    const def = current.def as unknown as Record<string, unknown>;
    current = def['innerType'] as z.ZodType | undefined;
  }
  return undefined;
};

/** Get the description from the global registry for a schema or its inner type. */
export const getDescription = (schema: z.ZodType): string | undefined =>
  walkRegistryKey(schema, 'description') as string | undefined;

/** Get the deprecation message from the config meta for a field. */
export const getDeprecation = (schema: z.ZodType): string | undefined =>
  walkRegistryKey(schema, 'deprecationMessage') as string | undefined;

/** Get the default value from a schema if it has one. */
export const getDefault = (
  schema: z.ZodType
): { has: false } | { has: true; value: unknown } => {
  const def = schema.def as unknown as Record<string, unknown>;
  if (def['type'] === 'default') {
    return { has: true, value: def['defaultValue'] };
  }
  return { has: false };
};

/** Check whether a schema (or its inner type) is a ZodObject. */
export const isObjectType = (schema: z.ZodType): boolean => {
  const inner = unwrap(schema);
  const def = inner.def as unknown as Record<string, unknown>;
  return def['type'] === 'object' && 'shape' in def;
};

/** Get the shape of a ZodObject, unwrapping wrappers first. */
export const getObjectShape = (
  schema: z.ZodType
): Record<string, z.ZodType> | undefined => {
  const inner = unwrap(schema);
  const def = inner.def as unknown as Record<string, unknown>;
  if (def['type'] !== 'object' || !('shape' in def)) {
    return undefined;
  }
  return (inner as z.ZodObject<Record<string, z.ZodType>>).shape as Record<
    string,
    z.ZodType
  >;
};

/** Resolve a dot-separated path to the field schema within an object. */
export const deriveFieldByPath = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  path: string
): z.ZodType | undefined => {
  const parts = path.split('.');
  let current: z.ZodType = schema;

  for (const part of parts) {
    const shape = getObjectShape(current);
    if (!shape?.[part]) {
      return undefined;
    }
    current = shape[part];
  }

  return current;
};

// ---------------------------------------------------------------------------
// Value formatting helpers
// ---------------------------------------------------------------------------

/** Format a value as a quoted string or literal. */
export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  return String(value);
};

/** Get the display value for a field (default or empty placeholder). */
export const fieldValue = (schema: z.ZodType): unknown => {
  const info = getDefault(schema);
  return info.has ? info.value : '';
};

/** Collect comment lines for a field (description + deprecation). */
export const fieldComments = (
  schema: z.ZodType,
  prefix: string
): readonly string[] => {
  const lines: string[] = [];
  const desc = getDescription(schema);
  if (desc) {
    lines.push(`${prefix} ${desc}`);
  }
  const dep = getDeprecation(schema);
  if (dep) {
    lines.push(`${prefix} DEPRECATED: ${dep}`);
  }
  return lines;
};

/** Append comment lines to an output array. */
export const pushComments = (
  lines: string[],
  comments: readonly string[],
  indent: string
): void => {
  for (const c of comments) {
    lines.push(`${indent}${c}`);
  }
};

/** Map a Zod type name to a JSON Schema type. */
export const zodTypeToJsonSchema: Record<string, string> = {
  boolean: 'boolean',
  number: 'number',
  string: 'string',
};
