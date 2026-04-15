/**
 * JSON Schema generation from Zod object schemas.
 *
 * Produces JSON Schema Draft 2020-12 with descriptions, defaults,
 * deprecated annotations, and constraints.
 */
import type { z } from 'zod';

import {
  getDefault,
  getDeprecation,
  getDescription,
  getObjectShape,
  isObjectType,
  unwrap,
  zodTypeName,
  zodTypeToJsonSchema,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the JSON Schema type or enum from a Zod schema. */
const jsonSchemaType = (inner: z.ZodType): Record<string, unknown> => {
  const typeName = zodTypeName(inner);
  if (typeName === 'enum') {
    const def = inner.def as unknown as Record<string, unknown>;
    const entries = def['entries'] as Record<string, string> | undefined;
    return entries ? { enum: Object.keys(entries) } : {};
  }
  const mapped = zodTypeToJsonSchema[typeName];
  return mapped ? { type: mapped } : {};
};

/** Annotation extractors for JSON Schema properties. */
const annotationExtractors: readonly ((
  s: z.ZodType
) => Record<string, unknown>)[] = [
  (s) => {
    const desc = getDescription(s);
    return desc ? { description: desc } : {};
  },
  (s) => {
    const info = getDefault(s);
    return info.has ? { default: info.value } : {};
  },
  (s) => {
    const dep = getDeprecation(s);
    return dep ? { deprecated: true } : {};
  },
];

/** Extract annotations (description, default, deprecated) for JSON Schema. */
const jsonSchemaAnnotations = (
  fieldSchema: z.ZodType
): Record<string, unknown> =>
  Object.assign({}, ...annotationExtractors.map((fn) => fn(fieldSchema)));

/** Check if a field is required (no default and not optional). */
const isRequired = (fieldSchema: z.ZodType): boolean => {
  const def = fieldSchema.def as unknown as Record<string, unknown>;
  return def['type'] !== 'default' && def['type'] !== 'optional';
};

/** Convert a single Zod field schema to a JSON Schema property. */
const fieldToJsonSchema = (fieldSchema: z.ZodType): Record<string, unknown> => {
  if (isObjectType(fieldSchema)) {
    const nestedShape = getObjectShape(fieldSchema);
    if (nestedShape) {
      // oxlint-disable-next-line no-use-before-define -- mutual recursion with buildSchemaProperties
      const { properties, required } = buildSchemaProperties(nestedShape);
      return {
        properties,
        type: 'object',
        ...(required.length > 0 ? { required } : {}),
        ...jsonSchemaAnnotations(fieldSchema),
      };
    }
  }
  return {
    ...jsonSchemaType(unwrap(fieldSchema)),
    ...jsonSchemaAnnotations(fieldSchema),
  };
};

/** Build properties and required arrays from a schema shape. */
const buildSchemaProperties = (
  shape: Record<string, z.ZodType>
): {
  properties: Record<string, Record<string, unknown>>;
  required: readonly string[];
} => {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    properties[key] = fieldToJsonSchema(fieldSchema);
    if (isRequired(fieldSchema)) {
      required.push(key);
    }
  }
  return { properties, required };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a JSON Schema from a Zod object schema.
 *
 * Includes descriptions, defaults, deprecated annotations, and constraints.
 * Produces JSON Schema Draft 2020-12.
 */
export const deriveConfigJsonSchema = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  options?: { readonly description?: string; readonly title?: string }
): Record<string, unknown> => {
  const { properties, required } = buildSchemaProperties(
    schema.shape as Record<string, z.ZodType>
  );
  const result: Record<string, unknown> = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    properties,
    type: 'object',
  };
  if (options?.title) {
    result['title'] = options.title;
  }
  if (options?.description) {
    result['description'] = options.description;
  }
  if (required.length > 0) {
    result['required'] = required;
  }
  return result;
};
