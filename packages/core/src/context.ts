import { createResourceLookup } from './resource.js';
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
 *
 * Declared `async` so both synchronous throws and async rejections from `fn`
 * propagate as a rejected promise to the caller — matching the real
 * sink-writing implementation's error semantics.
 */
export const passthroughTrace: TraceFn = async <T>(
  _label: string,
  fn: () => T | Promise<T>
): Promise<T> => await fn();

const defaultCwd = (): string =>
  typeof process === 'undefined' ? '/' : process.cwd();

const defaultEnv = (): Record<string, string | undefined> =>
  typeof process === 'undefined'
    ? {}
    : (process.env as Record<string, string | undefined>);

const defaultRequestId = (): string =>
  typeof Bun === 'undefined' ? crypto.randomUUID() : Bun.randomUUIDv7();

/**
 * Create a TrailContext with sensible defaults.
 *
 * - `requestId` defaults to `Bun.randomUUIDv7()` (sortable v7 UUID), falling
 *   back to `crypto.randomUUID()` on runtimes without the `Bun` global
 * - `abortSignal` defaults to a fresh, non-aborted `AbortSignal`
 * - `cwd`/`env` default to the `process` globals when available, and to
 *   `'/'`/`{}` on runtimes without `process` (for example Cloudflare Workers)
 * - All other fields come from `overrides`
 */
export const createTrailContext = (
  overrides?: Partial<TrailContextInit>
): TrailContext => {
  const ctx = {
    abortSignal: new AbortController().signal,
    cwd: defaultCwd(),
    dryRun: false,
    env: defaultEnv(),
    requestId: defaultRequestId(),
    trace: passthroughTrace,
    ...overrides,
  } as MutableTrailContext;
  const lookup = overrides?.resource ?? createResourceLookup(() => ctx);
  ctx.resource = lookup;
  if (ctx.trace === undefined) {
    ctx.trace = passthroughTrace;
  }
  if (ctx.dryRun === undefined) {
    ctx.dryRun = false;
  }
  return ctx;
};
