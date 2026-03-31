/**
 * Config doctor — structured diagnostics for a config object against a schema.
 *
 * Reports which fields are valid, missing, using defaults, deprecated, or invalid.
 */

import type { z } from 'zod';

import { collectConfigMeta } from './collect.js';
import { getAtPath, isZodObject, zodDef } from './zod-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Diagnostic status for a single config field. */
export interface ConfigDiagnostic {
  readonly path: string;
  readonly status: 'valid' | 'missing' | 'invalid' | 'deprecated' | 'default';
  readonly message: string;
  readonly value?: unknown;
}

/** Aggregated result from checking config against a schema. */
export interface CheckResult {
  readonly diagnostics: readonly ConfigDiagnostic[];
  readonly valid: boolean;
}

// ---------------------------------------------------------------------------
// Helpers (defined before consumers)
// ---------------------------------------------------------------------------

/** Check if a schema wraps a ZodDefault. */
const isDefaultWrapper = (schema: z.ZodType): boolean =>
  zodDef(schema)['type'] === 'default';

/** Check if a schema wraps a ZodOptional. */
const isOptionalWrapper = (schema: z.ZodType): boolean =>
  zodDef(schema)['type'] === 'optional';

/** Get the default value from a ZodDefault wrapper. */
const getDefaultValue = (schema: z.ZodType): unknown =>
  zodDef(schema)['defaultValue'];

/** Set a value at a dot-separated path, creating intermediate objects. */
const setAtPath = (
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void => {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i] as string;
    const next = current[part];
    const nested =
      typeof next === 'object' && next !== null
        ? (next as Record<string, unknown>)
        : {};
    current[part] = nested;
    current = nested;
  }
  const lastPart = parts.at(-1) as string;
  current[lastPart] = value;
};

/** Build values object with env overrides applied. */
const applyEnvToValues = (
  values: Record<string, unknown>,
  schema: z.ZodObject<Record<string, z.ZodType>>,
  envVars: Record<string, string | undefined>
): Record<string, unknown> => {
  const meta = collectConfigMeta(schema);
  const result = structuredClone(values) as Record<string, unknown>;
  for (const [path, fieldMeta] of meta) {
    if (fieldMeta.env && envVars[fieldMeta.env] !== undefined) {
      setAtPath(result, path, envVars[fieldMeta.env]);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Schema walking
// ---------------------------------------------------------------------------

/** Entry for the iterative schema walk queue. */
interface WalkEntry {
  readonly schema: z.ZodType;
  readonly path: string;
}

/** Validate a single field value against its schema. */
const validateFieldValue = (
  path: string,
  fieldSchema: z.ZodType,
  value: unknown
): ConfigDiagnostic => {
  const result = fieldSchema.safeParse(value);
  if (result.success) {
    return { message: 'OK', path, status: 'valid', value };
  }
  const issue = result.error?.issues?.[0];
  const msg = issue ? issue.message : 'Invalid value';
  return { message: msg, path, status: 'invalid', value };
};

/** Classify a single field and produce a diagnostic. */
const classifyField = (
  path: string,
  fieldSchema: z.ZodType,
  values: Record<string, unknown>,
  deprecatedMeta: Map<string, string>
): ConfigDiagnostic => {
  const value = getAtPath(values, path);
  const deprecationMsg = deprecatedMeta.get(path);

  if (deprecationMsg && value !== undefined) {
    return { message: deprecationMsg, path, status: 'deprecated', value };
  }

  if (value === undefined && isDefaultWrapper(fieldSchema)) {
    return {
      message: 'Using default value',
      path,
      status: 'default',
      value: getDefaultValue(fieldSchema),
    };
  }

  if (value === undefined && !isOptionalWrapper(fieldSchema)) {
    return {
      message: `Required field "${path}" is missing`,
      path,
      status: 'missing',
    };
  }

  return validateFieldValue(path, fieldSchema, value);
};

/** Collect deprecated metadata paths from config meta. */
const collectDeprecatedPaths = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): Map<string, string> => {
  const meta = collectConfigMeta(schema);
  const result = new Map<string, string>();
  for (const [path, fieldMeta] of meta) {
    if (fieldMeta.deprecated) {
      result.set(path, fieldMeta.deprecated);
    }
  }
  return result;
};

/** Walk an object shape and enqueue leaf fields or nested objects. */
const walkShape = (
  schema: z.ZodType,
  prefix: string,
  queue: WalkEntry[],
  leaves: WalkEntry[]
): void => {
  const shape = zodDef(schema)['shape'] as Record<string, z.ZodType>;
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isZodObject(fieldSchema)) {
      queue.push({ path, schema: fieldSchema });
    } else {
      leaves.push({ path, schema: fieldSchema });
    }
  }
};

/** Collect all leaf fields from a schema, walking nested objects iteratively. */
const collectLeaves = (schema: z.ZodType): WalkEntry[] => {
  const queue: WalkEntry[] = [];
  const leaves: WalkEntry[] = [];
  walkShape(schema, '', queue, leaves);

  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    walkShape(entry.schema, entry.path, queue, leaves);
  }

  return leaves;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a config object against a schema and return structured diagnostics.
 *
 * Reports which fields are valid, missing, using defaults, deprecated, or invalid.
 */
export const checkConfig = <T extends z.ZodType>(
  schema: T,
  values: Record<string, unknown>,
  options?: { readonly env?: Record<string, string | undefined> }
): CheckResult => {
  const objSchema = schema as unknown as z.ZodObject<Record<string, z.ZodType>>;
  const effectiveValues = options?.env
    ? applyEnvToValues(values, objSchema, options.env)
    : values;

  const deprecatedMeta = collectDeprecatedPaths(objSchema);
  const leaves = collectLeaves(objSchema);

  const diagnostics = leaves.map((leaf) =>
    classifyField(leaf.path, leaf.schema, effectiveValues, deprecatedMeta)
  );

  const valid = diagnostics.every(
    (d) => d.status !== 'missing' && d.status !== 'invalid'
  );

  return { diagnostics, valid };
};
