/**
 * Collection utilities and type helpers for @ontrails/core.
 */

// ---------------------------------------------------------------------------
// Type utilities
// ---------------------------------------------------------------------------

/** Recursively make every property optional. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Flatten an intersection into a single object type for better IDE display. */
// oxlint-disable-next-line ban-types -- `& {}` is a standard TypeScript idiom to force type expansion in IDE tooltips
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Require at least one property from T. */
export type AtLeastOne<T> = {
  [K in keyof T]-?: Pick<T, K> & Partial<Omit<T, K>>;
}[keyof T];

/** A tuple with at least one element. */
export type NonEmptyArray<T> = [T, ...T[]];

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Narrows a readonly array to a NonEmptyArray. */
export const isNonEmptyArray = <T>(
  array: readonly T[]
): array is NonEmptyArray<T> => array.length > 0;

// ---------------------------------------------------------------------------
// Collection functions
// ---------------------------------------------------------------------------

/** Split an array into chunks of at most `size` elements. */
export const chunk = <T>(array: readonly T[], size: number): T[][] => {
  if (size < 1) {
    throw new RangeError('chunk size must be >= 1');
  }
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

/**
 * Remove duplicate items. When `key` is provided, uniqueness is determined
 * by the return value of the key function; otherwise strict equality is used.
 */
export const dedupe = <T>(
  array: readonly T[],
  key?: (item: T) => unknown
): T[] => {
  if (!key) {
    return [...new Set(array)];
  }
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const item of array) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
    }
  }
  return result;
};

/** Group items by a string key. */
export const groupBy = <T>(
  array: readonly T[],
  key: (item: T) => string
): Record<string, T[]> => {
  const groups: Record<string, T[]> = {};
  for (const item of array) {
    const k = key(item);
    (groups[k] ??= []).push(item);
  }
  return groups;
};

/** Return a new sorted array based on a key function (ascending). */
export const sortBy = <T>(
  array: readonly T[],
  key: (item: T) => string | number
): T[] =>
  [...array].toSorted((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (typeof ka === 'number' && typeof kb === 'number') {
      return ka - kb;
    }
    return String(ka).localeCompare(String(kb));
  });
