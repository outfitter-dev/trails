/**
 * Headless trail execution without mounting a trailhead.
 *
 * Looks up a trail by ID in a topo, then delegates to `executeTrail`.
 * Returns a `Result` and never throws.
 */

import type { Topo } from './topo.js';
import { executeTrail } from './execute.js';
import type { ExecuteTrailOptions } from './execute.js';
import { NotFoundError } from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options forwarded to `executeTrail` from `run`. */
export type RunOptions = ExecuteTrailOptions;

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

/**
 * Execute a trail by ID from a topo without mounting a trailhead.
 *
 * Resolves the trail from the topo, then runs it through the standard
 * `executeTrail` pipeline with `topo` threaded so `ctx.fire()` is bound
 * to the producer's context inside `executeTrail`. Returns
 * `Result.err(NotFoundError)` if the trail ID is not registered. Never
 * throws — unexpected exceptions are returned as `Result.err(InternalError)`.
 *
 * @example
 * ```typescript
 * const result = await run(myTopo, 'greet', { name: 'Alice' });
 * if (result.isOk()) console.log(result.value);
 * ```
 */
export const run = (
  topo: Topo,
  id: string,
  input: unknown,
  options?: RunOptions
): Promise<Result<unknown, Error>> => {
  const trail = topo.get(id);
  if (trail === undefined) {
    return Promise.resolve(
      Result.err(
        new NotFoundError(`Trail "${id}" not found in topo "${topo.name}"`)
      )
    );
  }
  return executeTrail(trail, input, { ...options, topo });
};
