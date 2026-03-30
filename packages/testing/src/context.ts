/**
 * Test context factory for creating TrailContext instances suitable for testing.
 */

import type { FollowFn, TrailContext } from '@ontrails/core';
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
  const ctx = {
    env: overrides?.env ?? { TRAILS_ENV: 'test' },
    extensions: undefined,
    logger: overrides?.logger ?? createTestLogger(),
    requestId: overrides?.requestId ?? 'test-request-001',
    signal: overrides?.signal ?? new AbortController().signal,
    workspaceRoot: overrides?.cwd ?? process.cwd(),
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

/**
 * Merge a Partial<TrailContext> into a test context.
 * Used internally when the public API accepts Partial<TrailContext>.
 */
export const mergeTestContext = (ctx?: Partial<TrailContext>): TrailContext => {
  if (ctx === undefined) {
    return createTestContext();
  }

  const base = createTestContext();
  return { ...base, ...ctx };
};
