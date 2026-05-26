/**
 * Compose-invocation schema merging for trails with `composeInput`.
 *
 * When a trail declares `composeInput`, callers via `ctx.compose()` pass both
 * public input and composition-only fields. The merged schema validates the
 * combined shape so `executeTrail` doesn't reject the extra fields.
 */

import { z } from 'zod';

import type { AnyTrail } from './trail.js';

/**
 * Build the validation schema for a compose-invoked trail.
 *
 * When the target trail declares `composeInput`, returns the intersection of
 * `trail.input` and `trail.composeInput`. Returns `undefined` when no
 * `composeInput` is declared, signaling that normal input validation suffices.
 */
export const buildComposeValidationSchema = (
  trailDef: AnyTrail
): z.ZodType | undefined => {
  if (!trailDef.composeInput) {
    return undefined;
  }
  // Prefer .merge() for ZodObject pairs — produces a proper merged object
  // schema that strips unknown keys and exposes .shape. Fall back to
  // z.intersection for non-object schemas.
  if (
    trailDef.input instanceof z.ZodObject &&
    trailDef.composeInput instanceof z.ZodObject
  ) {
    return trailDef.input.merge(trailDef.composeInput);
  }
  return z.intersection(trailDef.input, trailDef.composeInput);
};
