/**
 * testExamples — the headline one-liner.
 *
 * Iterates every trail in the app's topo. For each trail with examples,
 * generates describe/test blocks using bun:test. Progressive assertion
 * determines which check to run per example. For trails with `follow`
 * declarations, checks that every declared follow was called at least once.
 */

import { describe, expect, test } from 'bun:test';

import type {
  FollowFn,
  ServiceOverrideMap,
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
  executeTrail,
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
} from './assertions.js';
import {
  mergeServiceOverrides,
  mergeTestContext,
  normalizeTestExecutionOptions,
  resolveMockServices,
} from './context.js';
import type { TestExecutionOptions } from './context.js';

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
  testCtx: TrailContext,
  services?: ServiceOverrideMap
): Promise<void> => {
  const validated = validateInput(t.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }

  const result = await executeTrail(t, example.input, {
    ctx: testCtx,
    services,
  });
  assertProgressiveMatch(result, example, output);
};

// ---------------------------------------------------------------------------
// Follow coverage for composition trails
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
  ctx: TrailContext,
  services?: ServiceOverrideMap
): FollowFn => {
  const follow = (id: string, input: unknown) => {
    called.add(id);

    if (baseFollow !== undefined) {
      return baseFollow(id, input);
    }

    const trailDef = topo.get(id);
    if (trailDef !== undefined) {
      return executeTrail(trailDef, input, {
        ctx: { ...ctx, follow },
        services,
      });
    }

    return Promise.resolve(Result.ok());
  };
  return follow as FollowFn;
};

/**
 * Run a single example against a composition trail, recording follow calls.
 */
const runCompositionExample = async (
  trailDef: Trail<unknown, unknown>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  baseCtx: TrailContext,
  called: Set<string>,
  topo: Topo,
  services?: ServiceOverrideMap
): Promise<void> => {
  const validated = validateInput(trailDef.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }

  const follow = createCoverageFollow(
    called,
    baseCtx.follow,
    topo,
    baseCtx,
    services
  );
  const testCtx: TrailContext = { ...baseCtx, follow };

  const result = await executeTrail(trailDef, example.input, {
    ctx: testCtx,
    services,
  });
  assertProgressiveMatch(result, example, output);
};

// ---------------------------------------------------------------------------
// testExamples
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for every trail example in the app.
 *
 * For trails with `follow` declarations and examples, also verifies that
 * every declared follow ID was called at least once across all examples.
 *
 * One line in your test file:
 * ```ts
 * testExamples(app);
 * ```
 */
export const testExamples = (
  app: Topo,
  ctxOrFactory?:
    | Partial<TrailContext>
    | TestExecutionOptions
    | (() => Partial<TrailContext> | TestExecutionOptions)
): void => {
  const resolveInput =
    typeof ctxOrFactory === 'function' ? ctxOrFactory : () => ctxOrFactory;
  const allTrails = app.list() as Trail<unknown, unknown>[];

  const withExamples = allTrails.filter(
    (t) => t.examples !== undefined && t.examples.length > 0
  );
  const simpleTrails = withExamples.filter((t) => t.follow.length === 0);
  const compositionTrails = withExamples.filter((t) => t.follow.length > 0);

  // Simple trails: run examples directly
  if (simpleTrails.length > 0) {
    describe.each(simpleTrails)('$id', (t) => {
      const { examples, output } = t;
      if (!examples) {
        return;
      }

      test.each([...examples])(
        'example: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const services = mergeServiceOverrides(
            await resolveMockServices(app),
            resolved.ctx,
            resolved.services
          );
          const testCtx = mergeTestContext(resolved.ctx);
          await runExample(t, example, output, testCtx, services);
        }
      );
    });
  }

  // Composition trails: use recording follow and check coverage
  if (compositionTrails.length > 0) {
    describe.each(compositionTrails)('$id', (t) => {
      const { examples, output } = t;
      if (!examples) {
        return;
      }

      const called = new Set<string>();

      test.each([...examples])(
        'example: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const services = mergeServiceOverrides(
            await resolveMockServices(app),
            resolved.ctx,
            resolved.services
          );
          const baseCtx = mergeTestContext(resolved.ctx);
          await runCompositionExample(
            t,
            example,
            output,
            baseCtx,
            called,
            app,
            services
          );
        }
      );

      test('follow coverage', () => {
        const uncovered = t.follow.filter((id) => !called.has(id));
        expect(uncovered).toEqual([]);
      });
    });
  }
};
