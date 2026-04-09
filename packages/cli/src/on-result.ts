/**
 * Default result handler for CLI commands.
 */

import type { ActionResultContext } from './build.js';
import { output, resolveOutputMode } from './output.js';

// ---------------------------------------------------------------------------
// defaultOnResult
// ---------------------------------------------------------------------------

/**
 * The batteries-included result handler.
 *
 * - On error: throws the error (lets the program's error handler produce exit code)
 * - On success: resolves output mode from flags, pipes value through `output()`
 */
export const defaultOnResult = async (
  ctx: ActionResultContext
): Promise<void> => {
  if (ctx.result.isErr()) {
    throw ctx.result.error;
  }

  const { mode } = resolveOutputMode(ctx.flags, ctx.topoName);
  await output(ctx.result.value, mode);
};
