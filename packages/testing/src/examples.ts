/**
 * testExamples — the headline one-liner.
 *
 * Iterates every trail in the app's topo. For each trail with examples,
 * generates describe/test blocks using bun:test. Progressive assertion
 * determines which check to run per example.
 */

import { describe, expect, test } from 'bun:test';

import type {
  Topo,
  TrailExample,
  Result,
  Trail,
  TrailContext,
} from '@ontrails/core';

import {
  AlreadyExistsError,
  AmbiguousError,
  AssertionError,
  AuthError,
  CancelledError,
  ConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TimeoutError,
  TrailsError,
  ValidationError,
  validateInput,
} from '@ontrails/core';
import type { z } from 'zod';

import {
  assertErrorMatch,
  assertFullMatch,
  assertSchemaMatch,
  expectOk,
} from './assertions.js';
import { mergeTestContext } from './context.js';

// ---------------------------------------------------------------------------
// Error class name -> constructor map
// ---------------------------------------------------------------------------

const ERROR_MAP: Record<string, new (...args: never[]) => Error> = {
  AlreadyExistsError: AlreadyExistsError as new (...args: never[]) => Error,
  AmbiguousError: AmbiguousError as new (...args: never[]) => Error,
  AssertionError: AssertionError as new (...args: never[]) => Error,
  AuthError: AuthError as new (...args: never[]) => Error,
  CancelledError: CancelledError as new (...args: never[]) => Error,
  ConflictError: ConflictError as new (...args: never[]) => Error,
  InternalError: InternalError as new (...args: never[]) => Error,
  NetworkError: NetworkError as new (...args: never[]) => Error,
  NotFoundError: NotFoundError as new (...args: never[]) => Error,
  PermissionError: PermissionError as new (...args: never[]) => Error,
  RateLimitError: RateLimitError as new (...args: never[]) => Error,
  TimeoutError: TimeoutError as new (...args: never[]) => Error,
  TrailsError: TrailsError as unknown as new (...args: never[]) => Error,
  ValidationError: ValidationError as new (...args: never[]) => Error,
};

/**
 * Resolve an error class name string to the actual constructor.
 * Falls back to generic Error if the name is not in the core taxonomy.
 */
const resolveErrorClass = (name: string): (new (...args: never[]) => Error) =>
  ERROR_MAP[name] ?? (Error as new (...args: never[]) => Error);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const assertProgressiveMatch = (
  result: Result<unknown, Error>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined
): void => {
  if (example.expected !== undefined) {
    assertFullMatch(result, example.expected);
    return;
  }

  if (example.error !== undefined) {
    const errorClass = resolveErrorClass(example.error);
    assertErrorMatch(result, errorClass);
    return;
  }

  assertSchemaMatch(result, output);
};

const assertOutputSchema = (
  result: Result<unknown, Error>,
  output: z.ZodType | undefined
): void => {
  if (output === undefined || !result.isOk()) {
    return;
  }
  const parsed = output.safeParse(result.value);
  expect(parsed.success).toBe(true);
};

/**
 * Handle input validation failure for an example.
 * Returns true if the validation error was expected (and assertions passed).
 * Throws if the validation error was unexpected.
 */
const handleValidationError = (
  validated: Result<unknown, Error>,
  example: TrailExample<unknown, unknown>
): boolean => {
  if (!validated.isErr()) {
    return false;
  }

  if (example.error !== undefined) {
    const errorClass = resolveErrorClass(example.error);
    expect(validated.error).toBeInstanceOf(errorClass);
    return true;
  }

  throw new Error(
    `Example "${example.name}" has invalid input: ${validated.error.message}`
  );
};

/**
 * Run a single example against a trail.
 * Handles validation, execution, and assertions.
 */
const runExample = async (
  t: Trail<unknown, unknown>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  testCtx: TrailContext
): Promise<void> => {
  const validated = validateInput(t.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }
  const validatedInput = expectOk(validated);

  const result = await t.implementation(validatedInput, testCtx);
  assertProgressiveMatch(result, example, output);
  assertOutputSchema(result, output);
};

// ---------------------------------------------------------------------------
// testExamples
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for every trail example in the app.
 *
 * One line in your test file:
 * ```ts
 * testExamples(app);
 * ```
 */
export const testExamples = (
  app: Topo,
  ctxOrFactory?: Partial<TrailContext> | (() => Partial<TrailContext>)
): void => {
  const resolveCtx =
    typeof ctxOrFactory === 'function' ? ctxOrFactory : () => ctxOrFactory;
  const trailEntries = [...app.trails];

  describe.each(trailEntries)('%s', (_id, trailDef) => {
    const t = trailDef as Trail<unknown, unknown>;
    if (t.examples === undefined || t.examples.length === 0) {
      return;
    }

    const { examples, output } = t;

    test.each([...examples])(
      'example: $name',
      async (example: TrailExample<unknown, unknown>) => {
        const testCtx = mergeTestContext(resolveCtx());
        await runExample(t, example, output, testCtx);
      }
    );
  });
};
