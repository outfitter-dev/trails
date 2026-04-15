/**
 * Multi-step scenario runner for composition testing.
 *
 * Scenarios express multi-trail flows as structured data — arrays of steps
 * with cross-step references via `ref()`. Each step invokes a trail through
 * the normal execution pipeline (validation, layers, blaze, Result).
 */

import { describe, test } from 'bun:test';

import type {
  AnyTrail,
  CrossBatchOptions,
  CrossFn,
  ResourceOverrideMap,
  Result,
  Topo,
} from '@ontrails/core';
import {
  buildCrossValidationSchema,
  executeTrail,
  InternalError,
  Result as R,
} from '@ontrails/core';
import {
  claimNextCrossBatchIndex,
  createCrossBatchValidationResults,
  normalizeCrossBatchConcurrency,
} from '@ontrails/core/internal/cross-batch';

import { assertPartialMatch, expectOk } from './assertions.js';
import { createTestContext, createMockResources } from './context.js';
import type { RefToken, ScenarioStep } from './types.js';

type ScenarioCrossTarget = string | { readonly id: string };
type ScenarioCrossCall = readonly [ScenarioCrossTarget, unknown];

// ---------------------------------------------------------------------------
// ref() — cross-step reference marker
// ---------------------------------------------------------------------------

/**
 * Create a reference marker for cross-step data in scenario inputs.
 *
 * `ref('create.id')` resolves to the `id` field of the step aliased as
 * `create`. Dot-paths are supported for nested access.
 *
 * @example
 * ```typescript
 * scenario('Fork flow', app, [
 *   { cross: createGist, input: { name: 'Hello' }, as: 'original' },
 *   { cross: forkGist, input: { id: ref('original.id') } },
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
export const resolveRefs = (
  value: unknown,
  outputs: Map<string, unknown>
): unknown => {
  if (isRef(value)) {
    return resolvePath(value.path, outputs);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveRefs(item, outputs));
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveRefs(val, outputs);
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
 *   { cross: createItem, input: { name: 'Test' }, as: 'created' },
 *   { cross: showItem, input: { id: ref('created.id') },
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
    expect(value).toEqual(resolveRefs(step.expected, outputs));
  } else if (step.expectedMatch !== undefined) {
    assertPartialMatch(result, resolveRefs(step.expectedMatch, outputs));
  }
  if (step.as !== undefined) {
    outputs.set(step.as, value);
  }
};

const executeUnlimitedCrossBatch = async (
  calls: readonly ScenarioCrossCall[],
  runCall: (
    call: ScenarioCrossCall,
    branchIndex: number
  ) => Promise<Result<unknown, Error>>
): Promise<Result<unknown, Error>[]> =>
  await Promise.all(
    calls.map((call, branchIndex) => runCall(call, branchIndex))
  );

const executeLimitedCrossBatch = async (
  calls: readonly ScenarioCrossCall[],
  runCall: (
    call: ScenarioCrossCall,
    branchIndex: number
  ) => Promise<Result<unknown, Error>>,
  limit: number
): Promise<Result<unknown, Error>[]> => {
  const results = Array.from<Result<unknown, Error>>({ length: calls.length });
  const nextIndex = { value: 0 };

  const runWorker = async () => {
    while (true) {
      const branchIndex = claimNextCrossBatchIndex(nextIndex, calls);
      if (branchIndex === undefined) {
        return;
      }

      const call = calls[branchIndex];
      if (call === undefined) {
        // Defensive: `claimNextCrossBatchIndex` only returns indices within
        // bounds, so this slot should always be populated. If it ever isn't,
        // surface a clear InternalError in place of the missing slot and keep
        // the worker loop running so sibling branches still get processed.
        results[branchIndex] = R.err(
          new InternalError(
            `unreachable: concurrent cross batch call missing at index ${branchIndex}`
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
 * Build a cross function that resolves trails from the topo and executes
 * them through the standard pipeline. Mirrors the pattern in crosses.ts
 * `executeFromMap` but without recording or injection.
 */
const createScenarioCross = (
  app: Topo,
  resources?: ResourceOverrideMap
): CrossFn => {
  const invokeCross = async (
    idOrTrail: ScenarioCrossTarget,
    input: unknown,
    self: CrossFn
  ) => {
    const id = typeof idOrTrail === 'string' ? idOrTrail : idOrTrail.id;
    const trailDef: AnyTrail | undefined = app.get(id);
    if (trailDef === undefined) {
      return R.err(new InternalError(`cross: trail "${id}" not found in topo`));
    }
    const baseCtx = createTestContext();
    return await executeTrail(trailDef, input, {
      ctx: { ...baseCtx, cross: self },
      resources,
      topo: app,
      validationSchema: buildCrossValidationSchema(trailDef),
    });
  };

  const executeCrossBatch = async (
    calls: readonly ScenarioCrossCall[],
    self: CrossFn,
    options?: CrossBatchOptions
  ): Promise<Result<unknown, Error>[]> => {
    if (calls.length === 0) {
      return [];
    }

    const concurrency = normalizeCrossBatchConcurrency(options);
    if (concurrency.isErr()) {
      return createCrossBatchValidationResults(calls, concurrency.error);
    }

    const runCall = async (
      [target, batchInput]: ScenarioCrossCall,
      _branchIndex: number
    ) => await invokeCross(target, batchInput, self);

    const limit = concurrency.value ?? calls.length;
    return limit >= calls.length
      ? await executeUnlimitedCrossBatch(calls, runCall)
      : await executeLimitedCrossBatch(calls, runCall, limit);
  };

  const cross = async function cross(
    idOrTrail: ScenarioCrossTarget | readonly ScenarioCrossCall[],
    inputOrOptions?: unknown
  ) {
    if (Array.isArray(idOrTrail)) {
      return await executeCrossBatch(
        idOrTrail,
        cross as CrossFn,
        inputOrOptions as CrossBatchOptions | undefined
      );
    }

    return await invokeCross(
      idOrTrail as ScenarioCrossTarget,
      inputOrOptions,
      cross as CrossFn
    );
  } as CrossFn;

  return cross;
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

  const scenarioCross = createScenarioCross(app, resources);
  const baseCtx = createTestContext();
  const resolvedInput = resolveRefs(step.input, outputs);
  const result = await executeTrail(step.cross, resolvedInput, {
    ctx: { ...baseCtx, cross: scenarioCross },
    resources,
    topo: app,
  });

  if (result.isErr()) {
    throw new Error(
      `Step ${String(index + 1)} ("${step.as ?? step.cross.id}") failed: ${result.error.message}`
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
