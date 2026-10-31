import { describe, expect, test } from 'bun:test';

import { createJwtAdapter } from '../adapters/jwt.js';
import { TEST_SECRET, signJwt } from './helpers/jwt.js';

const exp = 2_000_000_000.125;
const authenticate = async (claims: Record<string, unknown>) => {
  const token = await signJwt({ exp, sub: 'subject', ...claims }, TEST_SECRET);
  return createJwtAdapter({ secret: TEST_SECRET }).authenticate({
    bearerToken: token,
    requestId: 'identity',
    surface: 'http',
  });
};

describe('JWT identity evidence', () => {
  test('retains the exact attester and converts fractional NumericDate once to milliseconds', async () => {
    const result = await authenticate({ iss: 'https://Issuer.example' });
    expect(result.unwrap()).toEqual({
      actors: [],
      expiresAt: exp * 1000,
      id: 'subject',
      issuer: 'https://Issuer.example',
      scopes: [],
    });
  });

  test('maps a single client claim or equal aliases without inventing its namespace', async () => {
    for (const claims of [
      { client_id: 'client' },
      { azp: 'client' },
      { azp: 'client', client_id: 'client' },
    ]) {
      const result = await authenticate({
        iss: 'https://issuer.example',
        ...claims,
      });
      expect(result.unwrap()?.actors).toEqual([
        { id: 'client', kind: 'client', verified: true },
      ]);
    }
    const conflicting = await authenticate({ azp: 'other', client_id: 'one' });
    expect(conflicting.isErr()).toBe(true);
  });

  test('preserves current-first nested actors and independent actor namespaces', async () => {
    const result = await authenticate({
      act: {
        act: { sub: 'prior' },
        iss: 'https://actor.example',
        kind: 'agent',
        sub: 'current',
        verified: false,
      },
      azp: 'other',
      client_id: 'one',
      iss: 'https://attester.example',
    });
    expect(result.unwrap()?.actors).toEqual([
      {
        id: 'current',
        issuer: 'https://actor.example',
        kind: 'agent',
        verified: true,
      },
      { id: 'prior', kind: 'unknown', verified: true },
    ]);
  });

  test('rejects malformed recognized claims rather than dropping identity evidence', async () => {
    for (const act of [
      null,
      [],
      'actor',
      {},
      { sub: '' },
      { iss: '', sub: 'actor' },
      { kind: false, sub: 'actor' },
    ]) {
      const result = await authenticate({ act });
      expect(result.isErr()).toBe(true);
    }
    for (const client_id of [null, '', 42, {}]) {
      const result = await authenticate({ act: { sub: 'actor' }, client_id });
      expect(result.isErr()).toBe(true);
    }
    for (const iss of [null, '', 42]) {
      const result = await authenticate({ iss });
      expect(result.isErr()).toBe(true);
    }
  });

  test('rejects a finite wire expiration that overflows the millisecond deadline', async () => {
    const result = await authenticate({ exp: Number.MAX_VALUE });
    expect(result.isErr()).toBe(true);
  });

  test('leaves missing optional facts unknown and never promotes caller assertions', async () => {
    const token = await signJwt({ sub: 'local' }, TEST_SECRET);
    const result = await createJwtAdapter({
      requireExpiration: false,
      secret: TEST_SECRET,
    }).authenticate({
      bearerToken: token,
      headers: new Headers({ actor: 'caller-asserted' }),
      requestId: 'local',
      surface: 'http',
    });
    expect(result.unwrap()).toEqual({ actors: [], id: 'local', scopes: [] });
  });
});
