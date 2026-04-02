import type { Trail } from './trail.js';
import type { Implementation } from './types.js';

// ---------------------------------------------------------------------------
// Gate interface
// ---------------------------------------------------------------------------

/** A composable gate that wraps trail implementations. */
export interface Gate {
  readonly name: string;
  readonly description?: string | undefined;

  /** Wrap a trail's implementation, returning a new implementation. */
  wrap<I, O>(
    trail: Trail<I, O>,
    implementation: Implementation<I, O>
  ): Implementation<I, O>;
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Apply gates outermost-first: gates[0] wraps gates[1] wraps ... wraps
 * the base implementation.
 *
 * An empty gates array returns the implementation unchanged.
 */
export const composeGates = <I, O>(
  gates: readonly Gate[],
  trail: Trail<I, O>,
  implementation: Implementation<I, O>
): Implementation<I, O> => {
  // Fold right so gates[0] is the outermost wrapper.
  let result = implementation;
  for (let i = gates.length - 1; i >= 0; i -= 1) {
    const gate = gates[i];
    if (gate) {
      result = gate.wrap(trail, result);
    }
  }
  return result;
};
