/**
 * Progressive assertion logic for example-driven testing.
 *
 * Three tiers:
 * 1. Full match — example has `expected` output
 * 2. Schema-only — no expected output, no error
 * 3. Error match — example declares an error class name
 */

import { expect } from 'bun:test';

import type { Result } from '@ontrails/core';
import { formatZodIssues } from '@ontrails/core';
import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Result narrowing helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a Result is Ok and return its value.
 *
 * Eliminates the `if (result.isOk())` / `as unknown as` dance in tests.
 *
 * @example
 * ```typescript
 * const value = expectOk(result);
 * expect(value.name).toBe('Alice');
 * ```
 */
export const expectOk = <T, E>(result: Result<T, E>): T => {
  expect(result.isOk()).toBe(true);
  return (result as unknown as { value: T }).value;
};

/**
 * Assert that a Result is Err and return its error.
 *
 * Eliminates the `if (result.isErr())` / `as unknown as` dance in tests.
 *
 * @example
 * ```typescript
 * const error = expectErr(result);
 * expect(error).toBeInstanceOf(ValidationError);
 * ```
 */
export const expectErr = <T, E>(result: Result<T, E>): E => {
  expect(result.isErr()).toBe(true);
  return (result as unknown as { error: E }).error;
};

// ---------------------------------------------------------------------------
// Result Match Tokens
// ---------------------------------------------------------------------------

export interface OkResultMatch {
  readonly __resultMatch: 'ok';
  readonly value?: unknown | undefined;
}

export interface ErrResultMatch {
  readonly __resultMatch: 'err';
  readonly error?: unknown | undefined;
}

type ResultMatchToken = OkResultMatch | ErrResultMatch;

/**
 * Create a partial-match token for `Result.ok(...)` values nested inside
 * arrays or objects, such as the `Result[]` returned by batch `ctx.cross()`.
 */
export const okResultMatch = (value?: unknown): OkResultMatch => ({
  __resultMatch: 'ok',
  value,
});

/**
 * Create a partial-match token for `Result.err(...)` values nested inside
 * arrays or objects, such as mixed-success batch `ctx.cross()`.
 */
export const errResultMatch = (error?: unknown): ErrResultMatch => ({
  __resultMatch: 'err',
  error,
});

// ---------------------------------------------------------------------------
// Full Match
// ---------------------------------------------------------------------------

/**
 * Assert that the result is ok and its value deep-equals the expected output.
 */
export const assertFullMatch = (
  result: Result<unknown, Error>,
  expected: unknown
): void => {
  const value = expectOk(result);
  expect(value).toEqual(expected);
};

// ---------------------------------------------------------------------------
// Schema-Only Match
// ---------------------------------------------------------------------------

/**
 * Assert that the result is ok and, if an output schema is provided,
 * the value parses against it.
 */
