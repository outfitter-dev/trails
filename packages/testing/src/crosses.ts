/**
 * testCrosses — crossing-aware scenario testing for trails with crossings.
 *
 * Tests the crossing graph: which trails were crossed, in what order,
 * and supports failure injection from crossed trail examples.
 */

import { describe, expect, test } from 'bun:test';

import type {
  AnyTrail,
  CrossFn,
  ResourceOverrideMap,
  TrailContext,
} from '@ontrails/core';
import {
  executeTrail,
  InternalError,
  Result,
  ValidationError,
  validateInput,
} from '@ontrails/core';

import {
  assertErrorMatch,
  assertFullMatch,
  assertSchemaMatch,
} from './assertions.js';
import { mergeResourceOverrides, mergeTestContext } from './context.js';
import type { CrossScenario } from './types.js';

// ---------------------------------------------------------------------------
// Cross trace
// ---------------------------------------------------------------------------

interface CrossRecord {
  readonly id: string;
  readonly input: unknown;
}

const collectDeclaredResources = (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): AnyTrail['resources'] => {
  const seenResourceIds = new Set<string>();
  const seenTrailIds = new Set<string>();
  const resources: AnyTrail['resources'][number][] = [];

  const collect = (candidate: AnyTrail): void => {
    for (const declaredResource of candidate.resources) {
      if (seenResourceIds.has(declaredResource.id)) {
        continue;
      }
      seenResourceIds.add(declaredResource.id);
      resources.push(declaredResource);
    }
  };

  const visit = (candidate: AnyTrail): void => {
    if (seenTrailIds.has(candidate.id)) {
      return;
    }
    seenTrailIds.add(candidate.id);
    collect(candidate);
    for (const crossedId of candidate.crosses) {
      const crossedTrail = trailsMap?.get(crossedId);
      if (crossedTrail) {
        visit(crossedTrail);
      }
    }
  };

  visit(trailDef);
  return resources;
};

const resolveCrossMockResources = async (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): Promise<ResourceOverrideMap> => {
  const resources: Record<string, unknown> = {};

  for (const declaredResource of collectDeclaredResources(
    trailDef,
    trailsMap
  )) {
    if (!declaredResource.mock) {
      continue;
    }
    resources[declaredResource.id] = await declaredResource.mock();
  }

  return resources;
};

// ---------------------------------------------------------------------------
// Injection helpers
// ---------------------------------------------------------------------------

/**
 * Find an error example on a trail by name or description substring.
 */
const findErrorExample = (
  trailDef: AnyTrail,
  description: string
): string | undefined => {
  const example = trailDef.examples?.find(
    (ex) =>
      ex.error !== undefined &&
      (ex.description?.includes(description) || ex.name.includes(description))
  );
  return example?.error;
};

/**
 * Try to inject an error from a crossed trail's example.
 * Returns undefined when no injection is configured for this trail ID.
 */
const tryInjectError = (
  id: string,
  scenario: CrossScenario,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): Result<unknown, Error> | undefined => {
  const injection = scenario.injectFromExample?.[id];
  if (injection === undefined) {
    return undefined;
  }

  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return Result.err(
      new InternalError(`Cannot inject: trail "${id}" not in topo`)
    );
  }
  const errorName = findErrorExample(trailDef, injection);
  if (errorName === undefined) {
    return Result.err(
      new InternalError(
        `No error example matching "${injection}" on trail "${id}"`
      )
    );
  }
  return Result.err(new Error(errorName));
};

/**
 * Execute a trail from the map, validating input first.
 */
const executeFromMap = (
  id: string,
  input: unknown,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  ctx: TrailContext,
  resources: ResourceOverrideMap | undefined,
  cross?: CrossFn
): Result<unknown, Error> | Promise<Result<unknown, Error>> | undefined => {
  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return undefined;
  }

  const nestedCtx = cross ? { ...ctx, cross } : ctx;
  return executeTrail(trailDef, input, {
    ctx: nestedCtx,
    resources,
  });
};

// ---------------------------------------------------------------------------
// Cross factory
// ---------------------------------------------------------------------------

/**
 * Build a recording cross function that optionally injects errors.
 */
const createRecordingCross = (
  trace: CrossRecord[],
  scenario: CrossScenario,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  baseCross: CrossFn | undefined,
  ctx: TrailContext,
  resources: ResourceOverrideMap | undefined
): CrossFn => {
  // The generic O on CrossFn is erased at runtime; the cast is safe
  // because callers narrow via isOk/isErr before accessing the value.
  const cross = (id: string, input: unknown) => {
    trace.push({ id, input });

    const injected = tryInjectError(id, scenario, trailsMap);
    if (injected !== undefined) {
      return Promise.resolve(injected);
    }

    if (baseCross !== undefined) {
      return baseCross(id, input);
    }

    const executed = executeFromMap(
      id,
      input,
      trailsMap,
      ctx,
      resources,
      cross as CrossFn
    );
    if (executed !== undefined) {
      return Promise.resolve(executed);
    }

    return Promise.resolve(Result.ok());
  };
  return cross as CrossFn;
};

