/**
 * Validation utilities for @ontrails/core
 *
 * Wraps Zod parsing into Result types and provides JSON Schema conversion
 * for trail input schemas.
 */

import type { z } from 'zod';

import { ValidationError } from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// Zod → JSON Schema (Zod v4)
// ---------------------------------------------------------------------------

/** Internal accessor for Zod v4's internals. */
interface ZodInternals {
  readonly _zod: {
    readonly def: Readonly<Record<string, unknown>>;
    readonly traits: ReadonlySet<string>;
  };
  readonly description?: string;
}

type JsonSchema = Record<string, unknown>;
type JsonSchemaConverter = (schema: z.ZodType) => JsonSchema;

// ---------------------------------------------------------------------------
// Internal helpers (defined before usage)
// ---------------------------------------------------------------------------

const isOptionalLike = (s: ZodInternals): boolean => {
  const defType = s._zod.def['type'] as string;
  return defType === 'optional' || defType === 'default';
};

// ---------------------------------------------------------------------------
// Issue formatting
// ---------------------------------------------------------------------------

/** Format each ZodIssue as "path: message" (or just "message" for root). */
export const formatZodIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Parse unknown data against a Zod schema, returning a Result. */
export const validateInput = <T>(
  schema: z.ZodType<T>,
  data: unknown
): Result<T, ValidationError> => {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return Result.ok(parsed.data);
  }
  const messages = formatZodIssues(parsed.error.issues);
  return Result.err(
    new ValidationError(messages.join('; '), {
      cause: parsed.error,
      context: { issues: parsed.error.issues },
    })
  );
};

// ---------------------------------------------------------------------------
// Zod → JSON Schema (public API)
// ---------------------------------------------------------------------------

/**
 * Convert common Zod types to a JSON Schema object.
 *
 * Uses Zod v4's `_zod.def` and `_zod.traits` for introspection.
 * Covers: string, number, boolean, object, array, enum, optional,
 * default, union, literal, nullable, and describe.
 */
export const zodToJsonSchema: JsonSchemaConverter = (
  schema: z.ZodType
): JsonSchema => {
  const s = schema as unknown as ZodInternals;

  const collectObjectFields = (shape: Record<string, ZodInternals>) => {
    const properties: JsonSchema = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as unknown as z.ZodType);
      if (!isOptionalLike(value)) {
        required.push(key);
      }
    }
    return { properties, required };
  };

  const convertObject = (value: ZodInternals): JsonSchema => {
    const shape = value._zod.def['shape'] as
      | Record<string, ZodInternals>
      | undefined;
    if (!shape) {
      return { type: 'object' };
    }
    const { properties, required } = collectObjectFields(shape);
    const result: JsonSchema = { properties, type: 'object' };
    if (required.length > 0) {
      result['required'] = required;
    }
    return result;
  };

  const zodConverters: Record<string, (value: ZodInternals) => JsonSchema> = {
    array: (value) => {
      const element = value._zod.def['element'] as unknown as z.ZodType;
      return { items: zodToJsonSchema(element), type: 'array' };
    },
    boolean: () => ({ type: 'boolean' }),
    default: (value) => {
      const inner = value._zod.def['innerType'] as unknown as z.ZodType;
      const innerSchema = zodToJsonSchema(inner);
      const rawDefault = value._zod.def['defaultValue'];
      innerSchema['default'] =
        typeof rawDefault === 'function' ? rawDefault() : rawDefault;
      return innerSchema;
    },
    enum: (value) => {
      const entries = value._zod.def['entries'] as Record<string, string>;
      return { enum: Object.values(entries), type: 'string' };
    },
    literal: (value) => {
      const values = value._zod.def['values'] as unknown[];
      return { const: values[0] };
    },
    nullable: (value) => {
      const inner = value._zod.def['innerType'] as unknown as z.ZodType;
      return { anyOf: [zodToJsonSchema(inner), { type: 'null' }] };
    },
    number: () => ({ type: 'number' }),
    object: convertObject,
    optional: (value) => {
      const inner = value._zod.def['innerType'] as unknown as z.ZodType;
      return zodToJsonSchema(inner);
    },
    string: () => ({ type: 'string' }),
    union: (value) => {
      const options = value._zod.def['options'] as unknown as z.ZodType[];
      return { anyOf: options.map((option) => zodToJsonSchema(option)) };
    },
  };

  const converter = zodConverters[s._zod.def['type'] as string];
  const base = converter ? converter(s) : {};

  if (s.description) {
    base['description'] = s.description;
  }
  return base;
};
