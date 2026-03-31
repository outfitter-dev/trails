/**
 * Simple recursive deep merge for config objects.
 *
 * - Objects merge recursively
 * - Arrays replace (no concatenation)
 * - Primitives replace
 * - `undefined` values in source are skipped
 */

/** Check whether a value is a plain object (not array, null, or class instance). */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Deep-merge `source` into `target`, returning a new object.
 *
 * Does not mutate either input. Undefined values in source are skipped,
 * preserving the target's value at that key.
 */
export const deepMerge = (
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    if (sourceValue === undefined) {
      continue;
    }

    const targetValue = result[key];

    result[key] =
      isPlainObject(targetValue) && isPlainObject(sourceValue)
        ? deepMerge(targetValue, sourceValue)
        : sourceValue;
  }

  return result;
};
