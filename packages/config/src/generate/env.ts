/**
 * `.env.example` file generation from Zod schema `env()` bindings.
 *
 * Lists each env var with its type, default, and whether it is a secret.
 * Returns an empty string when no env bindings are present.
 */
import type { z } from 'zod';

import { collectConfigMeta } from '../collect.js';
import type { ConfigFieldMeta } from '../extensions.js';

import { isLikelySecret } from '../secret-heuristics.js';

import {
  formatValue,
  getDefault,
  getDescription,
  resolveFieldByPath,
  unwrap,
  zodTypeName,
  zodTypeToJsonSchema,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map Zod type names to human-readable type labels. */
const typeLabel = (schema: z.ZodType): string => {
  const typeName = zodTypeName(unwrap(schema));
  return zodTypeToJsonSchema[typeName] ?? typeName;
};

/** Build the type annotation comment for an env entry. */
const envTypeAnnotation = (
  fieldSchema: z.ZodType,
  meta: ConfigFieldMeta
): string => {
  const parts = [`type: ${typeLabel(fieldSchema)}`];
  const info = getDefault(fieldSchema);
  if (info.has) {
    parts.push(`default: ${formatValue(info.value)}`);
  }
  if (meta.secret) {
    parts.push('secret');
  }
  return `# ${parts.join(', ')}`;
};

/** Format a single env var entry. */
const envEntry = (
  envVar: string,
  fieldSchema: z.ZodType,
  meta: ConfigFieldMeta
): readonly string[] => {
  const effectiveMeta =
    !meta.secret && isLikelySecret(envVar) ? { ...meta, secret: true } : meta;

  const lines: string[] = [];
  const desc = getDescription(fieldSchema);
  if (desc) {
    lines.push(`# ${desc}`);
  }
  lines.push(envTypeAnnotation(fieldSchema, effectiveMeta));
  lines.push(`${envVar}=`);
  return lines;
};

/** Collect env entries from config metadata. */
const collectEnvEntries = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  meta: Map<string, ConfigFieldMeta>
): readonly string[] => {
  const entries: string[] = [];
  for (const [path, fieldMeta] of meta) {
    if (!fieldMeta.env) {
      continue;
    }
    const fieldSchema = resolveFieldByPath(schema, path);
    if (!fieldSchema) {
      continue;
    }
    entries.push(...envEntry(fieldMeta.env, fieldSchema, fieldMeta));
    entries.push('');
  }
  return entries;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a `.env.example` file from `env()` bindings in the schema.
 *
 * Lists each env var with its type, default, and whether it is a secret.
 * Returns an empty string when no env bindings are present.
 */
export const generateEnvExample = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): string => {
  const entries = collectEnvEntries(schema, collectConfigMeta(schema));
  return entries.length === 0 ? '' : entries.join('\n');
};
