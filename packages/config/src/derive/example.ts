/**
 * Config example file generation in multiple formats.
 *
 * Produces TOML, JSON, JSONC, and YAML example files from a Zod schema,
 * with defaults shown and deprecated fields annotated.
 */
import type { z } from 'zod';

import {
  fieldComments,
  fieldValue,
  formatValue,
  getObjectShape,
  isObjectType,
  pushComments,
  unwrap,
} from './helpers.js';

// ---------------------------------------------------------------------------
// TOML generation
// ---------------------------------------------------------------------------

/** Render a flat set of fields as TOML key = value lines. */
const renderTomlFields = (
  shape: Record<string, z.ZodType>,
  lines: string[]
): void => {
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (isObjectType(fieldSchema)) {
      continue;
    }
    pushComments(lines, fieldComments(fieldSchema, '#'), '');
    lines.push(`${key} = ${formatValue(fieldValue(fieldSchema))}`);
  }
};

/** Render nested objects as TOML sections, recursing with dotted prefixes. */
const renderTomlSections = (
  shape: Record<string, z.ZodType>,
  lines: string[],
  prefix = ''
): void => {
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const nested = isObjectType(fieldSchema)
      ? getObjectShape(fieldSchema)
      : undefined;
    if (!nested) {
      continue;
    }
    const sectionKey = prefix ? `${prefix}.${key}` : key;
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`[${sectionKey}]`);
    renderTomlFields(nested, lines);
    // oxlint-disable-next-line max-statements -- recursive TOML section rendering
    renderTomlSections(nested, lines, sectionKey);
  }
};

const formatToml = (schema: z.ZodObject<Record<string, z.ZodType>>): string => {
  const shape = schema.shape as Record<string, z.ZodType>;
  const lines: string[] = [];
  renderTomlFields(shape, lines);
  renderTomlSections(shape, lines);
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// JSON / JSONC generation
// ---------------------------------------------------------------------------

/** Resolve a field to its nested object or its scalar value. */
const resolveJsonField = (
  fieldSchema: z.ZodType,
  recurse: (
    s: z.ZodObject<Record<string, z.ZodType>>
  ) => Record<string, unknown>
): unknown => {
  if (!isObjectType(fieldSchema)) {
    return fieldValue(fieldSchema);
  }
  const nested = getObjectShape(fieldSchema);
  if (!nested) {
    return fieldValue(fieldSchema);
  }
  const inner = unwrap(fieldSchema) as z.ZodObject<Record<string, z.ZodType>>;
  return recurse(inner);
};

/** Build a plain object with default/placeholder values for JSON output. */
const buildJsonObject = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): Record<string, unknown> => {
  const shape = schema.shape as Record<string, z.ZodType>;
  const obj: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    obj[key] = resolveJsonField(fieldSchema, buildJsonObject);
  }
  return obj;
};

const formatJson = (schema: z.ZodObject<Record<string, z.ZodType>>): string =>
  `${JSON.stringify(buildJsonObject(schema), null, 2)}\n`;

/** Serialize a nested object field for JSONC output. */
const serializeJsoncObject = (fieldSchema: z.ZodType): string | undefined => {
  const nested = getObjectShape(fieldSchema);
  if (!nested) {
    return undefined;
  }
  const inner = unwrap(fieldSchema) as z.ZodObject<Record<string, z.ZodType>>;
  return JSON.stringify(buildJsonObject(inner), null, 2).replaceAll(
    '\n',
    '\n  '
  );
};

/** Render a single JSONC entry (comments + key: value). */
const renderJsoncEntry = (
  key: string,
  fieldSchema: z.ZodType,
  isLast: boolean,
  lines: string[]
): void => {
  pushComments(lines, fieldComments(fieldSchema, '//'), '  ');
  const comma = isLast ? '' : ',';
  const serialized = isObjectType(fieldSchema)
    ? serializeJsoncObject(fieldSchema)
    : undefined;
  const val = serialized ?? formatValue(fieldValue(fieldSchema));
  lines.push(`  "${key}": ${val}${comma}`);
};

const formatJsonc = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): string => {
  const keys = Object.keys(schema.shape);
  const shape = schema.shape as Record<string, z.ZodType>;
  const lines: string[] = ['{'];

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string;
    renderJsoncEntry(
      key,
      shape[key] as z.ZodType,
      i === keys.length - 1,
      lines
    );
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// YAML generation
// ---------------------------------------------------------------------------

/** Render a single YAML scalar field. */
const renderYamlScalar = (
  key: string,
  fieldSchema: z.ZodType,
  indent: string,
  lines: string[]
): void => {
  pushComments(lines, fieldComments(fieldSchema, '#'), indent);
  lines.push(`${indent}${key}: ${formatValue(fieldValue(fieldSchema))}`);
};

/** Render YAML fields at a given indent level. */
const renderYamlFields = (
  shape: Record<string, z.ZodType>,
  indent: string,
  lines: string[]
): void => {
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (isObjectType(fieldSchema)) {
      const nested = getObjectShape(fieldSchema);
      if (!nested) {
        continue;
      }
      lines.push(`${indent}${key}:`);
      renderYamlFields(nested, `${indent}  `, lines);
    } else {
      renderYamlScalar(key, fieldSchema, indent, lines);
    }
  }
};

const formatYaml = (schema: z.ZodObject<Record<string, z.ZodType>>): string => {
  const shape = schema.shape as Record<string, z.ZodType>;
  const lines: string[] = [];
  renderYamlFields(shape, '', lines);
  return `${lines.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// Format dispatch
// ---------------------------------------------------------------------------

type ExampleFormat = 'json' | 'jsonc' | 'toml' | 'yaml';

const formatters: Record<
  ExampleFormat,
  (schema: z.ZodObject<Record<string, z.ZodType>>) => string
> = {
  json: formatJson,
  jsonc: formatJsonc,
  toml: formatToml,
  yaml: formatYaml,
};

/**
 * Generate an example config file in the specified format.
 *
 * Includes descriptions as comments, defaults shown, deprecated fields annotated.
 */
export const deriveConfigExample = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  format: ExampleFormat
): string => formatters[format](schema);
