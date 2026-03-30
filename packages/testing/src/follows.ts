/**
 * testFollows — composition-aware scenario testing for trails with follow.
 *
 * Tests the follow graph: which trails were followed, in what order,
 * and supports failure injection from followed trail examples.
 */

import { describe, expect, test } from 'bun:test';

import type {
  AnyTrail,
  FollowFn,
  ServiceOverrideMap,
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
import { mergeServiceOverrides, mergeTestContext } from './context.js';
import type { FollowScenario } from './types.js';

// ---------------------------------------------------------------------------
// Follow trace
// ---------------------------------------------------------------------------

interface FollowRecord {
  readonly id: string;
  readonly input: unknown;
}

const collectDeclaredServices = (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): AnyTrail['services'] => {
  const seenServiceIds = new Set<string>();
  const seenTrailIds = new Set<string>();
  const services: AnyTrail['services'][number][] = [];

  const collect = (candidate: AnyTrail): void => {
    for (const declaredService of candidate.services) {
      if (seenServiceIds.has(declaredService.id)) {
        continue;
      }
      seenServiceIds.add(declaredService.id);
      services.push(declaredService);
    }
  };

  const visit = (candidate: AnyTrail): void => {
    if (seenTrailIds.has(candidate.id)) {
      return;
    }
    seenTrailIds.add(candidate.id);
    collect(candidate);
    for (const followedId of candidate.follow) {
      const followedTrail = trailsMap?.get(followedId);
      if (followedTrail) {
        visit(followedTrail);
      }
    }
  };

  visit(trailDef);
  return services;
};

const resolveMockServices = async (
  trailDef: AnyTrail,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined
): Promise<ServiceOverrideMap> => {
  const services: Record<string, unknown> = {};

  for (const declaredService of collectDeclaredServices(trailDef, trailsMap)) {
    if (!declaredService.mock) {
      continue;
    }
    services[declaredService.id] = await declaredService.mock();
  }

  return services;
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
 * Try to inject an error from a followed trail's example.
 * Returns undefined when no injection is configured for this trail ID.
 */
const tryInjectError = (
  id: string,
  scenario: FollowScenario,
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
  services: ServiceOverrideMap | undefined,
  follow?: FollowFn
): Result<unknown, Error> | Promise<Result<unknown, Error>> | undefined => {
  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return undefined;
  }

  const nestedCtx = follow ? { ...ctx, follow } : ctx;
  return executeTrail(trailDef, input, {
    ctx: nestedCtx,
    services,
  });
};

// ---------------------------------------------------------------------------
// Follow factory
// ---------------------------------------------------------------------------

/**
 * Build a recording follow function that optionally injects errors.
 */
const createRecordingFollow = (
  trace: FollowRecord[],
  scenario: FollowScenario,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  baseFollow: FollowFn | undefined,
  ctx: TrailContext,
  services: ServiceOverrideMap | undefined
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

    const executed = executeFromMap(
      id,
      input,
      trailsMap,
      ctx,
      services,
      follow as FollowFn
    );
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
  scenario: FollowScenario,
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

const assertFollowTrace = (
  trace: readonly FollowRecord[],
  scenario: FollowScenario
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
  scenario: FollowScenario
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
  scenario: FollowScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  services: ServiceOverrideMap | undefined
): { trace: FollowRecord[]; testCtx: TrailContext } => {
  const trace: FollowRecord[] = [];
  const baseCtx = mergeTestContext(ctx);
  const follow = createRecordingFollow(
    trace,
    scenario,
    trailsMap,
    baseCtx.follow,
    baseCtx,
    services
  );
  return { testCtx: { ...baseCtx, follow }, trace };
};

const runScenario = async (
  trailDef: AnyTrail,
  scenario: FollowScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  services: ServiceOverrideMap | undefined
): Promise<void> => {
  const validated = validateInput(trailDef.input, scenario.input);
  if (handleValidationError(validated, scenario)) {
    return;
  }

  const { trace, testCtx } = buildTestContext(
    scenario,
    ctx,
    trailsMap,
    services
  );
  const result = await executeTrail(trailDef, scenario.input, {
    ctx: testCtx,
    services,
  });
  assertFollowTrace(trace, scenario);
  assertScenarioResult(result, scenario, trailDef);
};

// ---------------------------------------------------------------------------
// testFollows
// ---------------------------------------------------------------------------

/** Options for testFollows that provide trail definitions for injection. */
export interface TestFollowOptions {
  /** Partial context overrides. */
  readonly ctx?: Partial<TrailContext> | undefined;
  /**
   * Explicit service overrides merged on top of auto-resolved mocks for every
   * scenario. Values are passed by reference — provide immutable objects, or
   * use `mock()` on the service definition to get a fresh instance per run.
   */
  readonly services?: ServiceOverrideMap | undefined;
  /** Map of trail ID to trail definition, used for injectFromExample. */
  readonly trails?: ReadonlyMap<string, AnyTrail> | undefined;
}

/**
 * Generate a describe block for a composition trail with one test per scenario.
 *
 * @example
 * ```ts
 * testFollows(onboardTrail, [
 *   {
 *     description: "follows add then relate",
 *     input: { name: "Alpha" },
 *     expectOk: true,
 *     expectFollowed: ["entity.add", "entity.relate"],
 *   },
 * ]);
 * ```
 */
export const testFollows = (
  trailDef: AnyTrail,
  scenarios: readonly FollowScenario[],
  options?: TestFollowOptions
): void => {
  describe(trailDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: FollowScenario) => {
        const services = mergeServiceOverrides(
          await resolveMockServices(trailDef, options?.trails),
          options?.ctx,
          options?.services
        );
        await runScenario(
          trailDef,
          scenario,
          options?.ctx,
          options?.trails,
          services
        );
      }
    );
  });
};
