import type { AnyTrail } from './trail.js';
import type { Implementation } from './types.js';

// ---------------------------------------------------------------------------
// Layer interface
// ---------------------------------------------------------------------------

/** A composable layer that wraps trail implementations. */
export interface Layer {
  readonly name: string;
  readonly description?: string | undefined;

  /**
   * Wrap a trail's implementation, returning a new implementation.
   *
   * The trail is passed for metadata inspection (intent, schema, etc.).
   * The implementation and return type are generic over the input/output
   * types so layers remain type-safe when composed.
   */
  wrap<I, O>(
    trail: AnyTrail,
    implementation: Implementation<I, O>
  ): Implementation<I, O>;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Apply layers outermost-first: layers[0] wraps layers[1] wraps ... wraps
 * the base implementation.
 *
 * An empty layers array returns the implementation unchanged.
 */
export const composeLayers = <I, O>(
  layers: readonly Layer[],
  trail: AnyTrail,
  implementation: Implementation<I, O>
): Implementation<I, O> => {
  // Fold right so layers[0] is the outermost wrapper.
  let result = implementation;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer) {
      result = layer.wrap(trail, result);
    }
  }
  return result;
};
