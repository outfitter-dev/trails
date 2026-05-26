/**
 * testExamples — the headline one-liner.
 *
 * Iterates every trail in the app's topo. For each trail with examples,
 * generates describe/test blocks using bun:test. Progressive assertion
 * determines which check to run per example. For trails with `composes`
 * declarations, checks that every declared composing was called at least once.
 */

import { describe, expect, test } from 'bun:test';

import type {
  ComposeFn,
  ComposeOptions,
  ExecuteTrailOptions,
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
  buildComposeValidationSchema,
  CancelledError,
  ConflictError,
  DerivationError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  PermitError,
  RateLimitError,
  RetryExhaustedError,
  executeTrail,
  parseTrailIdVersionReference,
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
  defaultCreatePermit,
  mergeResourceOverrides,
  mergeTestContext,
  normalizeTestExecutionOptions,
  createMockResources,
} from './context.js';
import type { PermittedTrail, TestExecutionOptions } from './context.js';
import {
  deriveTrailExampleTargets,
  isDerivedExample,
} from './effective-examples.js';
import type { TrailExampleTarget } from './effective-examples.js';
import { withSignalAssertions } from './signals.js';

type TestingExecuteTrailOptions = ExecuteTrailOptions & {
  readonly validationSchema?: ReturnType<typeof buildComposeValidationSchema>;
};

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
  DerivationError: DerivationError as new (...args: never[]) => Error,
  InternalError: InternalError as new (...args: never[]) => Error,
  NetworkError: NetworkError as new (...args: never[]) => Error,
  NotFoundError: NotFoundError as new (...args: never[]) => Error,
  PermissionError: PermissionError as new (...args: never[]) => Error,
  PermitError: PermitError as new (...args: never[]) => Error,
  RateLimitError: RateLimitError as new (...args: never[]) => Error,
  RetryExhaustedError: RetryExhaustedError as unknown as new (
    ...args: never[]
  ) => Error,
  TimeoutError: TimeoutError as new (...args: never[]) => Error,
  TrailsError: TrailsError as unknown as new (...args: never[]) => Error,
  ValidationError: ValidationError as new (...args: never[]) => Error,
};

/**
 * Resolve an error class name string to the actual constructor.
 * Falls back to generic Error if the name is not in the core taxonomy.
 */
const resolveErrorClass = (name: string): new (...args: never[]) => Error =>
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
 * Apply auto-permit: if the trail declares scoped permits and the context
 * doesn't already have a permit, create one and merge it into the context.
 */
const applyAutoPermit = (
  ctx: TrailContext,
  trailDef: PermittedTrail,
  opts: TestExecutionOptions
): TrailContext => {
  if (opts.strictPermits) {
    return ctx;
  }
  if (ctx.permit !== undefined) {
    return ctx;
  }
  const create = opts.createPermit ?? defaultCreatePermit;
  const permit = create(trailDef);
  if (!permit) {
    return ctx;
  }
  return { ...ctx, permit };
};

const runTargetExample = async (
  target: TrailExampleTarget,
  example: TrailExample<unknown, unknown>,
  testCtx: TrailContext,
  resources?: ResourceOverrideMap,
  opts?: TestExecutionOptions
): Promise<void> => {
  const { output, trail: t } = target;
  const ctx = opts ? applyAutoPermit(testCtx, t, opts) : testCtx;
  const signals = withSignalAssertions(ctx, example);
  const validated = validateInput(target.input, example.input);

  if (handleValidationError(validated, example)) {
    signals.assert();
    return;
  }

  const result = await executeTrail(t, example.input, {
    ctx: signals.ctx,
    resources: resources ?? opts?.resources,
    ...(target.version === undefined ? {} : { version: target.version }),
  });
  assertProgressiveMatch(result, example, output);
  signals.assert();
};

/**
 * Run a single example against a trail.
 * Handles validation, execution, and assertions.
 */
export const runExample = async (
  t: Trail<unknown, unknown, unknown>,
  example: TrailExample<unknown, unknown>,
  output: z.ZodType | undefined,
  testCtx: TrailContext,
  resources?: ResourceOverrideMap,
  opts?: TestExecutionOptions
): Promise<void> => {
  await runTargetExample(
    {
      composes: t.composes,
      current: true,
      examples: [example],
      id: t.id,
      input: t.input,
      output,
      trail: t,
    },
    example,
    testCtx,
    resources,
    opts
  );
};

// ---------------------------------------------------------------------------
// Composing coverage for trails with compositions
// ---------------------------------------------------------------------------

/**
 * Build a recording compose function that tracks which trail IDs are called.
 *
 * Delegates to `baseCompose` when available, otherwise looks up the trail
 * in the topo and executes it with validated input. Falls back to
 * `Result.ok()` when neither is available.
 */
