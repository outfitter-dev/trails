/**
 * Validation utilities for @ontrails/core
 *
 * Wraps Zod parsing into Result types and provides JSON Schema conversion
 * for trail input schemas.
 */

import type { z } from 'zod';

import { BLOB_REF_SCHEMA_META_KEY, blobRefJsonSchema } from './blob-ref.js';
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
  let current = s;
  const seen = new Set<ZodInternals>();
  while (
    current._zod.def['type'] === 'readonly' &&
    !seen.has(current) &&
    current._zod.def['innerType'] !== undefined
  ) {
    seen.add(current);
    current = current._zod.def['innerType'] as ZodInternals;
  }
  const defType = current._zod.def['type'] as string;
  return defType === 'optional' || defType === 'default';
};

const getSchemaMeta = (
  schema: z.ZodType
): Readonly<Record<string, unknown>> | undefined => {
  const maybeMeta = (schema as unknown as { meta?: () => unknown }).meta;
  if (typeof maybeMeta !== 'function') {
    return undefined;
  }
  const meta = maybeMeta.call(schema);
  return typeof meta === 'object' && meta !== null
    ? (meta as Readonly<Record<string, unknown>>)
    : undefined;
};

const getSchemaJsonSchemaOverride = (
  schema: z.ZodType
): JsonSchema | undefined => {
  const meta = getSchemaMeta(schema);
  if (meta?.[BLOB_REF_SCHEMA_META_KEY] === true) {
    const override: JsonSchema = {
      properties: Object.fromEntries(
        Object.entries(blobRefJsonSchema.properties).map(([key, value]) => [
          key,
          { ...value },
        ])
      ),
      required: [...blobRefJsonSchema.required],
      type: blobRefJsonSchema.type,
    };
    const { description } = schema as unknown as ZodInternals;
    if (description) {
      override['description'] = description;
    }
    return override;
  }
  return undefined;
};

/**
 * Whether a schema has a deterministic JSON-schema override projection (for
 * example `blobRefSchema`, a `z.custom(...)` carrying the descriptor metadata).
 * Such schemas project to a canonical descriptor regardless of their underlying
 * Zod internals, so marker derivation can treat them as supported.
 */
export const schemaHasJsonSchemaOverride = (schema: z.ZodType): boolean =>
  getSchemaJsonSchemaOverride(schema) !== undefined;

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
// Output validation
// ---------------------------------------------------------------------------

/** Parse unknown data against a Zod schema, returning a Result suitable for output validation. */
export const validateOutput = <T>(
  schema: z.ZodType<T>,
  data: unknown
): Result<T, ValidationError> => {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return Result.ok(parsed.data);
  }
  const messages = formatZodIssues(parsed.error.issues);
  return Result.err(
    new ValidationError(`Output validation failed: ${messages.join('; ')}`, {
      cause: parsed.error,
      context: { issues: parsed.error.issues },
    })
  );
};

// ---------------------------------------------------------------------------
// Zod → JSON Schema (public API)
// ---------------------------------------------------------------------------

/**
 * Sentinel indicating a dynamic default that should be omitted from schema
 * exports. Zod v4 wraps all defaults in getters; dynamic ones (functions)
 * produce new values on each access. We detect this by reading the getter
 * twice and comparing with `Object.is`. If values differ, the default is
 * dynamic and we cache this sentinel to skip it in future calls.
 */
const DYNAMIC_DEFAULT = Symbol('DYNAMIC_DEFAULT');
const defaultValueCache = new WeakMap<object, unknown>();

const defaultsMatch = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const waitForClockAdvance = (): void => {
  const wallStart = Date.now();
  const monotonicStart = performance.now();
  while (Date.now() === wallStart && performance.now() - monotonicStart < 4) {
    // Zod hides default factories behind a getter. A bounded sync wait lets
    // Date.now()-style factories reveal themselves without making the API async.
  }
};

const readDefaultWithDateNowOffset = (
  def: Record<string, unknown>
): unknown => {
  const originalDateNow = Date.now;
  try {
    Date.now = () => originalDateNow() + 86_400_000;
    return def['defaultValue'];
  } finally {
    Date.now = originalDateNow;
  }
};

/**
 * Read a Zod v4 default getter and decide if it is stable.
 *
 * Uses Object.is for primitives and JSON.stringify for objects/arrays. A delayed
 * third read catches default factories such as `() => Date.now()` that can return
 * equal values for immediate back-to-back reads. A Date.now() probe catches
 * coarser clock factories without requiring marker derivation to wait for the
 * next second/day boundary.
 */
const resolveDefault = (def: Record<string, unknown>): unknown => {
  try {
    const a = def['defaultValue'];
    const b = def['defaultValue'];
    if (!defaultsMatch(a, b)) {
      return DYNAMIC_DEFAULT;
    }
    waitForClockAdvance();
    const c = def['defaultValue'];
    if (!defaultsMatch(a, c)) {
      return DYNAMIC_DEFAULT;
    }
    const d = readDefaultWithDateNowOffset(def);
    return defaultsMatch(a, d) ? a : DYNAMIC_DEFAULT;
  } catch {
    // BigInt, circular refs, or other non-serializable defaults
    return DYNAMIC_DEFAULT;
  }
};

export const zodDefaultValueIsDynamic = (
  def: Record<string, unknown>
): boolean => {
  if (!defaultValueCache.has(def)) {
    defaultValueCache.set(def, resolveDefault(def));
  }
  return defaultValueCache.get(def) === DYNAMIC_DEFAULT;
};

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
  const jsonSchemaOverride = getSchemaJsonSchemaOverride(schema);
  if (jsonSchemaOverride !== undefined) {
    return jsonSchemaOverride;
  }

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
      zodDefaultValueIsDynamic(value._zod.def);
      const cached = defaultValueCache.get(value._zod.def);
      if (cached !== DYNAMIC_DEFAULT) {
        innerSchema['default'] = cached;
      }
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
    readonly: (value) => {
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
