import type { BasePermit } from '@ontrails/core';

/** The resolved identity and scopes from a successful authentication. */
export interface Permit extends BasePermit {
  readonly roles?: readonly string[];
  readonly tenantId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Type-safe accessor for `ctx.permit` with a downcast to `Permit`.
 *
 * `TrailContext.permit` is typed as `BasePermit` (id + scopes). This accessor
 * returns the full `Permit` when the auth gate has set one. Safe because
 * the auth gate is the only writer and always sets a full `Permit`.
 *
 * @example
 * ```typescript
 * const permit = getPermit(ctx);
 * if (permit) {
 *   console.log(permit.roles, permit.tenantId);
 * }
 * ```
 */
export const getPermit = (ctx: { permit?: BasePermit }): Permit | undefined =>
  ctx.permit === undefined ? undefined : (ctx.permit as Permit);
