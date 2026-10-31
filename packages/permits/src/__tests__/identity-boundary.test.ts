import { describe, expect, test } from 'bun:test';
import { Result, executeTrail, topo } from '@ontrails/core';

import { resolvePermitFromInput } from '../boundary.js';
import { authVerify } from '../trails/auth-verify.js';

const permit = {
  actors: [
    {
      id: 'client',
      issuer: 'https://client.example',
      kind: 'client',
      verified: true,
    },
  ],
  expiresAt: 2_000_000_000_125,
  id: 'subject',
  issuer: 'https://issuer.example',
  metadata: { label: 'provider-mapped' },
  roles: ['reader'],
  scopes: ['entry:read'],
  tenantId: 'tenant',
};
const resources = { auth: { authenticate: async () => Result.ok(permit) } };

describe('full permit evidence boundary', () => {
  test('retains identity and adapter annotations through normalized authentication', async () => {
    const result = await resolvePermitFromInput({
      apiKey: 'opaque',
      graph: topo('identity-boundary'),
      requestId: 'request',
      resources,
      surface: 'http',
    });
    expect(result.unwrap()).toEqual(permit);
  });

  test('renders the same evidence from auth.verify instead of dropping new fields', async () => {
    const result = await executeTrail(
      authVerify,
      { token: 'opaque' },
      { resources }
    );
    expect(result.unwrap()).toEqual({ permit, valid: true });
  });

  test('rejects malformed actor output at both existing adapter boundaries', async () => {
    const malformed = {
      auth: {
        authenticate: async () =>
          Result.ok({
            ...permit,
            actors: [{ id: 'actor', kind: 'agent', verified: 'true' }],
          }),
      },
    };
    const normalized = await resolvePermitFromInput({
      graph: topo('identity-boundary'),
      requestId: 'request',
      resources: malformed,
      surface: 'http',
    });
    expect(normalized.isErr()).toBe(true);
    const verified = await executeTrail(
      authVerify,
      { token: 'opaque' },
      { resources: malformed }
    );
    expect(verified.unwrap()).toMatchObject({
      errorCode: 'invalid_token',
      valid: false,
    });
  });
});
