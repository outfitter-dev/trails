import {
  Result,
  basePermitSchema,
  isPlainObject,
  permitActorSchema,
} from '@ontrails/core';
import type { PermitActor } from '@ontrails/core';
import { z } from 'zod';

import type { AuthError } from './adapter.js';
import type { Permit } from '../permit.js';

type JwtIdentity = Pick<Permit, 'actors' | 'expiresAt' | 'issuer'>;

const identityClaimsSchema = basePermitSchema.pick({
  expiresAt: true,
  issuer: true,
});
const clientClaimsSchema = z.object({
  azp: z.string().min(1).optional(),
  client_id: z.string().min(1).optional(),
});
const invalidIdentity = (message: string): Result<never, AuthError> =>
  Result.err({ code: 'invalid_token', message });

/** Derive identity only after the credential signature and standard claims validate. */
export const deriveJwtIdentity = (
  payload: Readonly<Record<string, unknown>>
): Result<JwtIdentity, AuthError> => {
  const { exp } = payload;
  const claims = identityClaimsSchema.safeParse({
    expiresAt: typeof exp === 'number' ? exp * 1000 : exp,
    issuer: payload['iss'],
  });
  if (!claims.success) {
    return invalidIdentity('Invalid JWT identity or expiration claims');
  }

  const clients = clientClaimsSchema.safeParse(payload);
  if (!clients.success) {
    return invalidIdentity('Invalid client identity claim');
  }
  const { azp: authorizedParty, client_id: clientId } = clients.data;

  const actors: PermitActor[] = [];
  if (Object.hasOwn(payload, 'act')) {
    // This is parsed JWT JSON: nesting is finite and cannot contain object cycles.
    let current: unknown = payload['act'];
    for (;;) {
      if (!isPlainObject(current)) {
        return invalidIdentity('Invalid actor claim');
      }
      const actor = permitActorSchema.safeParse({
        id: current['sub'],
        issuer: current['iss'],
        kind: current['kind'] === undefined ? 'unknown' : current['kind'],
        // Signature provenance owns this value; act.verified is never trusted.
        verified: true,
      });
      if (!actor.success) {
        return invalidIdentity('Invalid actor identity claim');
      }
      actors.push(actor.data);
      if (!Object.hasOwn(current, 'act')) {
        break;
      }
      current = current['act'];
    }
  } else {
    // A bounded generic profile: no precedence is guessed between unequal aliases.
    if (
      clientId !== undefined &&
      authorizedParty !== undefined &&
      clientId !== authorizedParty
    ) {
      return invalidIdentity('Conflicting client identity claims');
    }
    const client = clientId ?? authorizedParty;
    if (client !== undefined) {
      actors.push({ id: client, kind: 'client', verified: true });
    }
  }

  const { expiresAt, issuer } = claims.data;
  return Result.ok({
    actors,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(issuer === undefined ? {} : { issuer }),
  });
};
