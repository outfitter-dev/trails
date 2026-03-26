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