const createCoverageCompose = (
  called: Set<string>,
  baseCompose: ComposeFn | undefined,
  topo: Topo,
  ctx: TrailContext,
  resources?: ResourceOverrideMap
): ComposeFn => {
  const invokeCompose = async (
    idOrTrail: string | { readonly id: string },
    input: unknown,
    self: ComposeFn,
    composeOptions?: ComposeOptions | undefined
  ) => {
    const parsed =
      typeof idOrTrail === 'string'
        ? parseTrailIdVersionReference(idOrTrail)
        : Result.ok({ id: idOrTrail.id });
    if (parsed.isErr()) {
      return parsed;
    }
    const parsedVersion =
      'version' in parsed.value ? parsed.value.version : undefined;
    if (parsedVersion !== undefined && composeOptions?.version !== undefined) {
      return Result.err(
        new ValidationError(
          `Trail "${parsed.value.id}" version was provided both in the id reference and ctx.compose() options`
        )
      );
    }

    const { id } = parsed.value;
    called.add(id);
    const version = composeOptions?.version ?? parsedVersion;

    if (baseCompose !== undefined) {
      const forwardedOptions =
        parsedVersion === undefined
          ? composeOptions
          : { ...composeOptions, version: parsedVersion };
      return await baseCompose(id, input, forwardedOptions);
    }

    const trailDef = topo.get(id);
    if (trailDef !== undefined) {
      const options: TestingExecuteTrailOptions = {
        ctx: { ...ctx, compose: self },
        resources,
        ...(version === undefined ? {} : { version }),
        validationSchema: buildComposeValidationSchema(trailDef),
      };
      return await executeTrail(trailDef, input, options);
    }

    return Result.ok();
  };

  // Accepts either a trail object (typed compose), a string id (untyped),
  // or a batch of `[target, input]` tuples.
  const compose = async function compose(
    idOrTrail:
      | string
      | { readonly id: string }
      | readonly (readonly [string | { readonly id: string }, unknown])[],
    inputOrOptions?: unknown,
    singleOptions?: ComposeOptions
  ) {
    if (Array.isArray(idOrTrail)) {
      return await Promise.all(
        idOrTrail.map(([target, batchInput]) =>
          invokeCompose(target, batchInput, compose as ComposeFn)
        )
      );
    }

    return await invokeCompose(
      idOrTrail as string | { readonly id: string },
      inputOrOptions,
      compose as ComposeFn,
      singleOptions
    );
  } as ComposeFn;

  return compose;
};

/**
 * Run a single example against a trail with compositions, recording compose calls.
 */
const runCompositionExample = async (
  target: TrailExampleTarget,
  example: TrailExample<unknown, unknown>,
  baseCtx: TrailContext,
  called: Set<string>,
  topo: Topo,
  resources?: ResourceOverrideMap,
  opts?: TestExecutionOptions
): Promise<void> => {
  const { output, trail: trailDef } = target;
  const permittedCtx = opts
    ? applyAutoPermit(baseCtx, trailDef, opts)
    : baseCtx;
  const signals = withSignalAssertions(permittedCtx, example);
  const validated = validateInput(target.input, example.input);

  if (handleValidationError(validated, example)) {
    signals.assert();
    return;
  }

  const compose = createCoverageCompose(
    called,
    signals.ctx.compose,
    topo,
    signals.ctx,
    resources
  );
  const testCtx: TrailContext = { ...signals.ctx, compose };

  // Top-level trail validates against trail.input (not merged composeInput).
  // Merged validation only applies to compose targets in executeFromMap/createCoverageCompose.
  const result = await executeTrail(trailDef, example.input, {
    ctx: testCtx,
    resources: resources ?? opts?.resources,
    ...(target.version === undefined ? {} : { version: target.version }),
  });
  assertProgressiveMatch(result, example, output);
  signals.assert();
};

// ---------------------------------------------------------------------------
// testExamples
// ---------------------------------------------------------------------------

/**
 * Generate describe/test blocks for every trail example in the app.
 *
 * For trails with `composes` declarations and examples, also verifies that
 * every declared composed ID was called at least once across all examples.
 *
 * One line in your test file:
 * ```ts
 * testExamples(graph);
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
    .flatMap(deriveTrailExampleTargets)
    .filter((target) => target.examples.length > 0);
  const simpleTrails = withExamples.filter((t) => t.composes.length === 0);
  const compositionTrails = withExamples.filter((t) => t.composes.length > 0);

  // Simple trails: run examples directly
  if (simpleTrails.length > 0) {
    describe.each(simpleTrails)('$id', (t) => {
      const { examples } = t;
      if (!examples) {
        return;
      }

      test.each([...examples])(
        'example: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const resources = mergeResourceOverrides(
            await createMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const testCtx = mergeTestContext(resolved.ctx);
          await runTargetExample(t, example, testCtx, resources, resolved);
        }
      );
    });
  }

  // Composition trails: use recording compose and check coverage.
  //
  // Composing coverage only runs against AUTHORED examples. Contour-derived
  // fixtures are opportunistic coverage that may not exercise every
  // `ctx.compose()` branch in the trail, so asserting coverage against them
  // would produce false failures for trails whose authored intent was a
  // single path. When a trail has zero authored examples the coverage
  // assertion is skipped entirely — the derived-example runs still
  // execute, but they are not required to cover declared compositions.
  if (compositionTrails.length > 0) {
    describe.each(compositionTrails)('$id', (t) => {
      const { examples } = t;
      if (!examples) {
        return;
      }

      const composedFromAuthored = new Set<string>();
      const hasAuthoredExamples = examples.some(
        (example) => !isDerivedExample(example)
      );

      // Only record compose calls from authored examples. Derived fixtures
      // execute normally but do not contribute to coverage — the sink map
      // puts each example in the right bucket without an inline
      // conditional inside the test body.
      const discardSink = new Set<string>();
      const pickCoverageSink = (
        example: TrailExample<unknown, unknown>
      ): Set<string> =>
        isDerivedExample(example) ? discardSink : composedFromAuthored;

      test.each([...examples])(
        'example: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const resources = mergeResourceOverrides(
            await createMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const baseCtx = mergeTestContext(resolved.ctx);
          await runCompositionExample(
            t,
            example,
            baseCtx,
            pickCoverageSink(example),
            app,
            resources,
            resolved
          );
        }
      );

      if (hasAuthoredExamples) {
        test('composing coverage', () => {
          const uncovered = t.composes.filter(
            (id) => !composedFromAuthored.has(id)
          );
          expect(uncovered).toEqual([]);
        });
      }
    });
  }
};
