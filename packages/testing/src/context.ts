/**
 * Test context factory for creating TrailContext instances suitable for testing.
 */

import type { TrailContext } from '@ontrails/core';

import { createTestLogger } from './logger.js';
import type { TestTrailContextOptions } from './types.js';

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
): TrailContext => ({
  env: overrides?.env ?? { TRAILS_ENV: 'test' },
  logger: overrides?.logger ?? createTestLogger(),
  requestId: overrides?.requestId ?? 'test-request-001',
  signal: overrides?.signal ?? new AbortController().signal,
  workspaceRoot: overrides?.cwd ?? process.cwd(),
});

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
