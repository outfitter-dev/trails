import { Result, ValidationError, basePermitSchema } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';

const permitIdentitySchema = basePermitSchema.pick({
  id: true,
  issuer: true,
  tenantId: true,
});

/**
 * Derive a stable issuer-qualified subject key without guessing a namespace.
 *
 * The JSON tuple preserves exact issuer/subject/tenant strings and cannot collide
 * through separators in their values. An absent tenant is encoded as null;
 * an absent issuer fails even though issuerless local execution is supported.
 * Actor identity and authority are separate from the permit subject's key.
 *
 * @example
 * const key = derivePermitIdentityKey({ issuer: 'https://issuer.example', id: 'subject-1' });
 */
export const derivePermitIdentityKey = (
  permit: Pick<BasePermit, 'id' | 'issuer' | 'tenantId'>
): Result<string, ValidationError> => {
  const parsed = permitIdentitySchema.safeParse(permit);
  if (!parsed.success) {
    return Result.err(new ValidationError('Invalid permit identity'));
  }
  const { id, issuer, tenantId } = parsed.data;
  if (issuer === undefined) {
    return Result.err(
      new ValidationError('A stable permit identity requires an issuer')
    );
  }
  return Result.ok(JSON.stringify([issuer, id, tenantId ?? null]));
};
