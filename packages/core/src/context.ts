import type { TrailContext } from './types.js';

/**
 * Create a TrailContext with sensible defaults.
 *
 * - `requestId` defaults to `Bun.randomUUIDv7()` (sortable v7 UUID)
 * - `signal` defaults to a fresh, non-aborted `AbortSignal`
 * - All other fields come from `overrides`
 */
export const createTrailContext = (
  overrides?: Partial<TrailContext>
): TrailContext => ({
  cwd: process.cwd(),
  env: process.env as Record<string, string | undefined>,
  requestId: Bun.randomUUIDv7(),
  signal: new AbortController().signal,
  ...overrides,
});
