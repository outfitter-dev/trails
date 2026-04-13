/**
 * Structural accessor protocol used by `deriveTrail()` to synthesize default
 * blazes for standard CRUD operations without depending on `@ontrails/store`.
 *
 * @remarks
 * This type is intentionally minimal and structural. `@ontrails/store`'s
 * `StoreAccessor` / `StoreTableAccessor` interfaces satisfy this protocol
 * through a compile-time extends check (see `packages/store/src/types.ts`).
 * Keeping the protocol in core avoids a core → store dependency while still
 * allowing the derivation helper to call accessors by convention.
 *
 * Required methods (`get`, `list`, `upsert`, `remove`) match the
 * connector-agnostic write contract every bound store must expose. Optional
 * methods (`insert`, `update`) are declared by tabular connectors that
 * distinguish create-only and patch-only operations from the generalized
 * `upsert` contract.
 */
export interface StoreAccessorProtocol<
  TInput,
  TEntity,
  TId,
  TFilters = unknown,
> {
  /** Retrieve a single entity by identity. Returns `null` when not found. */
  get(id: TId): Promise<TEntity | null>;
  /** List entities, optionally filtered. Returns `[]` when no rows match. */
  list(filters?: TFilters): Promise<readonly TEntity[]>;
  /** Create-or-replace one entity using the connector-agnostic contract. */
  upsert(input: TInput): Promise<TEntity>;
  /**
   * Remove an entity by identity. Returns `{ deleted: true }` when the row
   * was found and removed, `{ deleted: false }` when no matching row
   * existed (not an error).
   */
  remove(id: TId): Promise<{ readonly deleted: boolean }>;
  /**
   * Optional insert — available on tabular connectors that distinguish
   * create from update. When absent, synthesized blazes fall back to
   * `upsert`.
   */
  insert?(input: TInput): Promise<TEntity>;
  /**
   * Optional patch-by-identity — available on tabular connectors. Returns
   * `null` when no row with the given identity exists. When absent,
   * synthesized update blazes fall back to `get` + merge + `upsert`.
   */
  update?(id: TId, patch: Partial<TInput>): Promise<TEntity | null>;
}

/**
 * Record shape returned by a resource's `from(ctx)` call, keyed by accessor
 * name. Used by `deriveTrail()` to resolve an accessor by contour name.
 */
export type StoreAccessorRecord = Readonly<
  Record<string, StoreAccessorProtocol<unknown, unknown, unknown, unknown>>
>;
