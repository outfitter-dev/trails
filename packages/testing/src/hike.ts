/**
 * testHike — composition-aware scenario testing for hikes.
 *
 * Tests the composition graph: which trails were followed, in what order,
 * and supports failure injection from followed trail examples.
 */

import { describe, expect, test } from 'bun:test';

import type { AnyHike, AnyTrail, FollowFn, TrailContext } from '@ontrails/core';
import {
  InternalError,
  Result,
  ValidationError,
  validateInput,
} from '@ontrails/core';

import {
  assertErrorMatch,
  assertFullMatch,
  assertSchemaMatch,
  expectOk,
} from './assertions.js';
import { mergeTestContext } from './context.js';
import type { HikeScenario } from './types.js';

// ---------------------------------------------------------------------------
// Follow trace
// ---------------------------------------------------------------------------

interface FollowRecord {
  readonly id: string;
  readonly input: unknown;
}

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
 * Try to inject an error from a followed trail's example.
 * Returns undefined when no injection is configured for this trail ID.
 */
const tryInjectError = (
  id: string,
  scenario: HikeScenario,
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
  ctx: TrailContext
): Result<unknown, Error> | Promise<Result<unknown, Error>> | undefined => {
  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return undefined;
  }

  const validated = validateInput(trailDef.input, input);
  if (validated.isErr()) {
    return validated;
  }
  return trailDef.implementation(validated.value, ctx);
};

// ---------------------------------------------------------------------------
// Follow factory
// ---------------------------------------------------------------------------

/**
 * Build a recording follow function that optionally injects errors.
 */
const createRecordingFollow = (
  trace: FollowRecord[],
  scenario: HikeScenario,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  baseFollow: FollowFn | undefined,
  ctx: TrailContext
): FollowFn => {
  // The generic O on FollowFn is erased at runtime; the cast is safe
  // because callers narrow via isOk/isErr before accessing the value.
  const follow = (id: string, input: unknown) => {
    trace.push({ id, input });

    const injected = tryInjectError(id, scenario, trailsMap);
    if (injected !== undefined) {
      return Promise.resolve(injected);
    }

    if (baseFollow !== undefined) {
      return baseFollow(id, input);
    }

    const executed = executeFromMap(id, input, trailsMap, ctx);
    if (executed !== undefined) {
      return Promise.resolve(executed);
    }

    return Promise.resolve(Result.ok());
  };
  return follow as FollowFn;
};

// ---------------------------------------------------------------------------
// Scenario assertions
// ---------------------------------------------------------------------------

const assertScenarioResult = (
  result: Result<unknown, Error>,
  scenario: HikeScenario,
  hikeDef: AnyHike
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
    assertSchemaMatch(result, hikeDef.output);
  }
};

const assertFollowTrace = (
  trace: readonly FollowRecord[],
  scenario: HikeScenario
): void => {
  if (scenario.expectFollowed !== undefined) {
    const followedIds = trace.map((r) => r.id);
    expect(followedIds).toEqual([...scenario.expectFollowed]);
  }
  if (scenario.expectFollowedCount !== undefined) {
    const counts: Record<string, number> = {};
    for (const record of trace) {
      counts[record.id] = (counts[record.id] ?? 0) + 1;
    }
    expect(counts).toEqual({ ...scenario.expectFollowedCount });
  }
};

const handleValidationError = (
  validated: Result<unknown, Error>,
  scenario: HikeScenario
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
  scenario: HikeScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): { trace: FollowRecord[]; testCtx: TrailContext } => {
  const trace: FollowRecord[] = [];
  const baseCtx = mergeTestContext(ctx);
  const follow = createRecordingFollow(
    trace,
    scenario,
    trailsMap,
    baseCtx.follow,
    baseCtx
  );
  return { testCtx: { ...baseCtx, follow }, trace };
};

const runScenario = async (
  hikeDef: AnyHike,
  scenario: HikeScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): Promise<void> => {
  const validated = validateInput(hikeDef.input, scenario.input);
  if (handleValidationError(validated, scenario)) {
    return;
  }

  const { trace, testCtx } = buildTestContext(scenario, ctx, trailsMap);
  const result = await hikeDef.implementation(expectOk(validated), testCtx);
  assertFollowTrace(trace, scenario);
  assertScenarioResult(result, scenario, hikeDef);
};

// ---------------------------------------------------------------------------
// testHike
// ---------------------------------------------------------------------------

/** Options for testHike that provide trail definitions for injection. */
export interface TestHikeOptions {
  /** Partial context overrides. */
  readonly ctx?: Partial<TrailContext> | undefined;
  /** Map of trail ID to trail definition, used for injectFromExample. */
  readonly trails?: ReadonlyMap<string, AnyTrail> | undefined;
}

/**
 * Generate a describe block for a hike with one test per scenario.
 *
 * @example
 * ```ts
 * testHike(onboardHike, [
 *   {
 *     description: "follows add then relate",
 *     input: { name: "Alpha" },
 *     expectOk: true,
 *     expectFollowed: ["entity.add", "entity.relate"],
 *   },
 * ]);
 * ```
 */
export const testHike = (
  hikeDef: AnyHike,
  scenarios: readonly HikeScenario[],
  options?: TestHikeOptions
): void => {
  describe(hikeDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: HikeScenario) => {
        await runScenario(hikeDef, scenario, options?.ctx, options?.trails);
      }
    );
  });
};
