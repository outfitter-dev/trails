/**
 * Cross-invocation schema merging for trails with `crossInput`.
 *
 * When a trail declares `crossInput`, callers via `ctx.cross()` pass both
 * public input and composition-only fields. The merged schema validates the
 * combined shape so `executeTrail` doesn't reject the extra fields.
 */

import { z } from 'zod';

import type { AnyTrail } from './trail.js';

/**
 * Build the validation schema for a cross-invoked trail.
 *
 * When the target trail declares `crossInput`, returns the intersection of
 * `trail.input` and `trail.crossInput`. Returns `undefined` when no
 * `crossInput` is declared, signaling that normal input validation suffices.
 */
export const buildCrossValidationSchema = (
  trailDef: AnyTrail
): z.ZodType | undefined => {
  if (!trailDef.crossInput) {
    return undefined;
  }
  // Prefer .merge() for ZodObject pairs — produces a proper merged object
  // schema that strips unknown keys and exposes .shape. Fall back to
  // z.intersection for non-object schemas.
  if (
    trailDef.input instanceof z.ZodObject &&
    trailDef.crossInput instanceof z.ZodObject
  ) {
    return trailDef.input.merge(trailDef.crossInput);
  }
  return z.intersection(trailDef.input, trailDef.crossInput);
};
