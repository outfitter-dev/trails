import { z } from 'zod';

/** Identity and provenance of an acting party, current actor first in a chain. */
export interface PermitActor {
  readonly id: string;
  /** Actor identity namespace, distinct from the permit's attesting issuer. */
  readonly issuer?: string | undefined;
  /** Open classification; unknown is not evidence of a human actor. */
  readonly kind: string;
  /** Set by a trusted adapter from validated evidence, never caller assertion. */
  readonly verified: boolean;
}

/**
 * Validate actor shape without inferring its namespace or provenance.
 *
 * @example
 * const actor = permitActorSchema.parse({ id: 'client-1', kind: 'client', verified: true });
 */
export const permitActorSchema = z
  .object({
    id: z.string().min(1),
    issuer: z.string().min(1).optional(),
    kind: z.string().min(1),
    verified: z.boolean(),
  })
  .readonly() satisfies z.ZodType<PermitActor>;

/** Permit evidence available on TrailContext; absence of issuer/expiry is unknown. */
export interface BasePermit {
  /** Explicitly authored evidence; [] means no known acting party. */
  readonly actors: readonly PermitActor[];
  /** Actual credential deadline in finite Unix epoch milliseconds, without skew. */
  readonly expiresAt?: number | undefined;
  readonly id: string;
  /** Permit attester; local execution may have no globally qualified identity. */
  readonly issuer?: string | undefined;
  readonly scopes: readonly string[];
  readonly tenantId?: string | undefined;
}

export const basePermitSchema = z.object({
  actors: z.array(permitActorSchema).readonly(),
  expiresAt: z.number().finite().optional(),
  id: z.string(),
  issuer: z.string().min(1).optional(),
  scopes: z.array(z.string()).readonly(),
  tenantId: z.string().optional(),
}) satisfies z.ZodType<BasePermit>;
