/**
 * Permit resolution for the network surfaces.
 *
 * Public reads (`permit: 'public'`) need no auth. Admin trails require the
 * bearer token from `LOOKOUT_ADMIN_TOKEN`; without a matching token the
 * request carries no permit and permit-gated trails reject.
 */

import { Result } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';

const ADMIN_PERMIT: BasePermit = {
  id: 'lookout-admin',
  scopes: ['lookout:admin'],
};

export const resolveTokenPermit = (
  token: string | undefined
): Result<BasePermit | null, Error> => {
  const adminToken = process.env['LOOKOUT_ADMIN_TOKEN'];
  if (token !== undefined && adminToken !== undefined && token === adminToken) {
    return Result.ok(ADMIN_PERMIT);
  }
  return Result.ok(null);
};

export const resolveHttpPermit = (input: {
  readonly bearerToken?: string | undefined;
}): Result<BasePermit | null, Error> => resolveTokenPermit(input.bearerToken);