export const assertSchemaMatch = (
  result: Result<unknown, Error>,
  outputSchema: z.ZodType | undefined
): void => {
  const value = expectOk(result);
  if (outputSchema !== undefined) {
    const parsed = outputSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Output does not match schema: ${formatZodIssues(parsed.error.issues).join('; ')}`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Partial Match
// ---------------------------------------------------------------------------

/** Format a path for error messages. */
const formatLoc = (path: readonly string[]): string =>
  path.length > 0 ? path.join('.') : 'root';

interface ResultLike {
  readonly error?: unknown;
  isErr(): boolean;
  isOk(): boolean;
  readonly value?: unknown;
}

const isResultMatchToken = (value: unknown): value is ResultMatchToken =>
  typeof value === 'object' &&
  value !== null &&
  '__resultMatch' in value &&
  ((value as Record<string, unknown>)['__resultMatch'] === 'ok' ||
    (value as Record<string, unknown>)['__resultMatch'] === 'err');

const isResultLike = (value: unknown): value is ResultLike =>
  typeof value === 'object' &&
  value !== null &&
  'isOk' in value &&
  typeof (value as Record<string, unknown>)['isOk'] === 'function' &&
  'isErr' in value &&
  typeof (value as Record<string, unknown>)['isErr'] === 'function';

/** Find an unconsumed actual element that deep-matches the expected object. */
const findObjectMatch = (
  actual: unknown[],
  elem: object,
  consumed: ReadonlySet<number>,
  path: readonly string[],
  index: number
): number =>
  actual.findIndex((a, idx) => {
    if (consumed.has(idx)) {
      return false;
    }
    try {
      // oxlint-disable-next-line no-use-before-define -- mutual recursion with assertSubset
      assertSubset(a, elem, [...path, `[${String(index)}]`]);
      return true;
    } catch {
      return false;
    }
  });

/**
 * Assert that every element in `expected` exists in `actual` (order-independent).
 *
 * Tracks consumed indices so that duplicate expected elements each require a
 * distinct actual element — `['a', 'a']` does not match `['a']`.
 */
const assertArraySubset = (
  actual: unknown[],
  expected: unknown[],
  path: readonly string[],
  loc: string
): void => {
  const consumed = new Set<number>();
  for (let i = 0; i < expected.length; i += 1) {
    const elem = expected[i];
    const matchIndex =
      typeof elem === 'object' && elem !== null
        ? findObjectMatch(actual, elem, consumed, path, i)
        : actual.findIndex((a, idx) => !consumed.has(idx) && a === elem);

    if (matchIndex === -1) {
      throw new Error(
        `at ${loc}[${String(i)}]: expected array to contain ${JSON.stringify(elem)}`
      );
    }
    consumed.add(matchIndex);
  }
};

/** Assert that every key in `expected` exists in `actual` with a matching value. */
const assertObjectSubset = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  path: readonly string[]
): void => {
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) {
      throw new Error(
        `at ${[...path, key].join('.')}: key not found in actual`
      );
    }
    // oxlint-disable-next-line no-use-before-define -- mutual recursion with assertSubset
    assertSubset(actual[key], expected[key], [...path, key]);
  }
};

/**
 * Recursively assert that `actual` is a superset of `expected`.
 *
 * - **Scalars:** strict equality.
 * - **Objects:** every key in `expected` must exist in `actual` with a matching
 *   value. Extra keys in `actual` are ignored.
 * - **Arrays:** every element in `expected` must exist in `actual`
 *   (order-independent subset check).
 * - **Nested objects:** recursive subset matching.
 */
// oxlint-disable-next-line max-statements -- recursive dispatch across four type branches
const assertSubset = (
  actual: unknown,
  expected: unknown,
  path: readonly string[]
): void => {
  const loc = formatLoc(path);

  if (expected === null || expected === undefined) {
    if (actual !== expected) {
      throw new Error(
        `at ${loc}: expected ${String(expected)}, got ${String(actual)}`
      );
    }
    return;
  }

  if (isResultMatchToken(expected)) {
    // oxlint-disable-next-line no-use-before-define -- result token matching delegates back into assertSubset
    assertResultTokenMatch(actual, expected, path);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      throw new TypeError(`at ${loc}: expected an array, got ${typeof actual}`);
    }
    assertArraySubset(actual, expected, path, loc);
    return;
  }

  if (typeof expected === 'object') {
    if (
      typeof actual !== 'object' ||
      actual === null ||
      Array.isArray(actual)
    ) {
      throw new Error(`at ${loc}: expected an object, got ${typeof actual}`);
    }
    assertObjectSubset(
      actual as Record<string, unknown>,
      expected as Record<string, unknown>,
      path
    );
    return;
  }

  if (actual !== expected) {
    throw new Error(
      `at ${loc}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
};

const assertOkResultTokenMatch = (
  actual: ResultLike,
  expected: OkResultMatch,
  loc: string,
  path: readonly string[]
): void => {
  if (!actual.isOk()) {
    throw new Error(`at ${loc}: expected Result.ok(...), got Result.err(...)`);
  }
  if (expected.value !== undefined) {
    assertSubset(actual.value, expected.value, [...path, 'value']);
  }
};

const assertErrResultTokenMatch = (
  actual: ResultLike,
  expected: ErrResultMatch,
  loc: string,
  path: readonly string[]
): void => {
  if (!actual.isErr()) {
    throw new Error(`at ${loc}: expected Result.err(...), got Result.ok(...)`);
  }
  if (expected.error !== undefined) {
    assertSubset(actual.error, expected.error, [...path, 'error']);
  }
};

const assertResultTokenMatch = (
  actual: unknown,
  expected: ResultMatchToken,
  path: readonly string[]
): void => {
  const loc = formatLoc(path);
  if (!isResultLike(actual)) {
    throw new TypeError(`at ${loc}: expected a Result-like value`);
  }

  if (expected.__resultMatch === 'ok') {
    assertOkResultTokenMatch(actual, expected, loc, path);
    return;
  }

  assertErrResultTokenMatch(actual, expected, loc, path);
};

/**
 * Assert that the result is ok and its value is a superset of the expected
 * partial output. Declared fields must match; extra fields are ignored.
 */
export const assertPartialMatch = (
  result: Result<unknown, Error>,
  expectedMatch: unknown
): void => {
  const value = expectOk(result);
  assertSubset(value, expectedMatch, []);
};

// ---------------------------------------------------------------------------
// Error Match
// ---------------------------------------------------------------------------

/**
 * Assert that the result is an error of the specified type, with optional
 * message substring matching.
 */
export const assertErrorMatch = (
  result: Result<unknown, Error>,
  expectedError: new (...args: never[]) => Error,
  expectedMessage?: string
): void => {
  const error = expectErr(result);
  expect(error).toBeInstanceOf(expectedError);
  if (expectedMessage !== undefined) {
    expect(error.message).toContain(expectedMessage);
  }
};
