/**
 * Multi-step scenario runner for composition testing.
 *
 * Scenarios express multi-trail flows as structured data — arrays of steps
 * with compose-step references via `ref()`. Each step invokes a trail through
 * the normal execution pipeline (validation, layers, implementation, Result).
 */

import { describe, test } from 'bun:test';

import type {
  AnyTrail,
  ComposeBatchOptions,
  ComposeFn,
  ExecuteTrailOptions,
  ResourceOverrideMap,
  Result,
  Topo,
} from '@ontrails/core';
import {
  buildComposeValidationSchema,
  claimNextComposeBatchIndex,
  createComposeBatchValidationResults,
  executeTrail,
  InternalError,
  normalizeComposeBatchConcurrency,
  Result as R,
} from '@ontrails/core';

import { assertPartialMatch, expectOk } from './assertions.js';
import { createTestContext, createMockResources } from './context.js';
import type { RefToken, ScenarioStep } from './types.js';

type ScenarioComposeTarget = string | { readonly id: string };
type ScenarioComposeCall = readonly [ScenarioComposeTarget, unknown];
type TestingExecuteTrailOptions = ExecuteTrailOptions & {
  readonly validationSchema?: ReturnType<typeof buildComposeValidationSchema>;
};

// ---------------------------------------------------------------------------
// ref() — compose-step reference marker
// ---------------------------------------------------------------------------

/**
 * Create a reference marker for compose-step data in scenario inputs.
 *
 * `ref('create.id')` resolves to the `id` field of the step aliased as
 * `create`. Dot-paths are supported for nested access.
 *
 * @example
 * ```typescript
 * scenario('Fork flow', app, [
 *   { compose: createGist, input: { name: 'Hello' }, as: 'original' },
 *   { compose: forkGist, input: { id: ref('original.id') } },
 * ]);
 * ```
 */
export const ref = (path: string): RefToken => ({ __ref: true, path });

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Type guard for RefToken. */
const isRef = (value: unknown): value is RefToken =>
  typeof value === 'object' &&
  value !== null &&
  '__ref' in value &&
  (value as Record<string, unknown>)['__ref'] === true &&
  'path' in value;

/**
 * Resolve a dot-path against the outputs map.
 *
 * `ref('create.id')` splits into step name `create` and field path `id`.
 * The first segment is the step alias; remaining segments are property lookups.
 */
/**
 * Walk remaining segments of a dot-path, drilling into the step output.
 */
const drillPath = (
  path: string,
  segments: readonly string[],
  start: unknown
): unknown => {
  let current: unknown = start;
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) {
      break;
    }
    if (typeof current !== 'object' || current === null) {
      throw new Error(
        `ref('${path}'): cannot access '${segment}' on ${typeof current}`
      );
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const resolvePath = (path: string, outputs: Map<string, unknown>): unknown => {
  const segments = path.split('.');
  const [stepName] = segments;
  if (stepName === undefined) {
    throw new Error(`ref(): empty path`);
  }

  const stepOutput = outputs.get(stepName);
  if (stepOutput === undefined) {
    throw new Error(
      `ref('${path}'): no step output found for alias '${stepName}'`
    );
  }

  return drillPath(path, segments, stepOutput);
};

/**
 * Recursively walk a value, replacing RefToken instances with resolved values.
 */
export const deriveRefs = (
  value: unknown,
  outputs: Map<string, unknown>
): unknown => {
  if (isRef(value)) {
    return resolvePath(value.path, outputs);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deriveRefs(item, outputs));
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deriveRefs(val, outputs);
    }
    return result;
  }

  return value;
};

// ---------------------------------------------------------------------------
// scenario() — the public API
// ---------------------------------------------------------------------------

/**
 * Define a multi-step scenario test for composition flows.
 *
 * Each step invokes a trail through the normal execution pipeline.
 * Steps can reference prior step outputs via `ref()`. If any step
 * fails, the scenario stops and reports which step failed.
 *
 * @example
 * ```typescript
 * scenario('Create and show', app, [
 *   { compose: createItem, input: { name: 'Test' }, as: 'created' },
 *   { compose: showItem, input: { id: ref('created.id') },
 *     expectedMatch: { found: true } },
 * ]);
 * ```
 */
/** Assert the result of a step against its expectations and record output. */
const assertStepExpectations = async (
  step: ScenarioStep,
  result: Result<unknown, Error>,
  outputs: Map<string, unknown>
): Promise<void> => {
  const value = expectOk(result);
  if (step.expected !== undefined) {
    const { expect } = await import('bun:test');
    expect(value).toEqual(deriveRefs(step.expected, outputs));
  } else if (step.expectedMatch !== undefined) {
    assertPartialMatch(result, deriveRefs(step.expectedMatch, outputs));
  }
  if (step.as !== undefined) {
    outputs.set(step.as, value);
  }
};

const executeUnlimitedComposeBatch = async (
  calls: readonly ScenarioComposeCall[],
  runCall: (
    call: ScenarioComposeCall,
    branchIndex: number
  ) => Promise<Result<unknown, Error>>
): Promise<Result<unknown, Error>[]> =>
  await Promise.all(
    calls.map((call, branchIndex) => runCall(call, branchIndex))
  );

