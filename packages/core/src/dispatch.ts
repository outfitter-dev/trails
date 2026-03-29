/**
 * Headless trail execution — the "no-surface" surface.
 *
 * Looks up a trail by ID in a topo, then delegates to `executeTrail`.
 * Returns a `Result` and never throws.
 */

import type { Topo } from './topo.js';
import type { TrailContext } from './types.js';
import type { Layer } from './layer.js';
import { executeTrail } from './execute.js';
import { NotFoundError } from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options forwarded to `executeTrail` from `dispatch`. */
export interface DispatchOptions {
  /** Partial context overrides merged on top of the base context. */
  readonly ctx?: Partial<TrailContext> | undefined;
  /** AbortSignal override (takes final precedence over ctx and factory). */
  readonly signal?: AbortSignal | undefined;
  /** Layers to compose around the implementation. */
  readonly layers?: readonly Layer[] | undefined;
  /** Factory that produces a base TrailContext (takes precedence over defaults). */
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
}

// ---------------------------------------------------------------------------
// dispatch()
// ---------------------------------------------------------------------------

/**
 * Execute a trail by ID from a topo without mounting a surface.
 *
 * Resolves the trail from the topo, then runs it through the standard
 * `executeTrail` pipeline. Returns `Result.err(NotFoundError)` if the
 * trail ID is not registered. Never throws — unexpected exceptions are
 * returned as `Result.err(InternalError)`.
 *
 * @example
 * ```typescript
 * const result = await dispatch(myTopo, 'greet', { name: 'Alice' });
 * if (result.isOk()) console.log(result.value);
 * ```
 */
export const dispatch = (
  topo: Topo,
  id: string,
  input: unknown,
  options?: DispatchOptions
): Promise<Result<unknown, Error>> => {
  const trail = topo.get(id);
  if (trail === undefined) {
    return Promise.resolve(
      Result.err(
        new NotFoundError(`Trail "${id}" not found in topo "${topo.name}"`)
      )
    );
  }
  return executeTrail(trail, input, options);
};
