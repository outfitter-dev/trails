/**
 * testExamples — the headline one-liner.
 *
 * Iterates every trail in the app's topo. For each trail with examples,
 * generates describe/test blocks using bun:test. Progressive assertion
 * determines which check to run per example. For hikes with `follows`
 * declarations, checks that every declared follow was called at least once.
 */

import { describe, expect, test } from 'bun:test';

import type {
  AnyHike,
  FollowFn,
  Topo,
  TrailExample,
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
  Result,
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
};

// ---------------------------------------------------------------------------
// Follows coverage for hikes
// ---------------------------------------------------------------------------

/**
 * Build a recording follow function that tracks which trail IDs are called.
 *
 * Delegates to `baseFollow` when available, otherwise looks up the trail
 * in the topo and executes it with validated input. Falls back to
 * `Result.ok()` when neither is available.
 */
const createCoverageFollow = (
  called: Set<string>,
  baseFollow: FollowFn | undefined,
  topo: Topo,
  ctx: TrailContext
): FollowFn => {
  const follow = (id: string, input: unknown) => {
    called.add(id);

    if (baseFollow !== undefined) {
      return baseFollow(id, input);
    }

    const trailDef = topo.get(id);
    if (trailDef !== undefined) {
      const validated = validateInput(trailDef.input, input);
      if (validated.isErr()) {
        return Promise.resolve(validated);
      }
      return Promise.resolve(trailDef.implementation(validated.value, ctx));
    }

    return Promise.resolve(Result.ok());
  };
  return follow as FollowFn;
};

/**
 * Run a single example against a hike, recording follow calls.
 */
const runHikeExample = async (
  hikeDef: AnyHike,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  baseCtx: TrailContext,
  called: Set<string>,
  topo: Topo
): Promise<void> => {
  const validated = validateInput(hikeDef.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }
  const validatedInput = expectOk(validated);

  const follow = createCoverageFollow(called, baseCtx.follow, topo, baseCtx);
  const testCtx: TrailContext = { ...baseCtx, follow };

  const result = await hikeDef.implementation(validatedInput, testCtx);
  assertProgressiveMatch(result, example, output);
};

// ---------------------------------------------------------------------------
// Hike entry with examples pre-validated
// ---------------------------------------------------------------------------

interface HikeWithExamples {
  readonly hikeDef: AnyHike;
  readonly hikeId: string;
  readonly examples: readonly TrailExample<unknown, unknown>[];
}

const collectHikesWithExamples = (app: Topo): readonly HikeWithExamples[] =>
  [...app.hikes]
    .filter(([, h]) => h.examples !== undefined && h.examples.length > 0)
    .map(([hikeId, hikeDef]) => ({
      examples: hikeDef.examples as readonly TrailExample<unknown, unknown>[],
      hikeDef,
      hikeId,
    }));

// ---------------------------------------------------------------------------
// Hike example describe blocks
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for hikes with follows coverage.
 *
 * Always uses a recording follow so that follows coverage can be checked.
 * Hikes without `follows` still run their examples but skip the coverage test.
 */
const describeHikeExamples = (
  hikesWithExamples: readonly HikeWithExamples[],
  resolveCtx: () => Partial<TrailContext> | undefined,
  topo: Topo
): void => {
  if (hikesWithExamples.length === 0) {
    return;
  }

  describe.each([...hikesWithExamples])('$hikeId', ({ hikeDef, examples }) => {
    const called = new Set<string>();

    test.each([...examples])(
      'example: $name',
      async (example: TrailExample<unknown, unknown>) => {
        const baseCtx = mergeTestContext(resolveCtx());
        await runHikeExample(
          hikeDef,
          example,
          hikeDef.output,
          baseCtx,
          called,
          topo
        );
      }
    );

    if (hikeDef.follows.length > 0) {
      test('follows coverage', () => {
        const uncovered = hikeDef.follows.filter((id) => !called.has(id));
        expect(uncovered).toEqual([]);
      });
    }
  });
};

// ---------------------------------------------------------------------------
// testExamples
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for every trail example in the app.
 *
 * For hikes with `follows` declarations and examples, also verifies that
 * every declared follow ID was called at least once across all examples.
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

  describeHikeExamples(collectHikesWithExamples(app), resolveCtx, app);
};
