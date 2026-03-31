/**
 * Config introspection — describe all fields in a schema without values.
 *
 * Returns a structured catalog suitable for CLI rendering or agent inspection.
 */

import { globalRegistry } from 'zod';
import type { z } from 'zod';

import { collectConfigMeta } from './collect.js';
import { isZodObject, unwrapToBase, zodDef } from './zod-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Description of a single config field. */
export interface FieldDescription {
  readonly path: string;
  readonly type: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly required: boolean;
  readonly env?: string;
  readonly secret?: boolean;
  readonly deprecated?: string;
  readonly constraints?: Record<string, unknown>;
}

/** Accumulated state while unwrapping Zod wrappers. */
interface UnwrapState {
  hasDefault: boolean;
  defaultValue: unknown;
  isOptional: boolean;
}

/** Unwrap result carrying both base schema and accumulated metadata. */
interface UnwrapResult {
  readonly base: z.ZodType;
  readonly hasDefault: boolean;
  readonly defaultValue: unknown;
  readonly isOptional: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (defined before consumers — satisfies no-use-before-define)
// ---------------------------------------------------------------------------

/** Read the description from the Zod global registry. */
const getDescription = (schema: z.ZodType): string | undefined => {
  const meta = globalRegistry.get(schema);
  return meta?.description as string | undefined;
};

/** Handle a single unwrap step; returns updated inner type and state, or null to stop. */
const unwrapStep = (
  def: Record<string, unknown>,
  state: UnwrapState
): { inner: z.ZodType; state: UnwrapState } | null => {
  const typeName = def['type'] as string;

  if (typeName === 'default') {
    return {
      inner: def['innerType'] as z.ZodType,
      state: { ...state, defaultValue: def['defaultValue'], hasDefault: true },
    };
  }

  if (typeName === 'optional') {
    return {
      inner: def['innerType'] as z.ZodType,
      state: { ...state, isOptional: true },
    };
  }

  if (typeName === 'nullable') {
    return { inner: def['innerType'] as z.ZodType, state };
  }

  return null;
};

/** Unwrap through default/optional/nullable wrappers to find the base type. */
const unwrapSchema = (schema: z.ZodType): UnwrapResult => {
  let current = schema;
  let state: UnwrapState = {
    defaultValue: undefined,
    hasDefault: false,
    isOptional: false,
  };

  for (let depth = 0; depth < 10; depth += 1) {
    const result = unwrapStep(zodDef(current), state);
    if (!result) {
      break;
    }
    current = result.inner;
    ({ state } = result);
  }

  return { base: current, ...state };
};

/** Resolve the user-facing type name from a base Zod schema. */
const resolveTypeName = (schema: z.ZodType): string => {
  const typeName = zodDef(schema)['type'] as string;
  const typeMap: Record<string, string> = {
    boolean: 'boolean',
    enum: 'enum',
    number: 'number',
    string: 'string',
  };
  return typeMap[typeName] ?? typeName;
};

/** Extract enum values from an enum def. */
const extractEnumConstraints = (
  def: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const entries = def['entries'] as Record<string, string> | undefined;
  if (!entries) {
    return undefined;
  }
  return { values: Object.values(entries) };
};

/** Extract min/max from a number schema's properties. */
const extractNumberConstraints = (
  schema: z.ZodType
): Record<string, unknown> | undefined => {
  const result: Record<string, unknown> = {};
  const numSchema = schema as unknown as {
    minValue?: number;
    maxValue?: number;
  };

  if (numSchema.minValue !== undefined && numSchema.minValue !== null) {
    result['min'] = numSchema.minValue;
  }
  if (numSchema.maxValue !== undefined && numSchema.maxValue !== null) {
    result['max'] = numSchema.maxValue;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

/** Extract constraints from a base schema (min, max, enum values). */
const extractConstraints = (
  schema: z.ZodType
): Record<string, unknown> | undefined => {
  const def = zodDef(schema);
  const typeName = def['type'] as string;

  if (typeName === 'enum') {
    return extractEnumConstraints(def);
  }
  if (typeName === 'number') {
    return extractNumberConstraints(schema);
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Schema walking
// ---------------------------------------------------------------------------

/** Entry for iterative schema walk. */
interface WalkEntry {
  readonly schema: z.ZodType;
  readonly prefix: string;
}

/** Build a single FieldDescription from a leaf schema and its metadata. */
const buildFieldDescription = (
  path: string,
  fieldSchema: z.ZodType,
  configMeta: Map<
    string,
    { env?: string; secret?: boolean; deprecated?: string }
  >
): FieldDescription => {
  const { base, defaultValue, hasDefault, isOptional } =
    unwrapSchema(fieldSchema);
  const meta = configMeta.get(path);
  const description = getDescription(base) ?? getDescription(fieldSchema);
  const constraints = extractConstraints(base);

  return {
    ...(constraints ? { constraints } : {}),
    ...(hasDefault ? { default: defaultValue } : {}),
    ...(meta?.deprecated ? { deprecated: meta.deprecated } : {}),
    ...(description ? { description } : {}),
    ...(meta?.env ? { env: meta.env } : {}),
    path,
    required: !hasDefault && !isOptional,
    ...(meta?.secret ? { secret: meta.secret } : {}),
    type: resolveTypeName(base),
  };
};

/** Walk one level of an object shape, collecting leaves and queuing nested objects. */
const walkShapeLevel = (
  shape: Record<string, z.ZodType>,
  prefix: string,
  configMeta: Map<
    string,
    { env?: string; secret?: boolean; deprecated?: string }
  >,
  results: FieldDescription[],
  queue: WalkEntry[]
): void => {
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isZodObject(fieldSchema)) {
      queue.push({ prefix: path, schema: unwrapToBase(fieldSchema) });
    } else {
      results.push(buildFieldDescription(path, fieldSchema, configMeta));
    }
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Describe all fields in a schema without needing a config file.
 *
 * Returns a structured catalog suitable for CLI rendering or agent inspection.
 */
export const describeConfig = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): readonly FieldDescription[] => {
  const configMeta = collectConfigMeta(schema);
  const queue: WalkEntry[] = [];
  const results: FieldDescription[] = [];

  walkShapeLevel(
    schema.shape as Record<string, z.ZodType>,
    '',
    configMeta,
    results,
    queue
  );

  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const nested = zodDef(entry.schema)['shape'] as Record<string, z.ZodType>;
    walkShapeLevel(nested, entry.prefix, configMeta, results, queue);
  }

  return results;
};
