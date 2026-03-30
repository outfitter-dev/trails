import { createServiceLookup } from './service.js';
import type { TrailContext, TrailContextInit } from './types.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

/**
 * Create a TrailContext with sensible defaults.
 *
 * - `requestId` defaults to `Bun.randomUUIDv7()` (sortable v7 UUID)
 * - `signal` defaults to a fresh, non-aborted `AbortSignal`
 * - All other fields come from `overrides`
 */
export const createTrailContext = (
  overrides?: Partial<TrailContextInit>
): TrailContext => {
  const ctx = {
    cwd: process.cwd(),
    env: process.env as Record<string, string | undefined>,
    requestId: Bun.randomUUIDv7(),
    signal: new AbortController().signal,
    ...overrides,
  } as MutableTrailContext;
  ctx.service = overrides?.service ?? createServiceLookup(() => ctx);
  return ctx;
};
