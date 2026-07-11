import {
  InternalError,
  ValidationError,
  entity,
  isTrailsError,
} from '@ontrails/core';
import type { Entity } from '@ontrails/core';
import type { z } from 'zod';

import type { AnyStoreTable } from '../types.js';

/**
 * The entity type produced by {@link createTableEntity} for a given store
 * table. Threads the table's name, schema shape, and identity through the
 * entity generics so downstream `deriveTrail()` calls project concrete
 * input/output types instead of widening back to
 * `Entity<string, z.ZodRawShape, string>` (the `AnyEntity` alias).
 */
export type TableEntity<TTable extends AnyStoreTable> = Entity<
  TTable['name'],
  TTable['schema']['shape'],
  Extract<TTable['identity'], keyof TTable['schema']['shape'] & string>
>;

/**
 * Build the shape used when deriving an entity view of a store table.
 *
 * Entity validates every example against the shape passed in, so the shape
 * must match how fixtures are actually shaped. Store fixtures may omit
 * framework-generated fields (`createdAt`, `version`, ...) because the
 * adapter populates them, so we mirror `fixtureSchema`'s treatment of
 * generated fields: generated, non-identity fields are made optional; the
 * identity field stays required because read/delete/update all derive their
 * input from it. Previously reconcile.ts and sync.ts passed
 * `table.schema.shape` directly and crashed when a fixture omitted
 * `createdAt` or another generated field.
 */
export const buildEntityShape = (
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
 * Derive an entity view of a store table.
 *
 * Both `sync` and `reconcile` use this helper so they pick up the
 * fixture-shape treatment (generated fields optional).
 *
 * @remarks
 * Intentionally not cached. `entity()` brands the identity schema via
 * `Object.defineProperty(..., { writable: false })`, and re-invoking on a
 * schema that's already been branded throws TypeError. Factory call sites
 * already build the entity once per trail instance, so rebuilding on a
 * warm call is cheap and side-effect-free.
 */
export const createTableEntity = <TTable extends AnyStoreTable>(
  table: TTable
): TableEntity<TTable> =>
  entity(table.name, buildEntityShape(table), {
    examples: table.fixtures as readonly Record<string, unknown>[],
    identity: table.identity,
  }) as TableEntity<TTable>;

/** Reject the retired store-factory option instead of silently ignoring it. */
export const assertCurrentEntityOption = (
  value: unknown,
  owner: string
): void => {
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, 'contour')
  ) {
    throw new ValidationError(
      `${owner} uses retired "contour"; use "entity" instead`
    );
  }
};

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
