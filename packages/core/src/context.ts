import { createProvisionLookup } from './resource.js';
import type { TrailContext, TrailContextInit, TraceFn } from './types.js';

type MutableTrailContext = {
  -readonly [K in keyof TrailContext]: TrailContext[K];
};

/**
 * Default passthrough `trace` used when a context is built outside
 * `executeTrail`. `executeTrail` replaces this with a real sink-writing
 * implementation. The passthrough runs `fn` without recording anything so
 * direct `createTrailContext()` callers (tests, ad-hoc compositions) don't
 * crash when invoking `ctx.trace(...)`.
 */
const passthroughTrace: TraceFn = <T>(
  _label: string,
  fn: () => Promise<T>
): Promise<T> => fn();

/**
 * Create a TrailContext with sensible defaults.
 *
 * - `requestId` defaults to `Bun.randomUUIDv7()` (sortable v7 UUID)
 * - `abortSignal` defaults to a fresh, non-aborted `AbortSignal`
 * - All other fields come from `overrides`
 */
export const createTrailContext = (
  overrides?: Partial<TrailContextInit>
): TrailContext => {
  const ctx = {
    abortSignal: new AbortController().signal,
    cwd: process.cwd(),
    env: process.env as Record<string, string | undefined>,
    requestId: Bun.randomUUIDv7(),
    trace: passthroughTrace,
    ...overrides,
  } as MutableTrailContext;
  const lookup = overrides?.resource ?? createProvisionLookup(() => ctx);
  ctx.resource = lookup;
  if (ctx.trace === undefined) {
    ctx.trace = passthroughTrace;
  }
  return ctx;
};
