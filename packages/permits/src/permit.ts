import { basePermitSchema } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';
import { z } from 'zod';

/** The resolved identity and scopes from a successful authentication. */
export interface Permit extends BasePermit {
  readonly roles?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Validate the full adapter-owned permit without dropping identity evidence.
 *
 * @example
 * const permit = permitSchema.parse({ actors: [], id: 'subject', scopes: [] });
 */
export const permitSchema = basePermitSchema.extend({
  metadata: z.record(z.string(), z.unknown()).readonly().optional(),
  roles: z.array(z.string()).readonly().optional(),
}) satisfies z.ZodType<Permit>;

/**
 * Type-safe accessor for `ctx.permit` with a downcast to `Permit`.
 *
 * `TrailContext.permit` carries the shared identity and scope evidence. The
 * validated auth boundary retains optional adapter annotations; trusted hosts
 * may supply only the base fields, in which case those annotations are absent.
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
