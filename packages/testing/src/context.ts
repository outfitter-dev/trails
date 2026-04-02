/**
 * Test context factory for creating TrailContext instances suitable for testing.
 */

import type {
  CrossFn,
  ProvisionOverrideMap,
  Topo,
  TrailContext,
} from '@ontrails/core';
import { Result, createProvisionLookup } from '@ontrails/core';

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
 * - `abortSignal`: a non-aborted AbortController signal
 */
export const createTestContext = (
  overrides?: TestTrailContextOptions
): TrailContext => {
  const cwd = overrides?.cwd ?? process.cwd();
  const ctx = {
    abortSignal: overrides?.abortSignal ?? new AbortController().signal,
    cwd,
    env: overrides?.env ?? { TRAILS_ENV: 'test' },
    extensions: undefined,
    logger: overrides?.logger ?? createTestLogger(),
    requestId: overrides?.requestId ?? 'test-request-001',
    workspaceRoot: cwd,
  } as MutableTrailContext;
  const lookup = createProvisionLookup(() => ctx);
  ctx.provision = lookup;
  return ctx;
};

// ---------------------------------------------------------------------------
// createCrossContext
// ---------------------------------------------------------------------------

export interface CreateCrossContextOptions {
  readonly responses?: Record<string, Result<unknown, Error>> | undefined;
}

/** Minimal permit shape returned by the mint function. */
export interface MintedPermit {
  readonly id: string;
  readonly scopes: readonly string[];
}

/** Trail shape consumed by the mint function — avoids importing permits. */
export interface MintableTrail {
  readonly permit?:
    | { readonly scopes: readonly string[] }
    | 'public'
    | undefined;
}

export interface TestExecutionOptions {
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly provisions?: ProvisionOverrideMap | undefined;
  /**
   * When true, disables automatic permit minting. Tests must provide
   * explicit permits.
   */
  readonly strictPermits?: boolean | undefined;
  /**
   * Optional function to mint a test permit for a trail. When provided,
   * called for each trail with a non-public `permit` requirement.
   * Returning `undefined` skips minting for that trail.
   *
   * A default inline implementation is used when this is not provided,
   * keeping the testing package free of a hard dependency on `@ontrails/permits`.
   */
  readonly mintPermit?: (trail: MintableTrail) => MintedPermit | undefined;
}

/**
 * Create a mock `CrossFn` for testing composite trails.
 *
 * Returns preconfigured `Result` values keyed by trail ID. Calls to
 * unregistered IDs return `Result.err` with a descriptive message.
 *
 * @example
 * ```ts
 * const cross = createCrossContext({
 *   responses: { 'entity.add': Result.ok({ id: '1', name: 'Alpha' }) },
 * });
 * const ctx = { ...createTestContext(), cross };
 * ```
 */
export const createCrossContext = (
  options?: CreateCrossContextOptions
): CrossFn => {
  const responses = options?.responses ?? {};
  return <O>(id: string, _input: unknown): Promise<Result<O, Error>> => {
    const response = responses[id];
    if (response === undefined) {
      return Promise.resolve(
        Result.err(new Error(`No mock response for cross("${id}")`)) as Result<
          O,
          Error
        >
      );
    }
    return Promise.resolve(response as Result<O, Error>);
  };
};

/**
 * Default permit minter — reads `trail.permit.scopes` and produces a
 * minimal permit object. No dependency on `@ontrails/permits`.
 */
export const defaultMintPermit = (
  trail: MintableTrail
): MintedPermit | undefined => {
  if (!trail.permit || trail.permit === 'public') {
    return undefined;
  }
  return { id: 'test-permit', scopes: trail.permit.scopes };
};

const isTestExecutionOptions = (
  input: Partial<TrailContext> | TestExecutionOptions | undefined
): input is TestExecutionOptions =>
  input !== undefined &&
  (Object.hasOwn(input, 'ctx') ||
    Object.hasOwn(input, 'provisions') ||
    Object.hasOwn(input, 'strictPermits') ||
    Object.hasOwn(input, 'mintPermit'));

export const normalizeTestExecutionOptions = (
  input?: Partial<TrailContext> | TestExecutionOptions
): TestExecutionOptions =>
  isTestExecutionOptions(input) ? input : { ctx: input };

export const mergeProvisionOverrides = (
  autoResolved: ProvisionOverrideMap,
  ctx: Partial<TrailContext> | undefined,
  explicit: ProvisionOverrideMap | undefined
): ProvisionOverrideMap => ({
  ...autoResolved,
  ...ctx?.extensions,
  ...explicit,
});

const buildMockProvisions = async (
  app: Topo
): Promise<ProvisionOverrideMap> => {
  const provisions: Record<string, unknown> = {};
  for (const declaredProvision of app.listProvisions()) {
    if (!declaredProvision.mock) {
      continue;
    }
    provisions[declaredProvision.id] = await declaredProvision.mock();
  }
  return provisions;
};

export const resolveMockProvisions = async (
  app: Topo
): Promise<ProvisionOverrideMap> => await buildMockProvisions(app);

/**
 * Merge a Partial<TrailContext> into a test context.
 * Used internally when the public API accepts Partial<TrailContext>.
 */
export const mergeTestContext = (
  ctx?: Partial<TrailContext>,
  provisions?: ProvisionOverrideMap
): TrailContext => {
  const base = createTestContext();
  const extensions = {
    ...base.extensions,
    ...ctx?.extensions,
    ...provisions,
  };
  const merged = {
    ...base,
    ...ctx,
    extensions: Object.keys(extensions).length === 0 ? undefined : extensions,
  } as MutableTrailContext;
  const lookup = createProvisionLookup(() => merged);
  merged.provision = lookup;
  return merged;
};
