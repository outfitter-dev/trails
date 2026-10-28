/**
 * Validate JSON data without invoking accessors or silently omitting properties.
 * Zod's record parser skips __proto__ (zod/src/v4/core/schemas.ts:2250),
 * so z.json() alone cannot preserve and validate every authored JSON property.
 * Shared references are allowed; only the current ancestor chain is cyclic.
 */
export const hasPortableJsonStructure = (
  value: unknown,
  ancestors = new Set<object>()
): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors).filter(
    ([key]) => !array || key !== 'length'
  );
  if (array && entries.length !== value.length) {
    return false;
  }
  ancestors.add(value);
  try {
    return entries.every(([key, descriptor]) => {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return false;
      }
      if (
        array &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      ) {
        return false;
      }
      return hasPortableJsonStructure(descriptor.value, ancestors);
    });
  } finally {
    ancestors.delete(value);
  }
};