const executeLimitedComposeBatch = async (
  calls: readonly ScenarioComposeCall[],
  runCall: (
    call: ScenarioComposeCall,
    branchIndex: number
  ) => Promise<Result<unknown, Error>>,
  limit: number
): Promise<Result<unknown, Error>[]> => {
  const results = Array.from<Result<unknown, Error>>({ length: calls.length });
  const nextIndex = { value: 0 };

  const runWorker = async () => {
    while (true) {
      const branchIndex = claimNextComposeBatchIndex(nextIndex, calls);
      if (branchIndex === undefined) {
        return;
      }

      const call = calls[branchIndex];
      if (call === undefined) {
        // Defensive: `claimNextComposeBatchIndex` only returns indices within
        // bounds, so this slot should always be populated. If it ever isn't,
        // surface a clear InternalError in place of the missing slot and keep
        // the worker loop running so sibling branches still get processed.
        results[branchIndex] = R.err(
          new InternalError(
            `unreachable: concurrent compose batch call missing at index ${branchIndex}`
          )
        );
        continue;
      }

      results[branchIndex] = await runCall(call, branchIndex);
    }
  };

  await Promise.all(Array.from({ length: limit }, runWorker));
  return results;
};

/**
 * Build a compose function that resolves trails from the topo and executes
 * them through the standard pipeline. Mirrors the pattern in composes.ts
 * `executeFromMap` but without recording or injection.
 */
const createScenarioCompose = (
  app: Topo,
  resources?: ResourceOverrideMap
): ComposeFn => {
  const invokeCompose = async (
    idOrTrail: ScenarioComposeTarget,
    input: unknown,
    self: ComposeFn
  ) => {
    const id = typeof idOrTrail === 'string' ? idOrTrail : idOrTrail.id;
    const trailDef: AnyTrail | undefined = app.get(id);
    if (trailDef === undefined) {
      return R.err(
        new InternalError(`compose: trail "${id}" not found in topo`)
      );
    }
    const baseCtx = createTestContext();
    const options: TestingExecuteTrailOptions = {
      ctx: { ...baseCtx, compose: self },
      resources,
      topo: app,
      validationSchema: buildComposeValidationSchema(trailDef),
    };
    return await executeTrail(trailDef, input, options);
  };

  const executeComposeBatch = async (
    calls: readonly ScenarioComposeCall[],
    self: ComposeFn,
    options?: ComposeBatchOptions
  ): Promise<Result<unknown, Error>[]> => {
    if (calls.length === 0) {
      return [];
    }

    const concurrency = normalizeComposeBatchConcurrency(options);
    if (concurrency.isErr()) {
      return createComposeBatchValidationResults(calls, concurrency.error);
    }

    const runCall = async (
      [target, batchInput]: ScenarioComposeCall,
      _branchIndex: number
    ) => await invokeCompose(target, batchInput, self);

    const limit = concurrency.value ?? calls.length;
    return limit >= calls.length
      ? await executeUnlimitedComposeBatch(calls, runCall)
      : await executeLimitedComposeBatch(calls, runCall, limit);
  };

  const compose = async function compose(
    idOrTrail: ScenarioComposeTarget | readonly ScenarioComposeCall[],
    inputOrOptions?: unknown
  ) {
    if (Array.isArray(idOrTrail)) {
      return await executeComposeBatch(
        idOrTrail,
        compose as ComposeFn,
        inputOrOptions as ComposeBatchOptions | undefined
      );
    }

    return await invokeCompose(
      idOrTrail as ScenarioComposeTarget,
      inputOrOptions,
      compose as ComposeFn
    );
  } as ComposeFn;

  return compose;
};

/**
 * Execute a single scenario step: run the trail, assert expectations,
 * and record outputs.
 */
const executeStep = async (
  step: ScenarioStep,
  index: number,
  app: Topo,
  outputs: Map<string, unknown>,
  resources?: ResourceOverrideMap
): Promise<void> => {
  if (step.as !== undefined && outputs.has(step.as)) {
    throw new Error(
      `scenario: duplicate step alias "${step.as}" — each alias must be unique`
    );
  }

  const scenarioCompose = createScenarioCompose(app, resources);
  const baseCtx = createTestContext();
  const resolvedInput = deriveRefs(step.input, outputs);
  const result = await executeTrail(step.compose, resolvedInput, {
    ctx: { ...baseCtx, compose: scenarioCompose },
    resources,
    topo: app,
  });

  if (result.isErr()) {
    throw new Error(
      `Step ${String(index + 1)} ("${step.as ?? step.compose.id}") failed: ${result.error.message}`
    );
  }

  await assertStepExpectations(step, result, outputs);
};

/**
 * Execute scenario steps sequentially, resolving mock resources once upfront.
 *
 * Exported for direct use in tests that need to assert on step execution
 * without the describe/test wrapper that `scenario()` provides.
 */
export const executeScenarioSteps = async (
  app: Topo,
  steps: readonly ScenarioStep[]
): Promise<void> => {
  const outputs = new Map<string, unknown>();
  const resources = await createMockResources(app);

  for (const [index, step] of steps.entries()) {
    await executeStep(step, index, app, outputs, resources);
  }
};

export const scenario = (
  name: string,
  app: Topo,
  steps: readonly ScenarioStep[]
): void => {
  describe(name, () => {
    test('executes all steps', async () => {
      await executeScenarioSteps(app, steps);
    });
  });
};
