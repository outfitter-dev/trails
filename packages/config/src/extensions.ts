import type { z } from 'zod';

/** Metadata shape stored on Zod schemas via `.meta()`. */
export interface ConfigFieldMeta {
  readonly env?: string;
  readonly secret?: boolean;
  readonly deprecated?: string;
}

/**
 * Bind a schema field to an environment variable.
 *
 * Must be called BEFORE `.default()`, `.optional()`, or other transforms
 * so that the metadata lives on the inner type where `collectConfigMeta`
 * can find it by unwrapping wrappers.
 */
export const env = <T extends z.ZodType>(schema: T, varName: string): T =>
  schema.meta({ ...schema.meta(), env: varName }) as T;

/**
 * Mark a schema field as sensitive. Redacted in survey, explain, and logs.
 *
 * Must be called BEFORE `.default()`, `.optional()`, or other transforms.
 */
export const secret = <T extends z.ZodType>(schema: T): T =>
  schema.meta({ ...schema.meta(), secret: true }) as T;

/**
 * Mark a schema field as deprecated with migration guidance.
 *
 * Stores **two** meta keys: `deprecated: true` and `deprecationMessage: string`.
 * This indirection exists because Zod 4's `GlobalMeta` types `deprecated` as
 * `boolean | undefined` — there is no way to attach a migration message to the
 * standard key. We set `deprecated: true` so Zod-native tooling (schema
 * serializers, OpenAPI generators) recognises the field as deprecated, and store
 * the human-readable message under `deprecationMessage` for our own
 * `collectConfigMeta` / survey / explain surfaces.
 *
 * Must be called BEFORE `.default()`, `.optional()`, or other transforms
 * so that the metadata lives on the inner type where `collectConfigMeta`
 * can find it by unwrapping wrappers.
 */
export const deprecated = <T extends z.ZodType>(
  schema: T,
  message: string
): T =>
  schema.meta({
    ...schema.meta(),
    deprecated: true,
    deprecationMessage: message,
  }) as T;
