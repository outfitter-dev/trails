import type { z } from 'zod';

import type { AnyTrail } from './trail.js';
import type { Implementation } from './types.js';

// ---------------------------------------------------------------------------
// Layer interface
// ---------------------------------------------------------------------------

/**
 * A composable, named layer that wraps implementations.
 *
 * Layers attach at trail, surface, or topo scope and may declare an object
 * `input` schema describing the configuration they need from the surrounding
 * surface. Surface packages (CLI, MCP, HTTP) render this schema onto their
 * native idioms — flags, tool parameters, query strings — alongside the
 * trail's own input schema.
 *
 * @remarks
 * The `input` schema is metadata for surface rendering. It must be an object
 * schema so every surface can render named fields consistently. It is
 * optional; layers without an `input` schema behave as plain wrappers. The
 * layer's `wrap` function is the runtime contract.
 */
export type LayerInputSchema = z.ZodObject<z.ZodRawShape>;

export interface Layer {
  readonly name: string;
  readonly description?: string | undefined;

  /**
   * Authored configuration the layer needs from the surrounding surface.
   *
   * Surface packages render this schema onto their native idioms (CLI flags,
   * MCP tool parameters, HTTP query strings) so a layer's input fields appear
   * alongside the trail's own input fields. Optional — layers that wrap purely
   * by behavior, with no surface-visible inputs, may omit it.
   *
   * @see TRL-473 for CLI flag rendering.
   * @see TRL-474 for MCP and HTTP rendering.
   */
  readonly input?: LayerInputSchema | undefined;

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
