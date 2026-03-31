/**
 * Config provenance — show which source won for each config field.
 *
 * Used for debugging: answers "where did this value come from?"
 */

import type { z } from 'zod';

import { collectConfigMeta } from './collect.js';
import { isLikelySecret } from './secret-heuristics.js';
import { getAtPath, isZodObject, zodDef } from './zod-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Provenance entry describing the source of a resolved config value. */
export interface ProvenanceEntry {
  readonly path: string;
  readonly value: unknown;
  readonly source: 'default' | 'base' | 'loadout' | 'local' | 'env';
  readonly redacted: boolean;
}

/** Options for explaining config provenance. */
export interface ExplainConfigOptions<T extends z.ZodType> {
  readonly schema: T;
  readonly base?: Record<string, unknown>;
  readonly loadout?: Record<string, unknown>;
  readonly local?: Record<string, unknown>;
  readonly env?: Record<string, string | undefined>;
  readonly resolved: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers (defined before consumers)
// ---------------------------------------------------------------------------

/** Build a map of path → env var name from config metadata. */
const buildEnvMap = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): Map<string, string> => {
  const meta = collectConfigMeta(schema);
  const result = new Map<string, string>();
  for (const [path, fieldMeta] of meta) {
    if (fieldMeta.env) {
      result.set(path, fieldMeta.env);
    }
  }
  return result;
};

/** Build a set of paths marked as secret from config metadata. */
const buildSecretSet = (
  schema: z.ZodObject<Record<string, z.ZodType>>
): Set<string> => {
  const meta = collectConfigMeta(schema);
  const result = new Set<string>();
  for (const [path, fieldMeta] of meta) {
    if (fieldMeta.secret) {
      result.add(path);
    }
  }
  return result;
};

/** Source layers in reverse precedence order for winner detection. */
type SourceLayer = readonly [
  name: ProvenanceEntry['source'],
  values: Record<string, unknown> | undefined,
];

/** Determine which source provided the winning value for a given path. */
const determineSource = (
  path: string,
  resolved: Record<string, unknown>,
  layers: readonly SourceLayer[],
  envMap: Map<string, string>,
  envVars: Record<string, string | undefined> | undefined
): ProvenanceEntry['source'] => {
  if (envVars && envMap.has(path)) {
    const envVar = envMap.get(path);
    if (envVar && envVars[envVar] !== undefined) {
      return 'env';
    }
  }

  const resolvedValue = getAtPath(resolved, path);
  for (const [name, values] of layers) {
    if (values && getAtPath(values, path) === resolvedValue) {
      return name;
    }
  }

  return 'default';
};

// ---------------------------------------------------------------------------
// Schema walking
// ---------------------------------------------------------------------------

/** Entry for iterative schema walk. */
interface WalkEntry {
  readonly schema: z.ZodType;
  readonly prefix: string;
}

/** Collect all leaf field paths from an object schema. */
const collectLeafPaths = (schema: z.ZodType, prefix: string): string[] => {
  const paths: string[] = [];
  const queue: WalkEntry[] = [{ prefix, schema }];

  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    const shape = zodDef(entry.schema)['shape'] as Record<string, z.ZodType>;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const path = entry.prefix ? `${entry.prefix}.${key}` : key;
      if (isZodObject(fieldSchema)) {
        queue.push({ prefix: path, schema: fieldSchema });
      } else {
        paths.push(path);
      }
    }
  }

  return paths;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show which source won for each config field.
 *
 * Used for debugging — answers "where did this value come from?"
 *
 */
export const explainConfig = <T extends z.ZodType>(
  options: ExplainConfigOptions<T>
): readonly ProvenanceEntry[] => {
  const objSchema = options.schema as unknown as z.ZodObject<
    Record<string, z.ZodType>
  >;
  const envMap = buildEnvMap(objSchema);
  const secretSet = buildSecretSet(objSchema);

  const layers: readonly SourceLayer[] = [
    ['local', options.local],
    ['loadout', options.loadout],
    ['base', options.base],
  ];

  const paths = collectLeafPaths(objSchema, '');

  return paths.map((path) => {
    const source = determineSource(
      path,
      options.resolved,
      layers,
      envMap,
      options.env
    );
    const envVarName = envMap.get(path);
    const isSecret =
      secretSet.has(path) ||
      (envVarName !== undefined && isLikelySecret(envVarName));
    const rawValue = getAtPath(options.resolved, path);

    return {
      path,
      redacted: isSecret,
      source,
      value: isSecret ? '[REDACTED]' : rawValue,
    };
  });
};
