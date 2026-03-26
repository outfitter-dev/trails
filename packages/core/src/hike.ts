/**
 * Hike — a composition that follows trails.
 */

import type { Trail, TrailSpec } from './trail.js';
import type { TrailContext } from './types.js';

// ---------------------------------------------------------------------------
// Spec (input to the factory)
// ---------------------------------------------------------------------------

export interface HikeSpec<I, O> extends TrailSpec<I, O> {
  readonly follows: readonly string[];
}

// ---------------------------------------------------------------------------
// Shape (output of the factory)
// ---------------------------------------------------------------------------

export interface Hike<I, O> extends Omit<Trail<I, O>, 'kind'> {
  readonly kind: 'hike';
  readonly follows: readonly string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a hike definition.
 *
 * A hike is a composition that declares which trails it follows.
 * Returns a frozen object with `kind: "hike"` and all spec fields.
 *
 * @example
 * ```typescript
 * // ID as first argument
 * const onboard = hike("entity.onboard", {
 *   follows: ["entity.add", "entity.relate"],
 *   input: z.object({ name: z.string() }),
 *   implementation: (input, ctx) => Result.ok(...),
 * });
 *
 * // Full spec object (programmatic)
 * const onboard = hike({ id: "entity.onboard", follows: [...], ... });
 * ```
 */
export function hike<I, O>(id: string, spec: HikeSpec<I, O>): Hike<I, O>;
export function hike<I, O>(
  spec: HikeSpec<I, O> & { readonly id: string }
): Hike<I, O>;
export function hike<I, O>(
  idOrSpec: string | (HikeSpec<I, O> & { readonly id: string }),
  maybeSpec?: HikeSpec<I, O>
): Hike<I, O> {
  const resolved =
    typeof idOrSpec === 'string'
      ? { id: idOrSpec, spec: maybeSpec }
      : { id: idOrSpec.id, spec: idOrSpec };

  if (!resolved.spec) {
    throw new TypeError('hike() requires a spec when an id is provided');
  }

  const { follows, implementation, ...rest } = resolved.spec;
  return Object.freeze({
    ...rest,
    follows: Object.freeze([...follows]),
    id: resolved.id,
    implementation: async (input: I, ctx: TrailContext) =>
      await implementation(input, ctx),
    kind: 'hike' as const,
  });
}

// oxlint-disable-next-line no-explicit-any -- existential type; see AnyTrail
export type AnyHike = Hike<any, any>;
