/**
 * Type guards and assertion helpers for @ontrails/core.
 */

/** Narrows `T | null | undefined` to `T`. */
export const isDefined = <T>(value?: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/** Returns true when `value` is a string with length > 0. */
export const isNonEmptyString = (value?: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/** Returns true when `value` is a plain object (not an array, Date, etc.). */
export const isPlainObject = (
  value: unknown
): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Checks that `obj` is an object with the given key present. */
export const hasProperty = <K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> =>
  typeof obj === 'object' && obj !== null && key in obj;

/**
 * Exhaustive switch helper. Place in the `default` branch to get a compile
 * error when a union case is unhandled.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${String(value)}`);
};
