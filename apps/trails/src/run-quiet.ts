/**
 * CLI-surface bridge for the `run` trail's `--quiet` flag.
 *
 * The `run` trail returns an `inner-trail-result` envelope as the `value` of
 * its own outer `Result.ok(...)`. The default CLI on-result handler unwraps
 * once, leaving stdout as `{ "kind": "inner-trail-result", "trailId": "...",
 * "value": ... }` — useful when a caller wants provenance, but noisy when the
 * caller only wants the inner value to feed downstream pipes.
 *
 * `--quiet` strips that envelope:
 *
 * - Inner result envelope → write the inner value to stdout via the resolved
 *   output mode.
 *
 * Errors at the outer layer (the run trail itself failing — `NotFoundError`,
 * `AmbiguousError`, `ValidationError` from input) are unaffected by `--quiet`:
 * we always defer to the supplied default handler so collision-recovery and
 * the existing error surface stay intact.
 */

import type { ActionResultContext } from '@ontrails/cli';
import { deriveOutputMode, output } from '@ontrails/cli';

import { INNER_TRAIL_RESULT_KIND } from './trails/run.js';

interface InnerTrailResultEnvelope {
  readonly kind: typeof INNER_TRAIL_RESULT_KIND;
  readonly trailId: string;
  readonly value: unknown;
}

const isInnerTrailResultEnvelope = (
  value: unknown
): value is InnerTrailResultEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  (value as { readonly kind?: unknown }).kind === INNER_TRAIL_RESULT_KIND &&
  typeof (value as { readonly trailId?: unknown }).trailId === 'string' &&
  'value' in value;

const isQuietRunCtx = (ctx: ActionResultContext): boolean =>
  ctx.trail.id === 'run' && ctx.flags['quiet'] === true;

/**
 * Return value:
 * - `false` — `--quiet` did not apply; caller should fall through to its
 *   default handler.
 * - `true` — `--quiet` handled the result and wrote output. Caller should not
 *   invoke the default handler.
 *
 */
export const tryQuietRunOutput = async (
  ctx: ActionResultContext
): Promise<boolean> => {
  if (!isQuietRunCtx(ctx)) {
    return false;
  }

  // Outer Err on the run trail (collision, not-found, validation) is not in
  // scope for --quiet: defer to the default handler so existing exit-code
  // mapping and recovery hooks stay intact.
  if (ctx.result.isErr()) {
    return false;
  }

  const inner: unknown = ctx.result.value;
  if (!isInnerTrailResultEnvelope(inner)) {
    return false;
  }

  const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);
  const value = inner.value === undefined ? null : inner.value;
  output(value, mode);
  return true;
};
