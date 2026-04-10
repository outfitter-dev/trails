/**
 * testExamples — the headline one-liner.
 *
 * Iterates every trail in the app's topo. For each trail with examples,
 * generates describe/test blocks using bun:test. Progressive assertion
 * determines which check to run per example. For trails with `crosses`
 * declarations, checks that every declared crossing was called at least once.
 */

import { describe, expect, test } from 'bun:test';

import type {
  CrossFn,
  ResourceOverrideMap,
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
  buildCrossValidationSchema,
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
  assertPartialMatch,
  assertSchemaMatch,
} from './assertions.js';
import {
  defaultMintPermit,
  mergeResourceOverrides,
  mergeTestContext,
  normalizeTestExecutionOptions,
  resolveMockResources,
} from './context.js';
import type { MintableTrail, TestExecutionOptions } from './context.js';
import { resolveTrailExamples } from './effective-examples.js';

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
    return assertFullMatch(result, example.expected);
  }
  if (example.expectedMatch !== undefined) {
    return assertPartialMatch(result, example.expectedMatch);
  }
  if (example.error !== undefined) {
    return assertErrorMatch(result, resolveErrorClass(example.error));
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
 * Apply auto-minting: if the trail declares scoped permits and the context
 * doesn't already have a permit, mint one and merge it into the context.
 */
const applyAutoMint = (
  ctx: TrailContext,
  trailDef: MintableTrail,
  opts: TestExecutionOptions
): TrailContext => {
  if (opts.strictPermits) {
    return ctx;
  }
  if (ctx.permit !== undefined) {
    return ctx;
  }
  const mint = opts.mintPermit ?? defaultMintPermit;
  const permit = mint(trailDef);
  if (!permit) {
    return ctx;
  }
  return { ...ctx, permit };
};

/**
 * Run a single example against a trail.
 * Handles validation, execution, and assertions.
 */
const runExample = async (
  t: Trail<unknown, unknown, unknown>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  testCtx: TrailContext,
  resources?: ResourceOverrideMap,
  opts?: TestExecutionOptions
): Promise<void> => {
  const validated = validateInput(t.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }

  const ctx = opts ? applyAutoMint(testCtx, t, opts) : testCtx;

  const result = await executeTrail(t, example.input, {
    ctx,
    resources: resources ?? opts?.resources,
  });
  assertProgressiveMatch(result, example, output);
};

// ---------------------------------------------------------------------------
// Crossing coverage for trails with crossings
// ---------------------------------------------------------------------------

/**
 * Build a recording cross function that tracks which trail IDs are called.
 *
 * Delegates to `baseCross` when available, otherwise looks up the trail
 * in the topo and executes it with validated input. Falls back to
 * `Result.ok()` when neither is available.
 */
const createCoverageCross = (
  called: Set<string>,
  baseCross: CrossFn | undefined,
  topo: Topo,
  ctx: TrailContext,
  resources?: ResourceOverrideMap
): CrossFn => {
  const invokeCross = async (
    idOrTrail: string | { readonly id: string },
    input: unknown,
    self: CrossFn
  ) => {
    const id = typeof idOrTrail === 'string' ? idOrTrail : idOrTrail.id;
    called.add(id);

    if (baseCross !== undefined) {
      return await baseCross(id, input);
    }

    const trailDef = topo.get(id);
    if (trailDef !== undefined) {
      return await executeTrail(trailDef, input, {
        ctx: { ...ctx, cross: self },
        resources,
        validationSchema: buildCrossValidationSchema(trailDef),
      });
    }

    return Result.ok();
  };

  // Accepts either a trail object (typed cross), a string id (untyped),
  // or a batch of `[target, input]` tuples.
  const cross = async function cross(
    idOrTrail:
      | string
      | { readonly id: string }
      | readonly (readonly [string | { readonly id: string }, unknown])[],
    input?: unknown
  ) {
    if (Array.isArray(idOrTrail)) {
      return await Promise.all(
        idOrTrail.map(([target, batchInput]) =>
          invokeCross(target, batchInput, cross as CrossFn)
        )
      );
    }

    return await invokeCross(
      idOrTrail as string | { readonly id: string },
      input,
      cross as CrossFn
    );
  } as CrossFn;

  return cross;
};

/**
 * Run a single example against a trail with crossings, recording cross calls.
 */
const runCompositionExample = async (
  trailDef: Trail<unknown, unknown, unknown>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  baseCtx: TrailContext,
  called: Set<string>,
  topo: Topo,
  resources?: ResourceOverrideMap,
  opts?: TestExecutionOptions
): Promise<void> => {
  const validated = validateInput(trailDef.input, example.input);

  if (handleValidationError(validated, example)) {
    return;
  }

  const mintedCtx = opts ? applyAutoMint(baseCtx, trailDef, opts) : baseCtx;
  const cross = createCoverageCross(
    called,
    mintedCtx.cross,
    topo,
    mintedCtx,
    resources
  );
  const testCtx: TrailContext = { ...mintedCtx, cross };

  // Top-level trail validates against trail.input (not merged crossInput).
  // Merged validation only applies to cross targets in executeFromMap/createCoverageCross.
  const result = await executeTrail(trailDef, example.input, {
    ctx: testCtx,
    resources: resources ?? opts?.resources,
  });
  assertProgressiveMatch(result, example, output);
};

// ---------------------------------------------------------------------------
// testExamples
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for every trail example in the app.
 *
 * For trails with `crosses` declarations and examples, also verifies that
 * every declared crossed ID was called at least once across all examples.
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
  const withExamples = (app.list() as Trail<unknown, unknown, unknown>[])
    .map((trailDef) => ({
      ...trailDef,
      examples: resolveTrailExamples(trailDef),
    }))
    .filter((trailDef) => trailDef.examples.length > 0);
  const simpleTrails = withExamples.filter((t) => t.crosses.length === 0);
  const compositionTrails = withExamples.filter((t) => t.crosses.length > 0);

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
          const resources = mergeResourceOverrides(
            await resolveMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const testCtx = mergeTestContext(resolved.ctx);
          await runExample(t, example, output, testCtx, resources, resolved);
        }
      );
    });
  }

  // Composition trails: use recording cross and check coverage
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
          const resources = mergeResourceOverrides(
            await resolveMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const baseCtx = mergeTestContext(resolved.ctx);
          await runCompositionExample(
            t,
            example,
            output,
            baseCtx,
            called,
            app,
            resources,
            resolved
          );
        }
      );

      test('crossing coverage', () => {
        const uncovered = t.crosses.filter((id) => !called.has(id));
        expect(uncovered).toEqual([]);
      });
    });
  }
};
