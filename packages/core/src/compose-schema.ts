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
 * When the target trail declares `composeInput`, validates the merged object
 * fields and both object rules, or intersects non-object schemas. Returns
 * `undefined` when no `composeInput` is declared, signaling that normal input
 * validation suffices.
 *
 * @remarks
 * Object inputs produce a validation wrapper, not a `ZodObject`. Unlike the
 * previous merged object, it has no `.shape` or object-schema methods. Inspect
 * the unchanged authored `trailDef.input` and `trailDef.composeInput` schemas
 * instead.
 */
export const buildComposeValidationSchema = (
  trailDef: AnyTrail
): z.ZodType | undefined => {
  if (!trailDef.composeInput) {
    return undefined;
  }
  if (
    trailDef.input instanceof z.ZodObject &&
    trailDef.composeInput instanceof z.ZodObject
  ) {
    const selected = {
      ...trailDef.input.shape,
      ...trailDef.composeInput.shape,
    };
    const delegated = Object.fromEntries(
      Object.keys(selected).map((key) => [key, z.any().optional()])
    );
    // Parse selected fields once with the right object's unknown-key policy,
    // then retain the left object's rules on the materialized merged input.
    return trailDef.composeInput
      .safeExtend(selected)
      .pipe(trailDef.input.safeExtend(delegated).passthrough());
  }
  return z.intersection(trailDef.input, trailDef.composeInput);
};
