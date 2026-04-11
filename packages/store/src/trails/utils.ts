import { InternalError, contour, isTrailsError } from '@ontrails/core';
import type { AnyContour } from '@ontrails/core';
import type { z } from 'zod';

import type { AnyStoreTable } from '../types.js';

/**
 * Build the shape used when deriving a contour view of a store table.
 *
 * Contour validates every example against the shape passed in, so the shape
 * must match how fixtures are actually shaped. Store fixtures may omit
 * framework-generated fields (`createdAt`, `version`, ...) because the
 * connector populates them, so we mirror `fixtureSchema`'s treatment of
 * generated fields: generated, non-identity fields are made optional; the
 * identity field stays required because read/delete/update all derive their
 * input from it. Previously reconcile.ts and sync.ts passed
 * `table.schema.shape` directly and crashed when a fixture omitted
 * `createdAt` or another generated field.
 */
export const buildContourShape = (
  table: AnyStoreTable
): Record<string, z.ZodType> => {
  const shape = table.schema.shape as unknown as Record<string, z.ZodType>;
  const generatedNonIdentity = new Set(
    table.generated.filter((field) => field !== table.identity)
  );

  if (generatedNonIdentity.size === 0) {
    return shape;
  }

  const next: Record<string, z.ZodType> = {};
  for (const [field, fieldSchema] of Object.entries(shape)) {
    next[field] = generatedNonIdentity.has(field)
      ? fieldSchema.optional()
      : fieldSchema;
  }
  return next;
};

/**
 * Derive a contour view of a store table.
 *
 * Both `sync` and `reconcile` use this helper so they pick up the
 * fixture-shape treatment (generated fields optional).
 *
 * @remarks
 * Intentionally not cached. `contour()` brands the identity schema via
 * `Object.defineProperty(..., { writable: false })`, and re-invoking on a
 * schema that's already been branded throws TypeError. Factory call sites
 * already build the contour once per trail instance, so rebuilding on a
 * warm call is cheap and side-effect-free.
 */
export const createTableContour = <TTable extends AnyStoreTable>(
  table: TTable
): AnyContour =>
  contour(table.name, buildContourShape(table), {
    examples: table.fixtures as readonly Record<string, unknown>[],
    identity: table.identity,
  }) as AnyContour;

/**
 * Coerce an unknown thrown value into an Error instance, preserving the
 * original when possible.
 */
export const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Map a caught error into a `TrailsError` suitable for surfacing from a store
 * trail factory. Pass-through for errors already in the taxonomy; otherwise
 * wrap in an `InternalError` keyed by the trail id.
 */
export const mapStoreTrailError = (trailId: string, error: unknown): Error => {
  if (isTrailsError(error)) {
    return error;
  }

  const resolved = asError(error);
  return new InternalError(`${trailId} failed: ${resolved.message}`, {
    cause: resolved,
  });
};
