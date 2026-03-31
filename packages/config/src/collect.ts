import { globalRegistry } from 'zod';
import type { z } from 'zod';

import type { ConfigFieldMeta } from './extensions.js';
import { isZodObject } from './zod-utils.js';

/** Config meta keys we look for in Zod registry entries. */
const META_EXTRACTORS: readonly {
  test: (raw: Record<string, unknown>) => boolean;
  extract: (raw: Record<string, unknown>) => Partial<ConfigFieldMeta>;
}[] = [
  {
    extract: (r) => ({ env: r['env'] as string }),
    test: (r) => typeof r['env'] === 'string',
  },
  {
    extract: () => ({ secret: true }),
    test: (r) => r['secret'] === true,
  },
  {
    extract: (r) => ({ deprecated: r['deprecationMessage'] as string }),
    test: (r) => typeof r['deprecationMessage'] === 'string',
  },
];

/**
 * Pick only `ConfigFieldMeta` keys from a raw registry entry.
 * Uses a lookup table to stay under the max-statements limit.
 */
const pickConfigMeta = (
  raw: Record<string, unknown> | undefined
): ConfigFieldMeta | undefined => {
  if (!raw) {
    return undefined;
  }

  const parts = META_EXTRACTORS.filter((e) => e.test(raw)).map((e) =>
    e.extract(raw)
  );
  return parts.length > 0
    ? (Object.assign({}, ...parts) as ConfigFieldMeta)
    : undefined;
};

/**
 * Extract `ConfigFieldMeta` from a schema, unwrapping through
 * `.default()`, `.optional()`, `.nullable()` wrappers as needed.
 */
const extractConfigMeta = (schema: z.ZodType): ConfigFieldMeta | undefined => {
  let current: z.ZodType | undefined = schema;

  while (current) {
    const meta = pickConfigMeta(globalRegistry.get(current));
    if (meta) {
      return meta;
    }

    const def = current.def as unknown as Record<string, unknown>;
    current = def['innerType'] as z.ZodType | undefined;
  }

  return undefined;
};

/** Entry in the iterative work queue for schema walking. */
interface WalkEntry {
  readonly schema: z.ZodObject<Record<string, z.ZodType>>;
  readonly prefix: string;
}

/** Process one level of an object schema, queuing nested objects. */
const walkObjectShape = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  prefix: string,
  result: Map<string, ConfigFieldMeta>,
  queue: WalkEntry[]
): void => {
  const shape = schema.shape as Record<string, z.ZodType>;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isZodObject(fieldSchema)) {
      queue.push({
        prefix: path,
        schema: fieldSchema as z.ZodObject<Record<string, z.ZodType>>,
      });
    } else {
      const meta = extractConfigMeta(fieldSchema);
      if (meta) {
        result.set(path, meta);
      }
    }
  }
};

/**
 * Walk a Zod object schema and collect `ConfigFieldMeta` for each field.
 *
 * Handles unwrapping `.default()`, `.optional()`, `.nullable()` wrappers
 * that don't carry inner metadata forward. Recurses into nested `ZodObject`
 * fields using dot-separated paths.
 */
export const collectConfigMeta = (
  schema: z.ZodObject<Record<string, z.ZodType>>,
  prefix = ''
): Map<string, ConfigFieldMeta> => {
  const result = new Map<string, ConfigFieldMeta>();
  const queue: WalkEntry[] = [{ prefix, schema }];

  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    walkObjectShape(entry.schema, entry.prefix, result, queue);
  }

  return result;
};
