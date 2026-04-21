/**
 * Internal helper for "forking" a trail context.
 *
 * Several execution sites need to derive a child context from a parent
 * context while **resetting** a well-known set of bound closures (`cross`,
 * `fire`, `resource`). Those closures capture the parent scope, so reusing
 * them on the child would re-enter execution with the wrong attribution,
 * the wrong resource scope, or the wrong fan-out identity. The reset list
 * is the same at every fork site.
 *
 * Codifying the reset list in one helper keeps that contract in a single
 * place. Callers supply the overrides they need (typically `env`,
 * `extensions`, and `logger`) and let the helper handle the reset.
 *
 * This module is internal — do not export it from the package entry point.
 *
 * @remarks
 * The helper is intentionally generic over the concrete context shape. Some
 * callers work with the fully-resolved `TrailContext` produced inside the
 * executor; others work with `Partial<TrailContextInit>` during consumer
 * context derivation in `fire.ts`. Both shapes share the same reset keys.
 */

import type { TrailContext, TrailContextInit } from '../types.js';

/** Keys cleared by default when forking a context. */
export type ForkCtxResetKey = 'cross' | 'fire' | 'resource';

/** Override fields callers are allowed to apply when forking a context. */
export type ForkCtxOverrides = Readonly<
  Partial<Pick<TrailContext, 'env' | 'extensions' | 'logger'>>
>;

const DEFAULT_RESET_KEYS: readonly ForkCtxResetKey[] = [
  'cross',
  'fire',
  'resource',
];

/**
 * Fork a parent context into a child context.
 *
 * Spreads the parent, clears each reset key to `undefined`, and applies the
 * supplied overrides last so callers may replace logger, env, and extensions
 * with branch-local values.
 *
 * The generic parameter is constrained to the minimal shape the helper
 * reads and writes. This lets the helper serve both `TrailContext`
 * (executor scope) and `Partial<TrailContextInit>` (fire-consumer scope)
 * without widening the public surface of either type.
 */
export const forkCtx = <
  TCtx extends Partial<
    Pick<
      TrailContextInit,
      'cross' | 'env' | 'extensions' | 'fire' | 'logger' | 'resource'
    >
  >,
>(
  parentCtx: TCtx,
  overrides: ForkCtxOverrides = {},
  reset: readonly ForkCtxResetKey[] = DEFAULT_RESET_KEYS
): TCtx => {
  const forked: TCtx = { ...parentCtx };
  for (const key of reset) {
    forked[key as keyof TCtx] = undefined as TCtx[keyof TCtx];
  }
  return { ...forked, ...overrides };
};