// ---------------------------------------------------------------------------
// Scenario assertions
// ---------------------------------------------------------------------------

const assertScenarioResult = (
  result: Result<unknown, Error>,
  scenario: CrossScenario,
  trailDef: AnyTrail
): void => {
  if (scenario.expectValue !== undefined) {
    assertFullMatch(result, scenario.expectValue);
  } else if (scenario.expectErr !== undefined) {
    assertErrorMatch(result, scenario.expectErr, scenario.expectErrMessage);
  } else if (scenario.expectErrMessage !== undefined) {
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(scenario.expectErrMessage);
    }
  } else if (scenario.expectOk === true) {
    expect(result.isOk()).toBe(true);
    assertSchemaMatch(result, trailDef.output);
  }
};

const assertCrossTrace = (
  trace: readonly CrossRecord[],
  scenario: CrossScenario
): void => {
  if (scenario.expectCrossed !== undefined) {
    const crossedIds = trace.map((r) => r.id);
    expect(crossedIds).toEqual([...scenario.expectCrossed]);
  }
  if (scenario.expectCrossedCount !== undefined) {
    const counts: Record<string, number> = {};
    for (const record of trace) {
      counts[record.id] = (counts[record.id] ?? 0) + 1;
    }
    expect(counts).toEqual({ ...scenario.expectCrossedCount });
  }
};

const handleValidationError = (
  validated: Result<unknown, Error>,
  scenario: CrossScenario
): boolean => {
  if (!validated.isErr()) {
    return false;
  }
  if (scenario.expectErr === ValidationError) {
    expect(validated.error).toBeInstanceOf(ValidationError);
    if (scenario.expectErrMessage !== undefined) {
      expect(validated.error.message).toContain(scenario.expectErrMessage);
    }
    return true;
  }
  throw new Error(
    `Input validation failed unexpectedly: ${validated.error.message}`
  );
};

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

const buildTestContext = (
  scenario: CrossScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  resources: ResourceOverrideMap | undefined
): { trace: CrossRecord[]; testCtx: TrailContext } => {
  const trace: CrossRecord[] = [];
  const baseCtx = mergeTestContext(ctx);
  const cross = createRecordingCross(
    trace,
    scenario,
    trailsMap,
    baseCtx.cross,
    baseCtx,
    resources
  );
  return { testCtx: { ...baseCtx, cross }, trace };
};

const runScenario = async (
  trailDef: AnyTrail,
  scenario: CrossScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  resources: ResourceOverrideMap | undefined
): Promise<void> => {
  const validated = validateInput(trailDef.input, scenario.input);
  if (handleValidationError(validated, scenario)) {
    return;
  }

  const { trace, testCtx } = buildTestContext(
    scenario,
    ctx,
    trailsMap,
    resources
  );
  const result = await executeTrail(trailDef, scenario.input, {
    ctx: testCtx,
    resources,
  });
  assertCrossTrace(trace, scenario);
  assertScenarioResult(result, scenario, trailDef);
};

// ---------------------------------------------------------------------------
// testCrosses
// ---------------------------------------------------------------------------

/** Options for testCrosses that provide trail definitions for injection. */
export interface TestCrossOptions {
  /** Partial context overrides. */
  readonly ctx?: Partial<TrailContext> | undefined;
  /**
   * Explicit resource overrides merged on top of auto-resolved mocks for every
   * scenario. Values are passed by reference — provide immutable objects, or
   * use `mock()` on the resource definition to get a fresh instance per run.
   */
  readonly resources?: ResourceOverrideMap | undefined;
  /** Map of trail ID to trail definition, used for injectFromExample. */
  readonly trails?: ReadonlyMap<string, AnyTrail> | undefined;
}

/**
 * Generate a describe block for a trail with crossings with one test per scenario.
 *
 * @example
 * ```ts
 * testCrosses(onboardTrail, [
 *   {
 *     description: "crosses add then relate",
 *     input: { name: "Alpha" },
 *     expectOk: true,
 *     expectCrossed: ["entity.add", "entity.relate"],
 *   },
 * ]);
 * ```
 */
export const testCrosses = (
  trailDef: AnyTrail,
  scenarios: readonly CrossScenario[],
  options?: TestCrossOptions
): void => {
  const explicitResources = options?.resources;

  describe(trailDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: CrossScenario) => {
        const resources = mergeResourceOverrides(
          await resolveCrossMockResources(trailDef, options?.trails),
          options?.ctx,
          explicitResources
        );
        await runScenario(
          trailDef,
          scenario,
          options?.ctx,
          options?.trails,
          resources
        );
      }
    );
  });
};
