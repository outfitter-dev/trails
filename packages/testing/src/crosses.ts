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
  ProvisionOverrideMap,
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
import { mergeProvisionOverrides, mergeTestContext } from './context.js';
import type { CrossScenario } from './types.js';

// ---------------------------------------------------------------------------
// Cross trace
// ---------------------------------------------------------------------------

interface CrossRecord {
  readonly id: string;
  readonly input: unknown;
}

const collectDeclaredProvisions = (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): AnyTrail['provisions'] => {
  const seenProvisionIds = new Set<string>();
  const seenTrailIds = new Set<string>();
  const provisions: AnyTrail['provisions'][number][] = [];

  const collect = (candidate: AnyTrail): void => {
    for (const declaredProvision of candidate.provisions) {
      if (seenProvisionIds.has(declaredProvision.id)) {
        continue;
      }
      seenProvisionIds.add(declaredProvision.id);
      provisions.push(declaredProvision);
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
  return provisions;
};

const resolveCrossMockProvisions = async (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): Promise<ProvisionOverrideMap> => {
  const provisions: Record<string, unknown> = {};

  for (const declaredProvision of collectDeclaredProvisions(
    trailDef,
    trailsMap
  )) {
    if (!declaredProvision.mock) {
      continue;
    }
    provisions[declaredProvision.id] = await declaredProvision.mock();
  }

  return provisions;
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
  provisions: ProvisionOverrideMap | undefined,
  cross?: CrossFn
): Result<unknown, Error> | Promise<Result<unknown, Error>> | undefined => {
  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return undefined;
  }

  const nestedCtx = cross ? { ...ctx, cross } : ctx;
  return executeTrail(trailDef, input, {
    ctx: nestedCtx,
    provisions,
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
  provisions: ProvisionOverrideMap | undefined
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
      provisions,
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
  provisions: ProvisionOverrideMap | undefined
): { trace: CrossRecord[]; testCtx: TrailContext } => {
  const trace: CrossRecord[] = [];
  const baseCtx = mergeTestContext(ctx);
  const cross = createRecordingCross(
    trace,
    scenario,
    trailsMap,
    baseCtx.cross,
    baseCtx,
    provisions
  );
  return { testCtx: { ...baseCtx, cross }, trace };
};

const runScenario = async (
  trailDef: AnyTrail,
  scenario: CrossScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  provisions: ProvisionOverrideMap | undefined
): Promise<void> => {
  const validated = validateInput(trailDef.input, scenario.input);
  if (handleValidationError(validated, scenario)) {
    return;
  }

  const { trace, testCtx } = buildTestContext(
    scenario,
    ctx,
    trailsMap,
    provisions
  );
  const result = await executeTrail(trailDef, scenario.input, {
    ctx: testCtx,
    provisions,
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
   * Explicit provision overrides merged on top of auto-resolved mocks for every
   * scenario. Values are passed by reference — provide immutable objects, or
   * use `mock()` on the provision definition to get a fresh instance per run.
   */
  readonly provisions?: ProvisionOverrideMap | undefined;
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
  const explicitProvisions = options?.provisions;

  describe(trailDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: CrossScenario) => {
        const provisions = mergeProvisionOverrides(
          await resolveCrossMockProvisions(trailDef, options?.trails),
          options?.ctx,
          explicitProvisions
        );
        await runScenario(
          trailDef,
          scenario,
          options?.ctx,
          options?.trails,
          provisions
        );
      }
    );
  });
};
