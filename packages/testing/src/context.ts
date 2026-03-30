/**
 * Test context factory for creating TrailContext instances suitable for testing.
 */

import type {
  FollowFn,
  ServiceOverrideMap,
  Topo,
  TrailContext,
} from '@ontrails/core';
import { Result, createServiceLookup } from '@ontrails/core';

import { createTestLogger } from './logger.js';
import type { TestTrailContextOptions } from './types.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

// ---------------------------------------------------------------------------
// createTestContext
// ---------------------------------------------------------------------------

/**
 * Create a TrailContext with deterministic, test-friendly defaults.
 *
 * - `requestId`: `"test-request-001"` (deterministic)
 * - `logger`: a `TestLogger` that captures entries
 * - `signal`: a non-aborted AbortController signal
 */
export const createTestContext = (
  overrides?: TestTrailContextOptions
): TrailContext => {
  const cwd = overrides?.cwd ?? process.cwd();
  const ctx = {
    cwd,
    env: overrides?.env ?? { TRAILS_ENV: 'test' },
    extensions: undefined,
    logger: overrides?.logger ?? createTestLogger(),
    requestId: overrides?.requestId ?? 'test-request-001',
    signal: overrides?.signal ?? new AbortController().signal,
    workspaceRoot: cwd,
  } as MutableTrailContext;
  ctx.service = createServiceLookup(() => ctx);
  return ctx;
};

// ---------------------------------------------------------------------------
// createFollowContext
// ---------------------------------------------------------------------------

export interface CreateFollowContextOptions {
  readonly responses?: Record<string, Result<unknown, Error>> | undefined;
}

export interface TestExecutionOptions {
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly services?: ServiceOverrideMap | undefined;
}

/**
 * Create a mock `FollowFn` for testing composite trails.
 *
 * Returns preconfigured `Result` values keyed by trail ID. Calls to
 * unregistered IDs return `Result.err` with a descriptive message.
 *
 * @example
 * ```ts
 * const follow = createFollowContext({
 *   responses: { 'entity.add': Result.ok({ id: '1', name: 'Alpha' }) },
 * });
 * const ctx = { ...createTestContext(), follow };
 * ```
 */
export const createFollowContext = (
  options?: CreateFollowContextOptions
): FollowFn => {
  const responses = options?.responses ?? {};
  return <O>(id: string, _input: unknown): Promise<Result<O, Error>> => {
    const response = responses[id];
    if (response === undefined) {
      return Promise.resolve(
        Result.err(new Error(`No mock response for follow("${id}")`)) as Result<
          O,
          Error
        >
      );
    }
    return Promise.resolve(response as Result<O, Error>);
  };
};

const isTestExecutionOptions = (
  input: Partial<TrailContext> | TestExecutionOptions | undefined
): input is TestExecutionOptions =>
  input !== undefined &&
  (Object.hasOwn(input, 'ctx') || Object.hasOwn(input, 'services'));

export const normalizeTestExecutionOptions = (
  input?: Partial<TrailContext> | TestExecutionOptions
): TestExecutionOptions =>
  isTestExecutionOptions(input) ? input : { ctx: input };

export const mergeServiceOverrides = (
  autoResolved: ServiceOverrideMap,
  ctx: Partial<TrailContext> | undefined,
  explicit: ServiceOverrideMap | undefined
): ServiceOverrideMap => ({
  ...autoResolved,
  ...ctx?.extensions,
  ...explicit,
});

const buildMockServices = async (app: Topo): Promise<ServiceOverrideMap> => {
  const services: Record<string, unknown> = {};
  for (const declaredService of app.listServices()) {
    if (!declaredService.mock) {
      continue;
    }
    services[declaredService.id] = await declaredService.mock();
  }
  return services;
};

export const resolveMockServices = async (
  app: Topo
): Promise<ServiceOverrideMap> => await buildMockServices(app);

/**
 * Merge a Partial<TrailContext> into a test context.
 * Used internally when the public API accepts Partial<TrailContext>.
 */
export const mergeTestContext = (
  ctx?: Partial<TrailContext>,
  services?: ServiceOverrideMap
): TrailContext => {
  const base = createTestContext();
  const extensions = {
    ...base.extensions,
    ...ctx?.extensions,
    ...services,
  };
  const merged = {
    ...base,
    ...ctx,
    extensions: Object.keys(extensions).length === 0 ? undefined : extensions,
  } as MutableTrailContext;
  merged.service = createServiceLookup(() => merged);
  return merged;
};
