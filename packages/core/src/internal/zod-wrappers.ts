/**
 * Shared Zod wrapper helpers.
 *
 * These helpers walk the wrapper layers of a Zod schema (default, optional,
 * nullable) and rebuild the schema without any default wrappers so that
 * downstream `.partial()` calls do not silently re-materialize defaults during
 * validation. Both `@ontrails/core/trails/derive-trail.ts` and
 * `@ontrails/store/src/store.ts` previously shipped near-identical copies of
 * this walk — extracting them here keeps the wrapper semantics authored in one
 * place so the two call sites cannot drift.
 *
 * Canonical behavior: `optional` wrappers are intentionally dropped. Every
 * current call site applies `.partial()` to the stripped schema, which
 * re-introduces `optional` across the whole shape. Preserving `optional` here
 * would be redundant at best and would produce an `OptionalOptional<T>` shape
 * in edge cases at worst. `nullable` wrappers are preserved because nullability
 * is a semantic constraint that `.partial()` does not reintroduce.
 *
 * @internal
 */

import type { z } from 'zod';

const isWrapperType = (
  type: string
): type is 'default' | 'nullable' | 'optional' =>
  type === 'default' || type === 'nullable' || type === 'optional';

const readInnerType = (schema: z.ZodType): z.ZodType =>
  (schema.def as unknown as { innerType: z.ZodType }).innerType;

/**
 * Strip `default` wrappers from a Zod type so that partial update schemas do
 * not silently re-materialize defaults. Walks through all wrapper layers
 * (`default`, `optional`, `nullable`), drops defaults, drops `optional` (the
 * downstream `.partial()` reintroduces it across the whole shape), and
 * preserves `nullable` so explicit nullability survives.
 *
 * @internal
 */
export const stripDefaultWrappers = (schema: z.ZodType): z.ZodType => {
  let current = schema;
  let isNullable = false;

  while (isWrapperType(current.def.type)) {
    if (current.def.type === 'nullable') {
      isNullable = true;
    }
    current = readInnerType(current);
  }

  return isNullable ? current.nullable() : current;
};

type AnyObjectSchema = z.ZodObject<Record<string, z.ZodType>>;

const asObjectSchema = (schema: z.ZodType): AnyObjectSchema =>
  schema as unknown as AnyObjectSchema;

/**
 * Apply {@link stripDefaultWrappers} to every field in a Zod object shape and
 * return the resulting shape record. Callers typically feed the result to
 * `.extend()` + `.partial()`.
 *
 * @internal
 */
export const stripDefaultsFromShape = (
  schema: z.ZodType
): Record<string, z.ZodType> => {
  const stripped: Record<string, z.ZodType> = {};
  const objectSchema = asObjectSchema(schema);

  for (const [field, value] of Object.entries(objectSchema.shape)) {
    stripped[field] = stripDefaultWrappers(value);
  }

  return stripped;
};
