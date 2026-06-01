/**
 * testComposes — composing-aware scenario testing for trails with compositions.
 *
 * Tests the composing graph: which trails were composed, in what order,
 * and supports failure injection from composed trail examples.
 */

import { describe, expect, test } from 'bun:test';

import type {
  AnyTrail,
  ComposeFn,
  ExecuteTrailOptions,
  ResourceOverrideMap,
  TrailContext,
} from '@ontrails/core';
import {
  buildComposeValidationSchema,
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
import { createErrorFromName } from './errors.js';
import type { ComposeScenario } from './types.js';

type TestingExecuteTrailOptions = ExecuteTrailOptions & {
  readonly validationSchema?: ReturnType<typeof buildComposeValidationSchema>;
};

// ---------------------------------------------------------------------------
// Compose trace
// ---------------------------------------------------------------------------

interface ComposeRecord {
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
    for (const composedId of candidate.composes) {
      const composedTrail = trailsMap?.get(composedId);
      if (composedTrail) {
        visit(composedTrail);
      }
    }
  };

  visit(trailDef);
  return resources;
};

const resolveComposeMockResources = async (
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
 * Try to inject an error from a composed trail's example.
 * Returns undefined when no injection is configured for this trail ID.
 */
const tryInjectError = (
  id: string,
  scenario: ComposeScenario,
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
  return Result.err(createErrorFromName(errorName));
};

const executeFromMap = (
  id: string,
  input: unknown,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  ctx: TrailContext,
  resources: ResourceOverrideMap | undefined,
  compose?: ComposeFn
): Result<unknown, Error> | Promise<Result<unknown, Error>> | undefined => {
  const trailDef = trailsMap?.get(id);
  if (trailDef === undefined) {
    return undefined;
  }

  const nestedCtx = compose ? { ...ctx, compose } : ctx;
  const options: TestingExecuteTrailOptions = {
    ctx: nestedCtx,
    resources,
    validationSchema: buildComposeValidationSchema(trailDef),
  };
  return executeTrail(trailDef, input, options);
};

/** Extract trail ID from either a trail object or a string. */
const resolveComposeId = (
  idOrTrail: string | { readonly id: string }
): string => (typeof idOrTrail === 'string' ? idOrTrail : idOrTrail.id);

// ---------------------------------------------------------------------------
// Compose factory
// ---------------------------------------------------------------------------

/** Delegate to baseCompose, executeFromMap, or fall back to Result.ok(). */
const delegateCompose = (
  id: string,
  input: unknown,
  baseCompose: ComposeFn | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  ctx: TrailContext,
  resources: ResourceOverrideMap | undefined,
  self: ComposeFn
): Promise<Result<unknown, Error>> => {
  if (baseCompose !== undefined) {
    return baseCompose(id, input);
  }
  const executed = executeFromMap(id, input, trailsMap, ctx, resources, self);
  return Promise.resolve(executed ?? Result.ok());
};

/**
 * Build a recording compose function that optionally injects errors.
 */
const createRecordingCompose = (
  trace: ComposeRecord[],
  scenario: ComposeScenario,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  baseCompose: ComposeFn | undefined,
  ctx: TrailContext,
  resources: ResourceOverrideMap | undefined
): ComposeFn => {
  // The generic O on ComposeFn is erased at runtime; the cast is safe
  // because callers narrow via isOk/isErr before accessing the value.
  const invokeCompose = async (
    idOrTrail: string | { readonly id: string },
    input: unknown,
    self: ComposeFn
  ) => {
    const id = resolveComposeId(idOrTrail);
    trace.push({ id, input });

    const injected = tryInjectError(id, scenario, trailsMap);
    if (injected !== undefined) {
      return injected;
    }

    return await delegateCompose(
      id,
      input,
      baseCompose,
      trailsMap,
      ctx,
      resources,
      self
    );
  };

  // Accepts either a trail object (typed compose), a string id (untyped),
  // or a batch of `[target, input]` tuples.
  const compose = async function compose(
    idOrTrail:
      | string
      | { readonly id: string }
      | readonly (readonly [string | { readonly id: string }, unknown])[],
    input?: unknown
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
      input,
      compose as ComposeFn
    );
  } as ComposeFn;

  return compose;
};

// ---------------------------------------------------------------------------
// Scenario assertions
// ---------------------------------------------------------------------------

const assertScenarioResult = (
  result: Result<unknown, Error>,
  scenario: ComposeScenario,
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

const assertComposeTrace = (
  trace: readonly ComposeRecord[],
  scenario: ComposeScenario
): void => {
  if (scenario.expectComposed !== undefined) {
    const composedIds = trace.map((r) => r.id);
    expect(composedIds).toEqual([...scenario.expectComposed]);
  }
  if (scenario.expectComposedCount !== undefined) {
    const counts: Record<string, number> = {};
    for (const record of trace) {
      counts[record.id] = (counts[record.id] ?? 0) + 1;
    }
    expect(counts).toEqual({ ...scenario.expectComposedCount });
  }
};

const handleValidationError = (
  validated: Result<unknown, Error>,
  scenario: ComposeScenario
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
  scenario: ComposeScenario,
  ctx: Partial<TrailContext> | undefined,
  trailsMap: ReadonlyMap<string, AnyTrail> | undefined,
  resources: ResourceOverrideMap | undefined
): { trace: ComposeRecord[]; testCtx: TrailContext } => {
  const trace: ComposeRecord[] = [];
  const baseCtx = mergeTestContext(ctx);
  const compose = createRecordingCompose(
    trace,
    scenario,
    trailsMap,
    baseCtx.compose,
    baseCtx,
    resources
  );
  return { testCtx: { ...baseCtx, compose }, trace };
};

const runScenario = async (
  trailDef: AnyTrail,
  scenario: ComposeScenario,
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
  assertComposeTrace(trace, scenario);
  assertScenarioResult(result, scenario, trailDef);
};

// ---------------------------------------------------------------------------
// testComposes
// ---------------------------------------------------------------------------

/** Options for testComposes that provide trail definitions for injection. */
export interface TestComposeOptions {
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
 * Generate a describe block for a trail with compositions with one test per scenario.
 *
 * @example
 * ```ts
 * testComposes(onboardTrail, [
 *   {
 *     description: "composes add then relate",
 *     input: { name: "Alpha" },
 *     expectOk: true,
 *     expectComposed: ["entity.add", "entity.relate"],
 *   },
 * ]);
 * ```
 */
export const testComposes = (
  trailDef: AnyTrail,
  scenarios: readonly ComposeScenario[],
  options?: TestComposeOptions
): void => {
  const explicitResources = options?.resources;

  describe(trailDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: ComposeScenario) => {
        const resources = mergeResourceOverrides(
          await resolveComposeMockResources(trailDef, options?.trails),
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
