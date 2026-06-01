/**
 * Default result handler for CLI commands.
 */

import type { ActionResultContext } from './build.js';
import { output, deriveOutputMode } from './output.js';

// ---------------------------------------------------------------------------
// defaultOnResult
// ---------------------------------------------------------------------------

/**
 * The batteries-included result handler.
 *
 * - On error: throws at the CLI presentation boundary, where Commander maps
 *   the error to process output and an exit code.
 * - On success: resolves output mode from flags, pipes value through `output()`
 *
 * @remarks Trail logic should return `Result.err(...)` instead of throwing.
 * This host-boundary throw is intentionally outside trail execution.
 *
 * @example
 * ```ts
 * import { Result } from '@ontrails/core';
 * import { defaultOnResult, type ActionResultContext } from '@ontrails/cli';
 *
 * const ctx = {
 *   args: {},
 *   flags: { json: true },
 *   input: {},
 *   result: Result.ok({ id: 'example' }),
 *   topoName: 'demo',
 *   trail: { id: 'demo.example', kind: 'trail' },
 * } as ActionResultContext;
 *
 * await defaultOnResult(ctx);
 * ```
 */
export const defaultOnResult = async (
  ctx: ActionResultContext
): Promise<void> => {
  if (ctx.result.isErr()) {
    throw ctx.result.error;
  }

  // Iteration helpers (e.g. paginated `--all --jsonl`) may have already
  // streamed the items to stdout. Skip re-writing in that case.
  if (ctx.streamed) {
    return;
  }

  const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);
  await output(ctx.result.value, mode);
};
