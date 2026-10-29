import { describe, expect, test } from 'bun:test';
import { AuthError, PermitError, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes } from '../build.js';
import type { ResolveHttpPermitInput } from '../build.js';
import { createFetchHandler } from '../fetch.js';

const permit = { actors: [], id: 'org-42', scopes: ['records:read'] };

const fixture = (protectedTrail = false) => {
  const calls: string[] = [];
  const read = trail('record.read', {
    implementation: (_input, ctx) => {
      calls.push('execute');
      return Result.ok({ id: ctx.permit?.id ?? 'anonymous' });
    },
    input: z.object({}),
    intent: 'read',
    output: z.object({ id: z.string() }),
    permit: protectedTrail ? { scopes: ['records:read'] } : 'public',
  });
  return { app: topo('credential-http', { read }), calls };
};

describe('HTTP credential candidates', () => {
  test('normalizes API-key headers and raw Authorization on public and protected trails', async () => {
    for (const protectedTrail of [false, true]) {
      const { app, calls } = fixture(protectedTrail);
      let observed: ResolveHttpPermitInput | undefined;
      const routes = deriveHttpRoutes(app, {
        resolvePermit: (input) => {
          observed = input;
          return Result.ok(permit);
        },
      }).unwrap();
      const result = await routes[0]?.execute({}, 'request-key', undefined, {
        headers: {
          Authorization: 'org-key',
          'X-Api-Key': 'key',
          'x-auth-token': 'other',
        },
      });
      expect(result?.unwrap()).toEqual({ id: 'org-42' });
      expect(observed).toMatchObject({
        apiKey: 'key',
        authToken: 'other',
        authorization: 'org-key',
        requestId: 'request-key',
      });
      expect(observed?.bearerToken).toBeUndefined();
      expect(calls).toEqual(['execute']);
    }
  });

  test('calls configured policy once even without credentials; null remains anonymous or denied', async () => {
    for (const protectedTrail of [false, true]) {
      const { app, calls } = fixture(protectedTrail);
      let resolutions = 0;
      const routes = deriveHttpRoutes(app, {
        resolvePermit: () => {
          resolutions += 1;
          return Result.ok(null);
        },
      }).unwrap();
      const result = await routes[0]?.execute({});
      expect(resolutions).toBe(1);
      if (protectedTrail) {
        expect(result?.isErr()).toBe(true);
        if (result?.isErr()) {
          expect(result.error).toBeInstanceOf(PermitError);
        }
        expect(calls).toEqual([]);
      } else {
        expect(result?.unwrap()).toEqual({ id: 'anonymous' });
      }
    }
  });

  test('lets explicit key policy ignore an untrusted Authorization candidate', async () => {
    const { app } = fixture();
    const routes = deriveHttpRoutes(app, {
      resolvePermit: (input) =>
        input.apiKey === 'trusted'
          ? Result.ok(permit)
          : Result.err(new AuthError('Selected key invalid')),
    }).unwrap();
    const result = await routes[0]?.execute({}, undefined, undefined, {
      headers: new Headers({ authorization: 'Bearer', 'x-api-key': 'trusted' }),
    });
    expect(result?.unwrap()).toEqual({ id: 'org-42' });
  });

  test('propagates selected-credential failure before a public implementation', async () => {
    const { app, calls } = fixture();
    const routes = deriveHttpRoutes(app, {
      resolvePermit: () => Result.err(new AuthError('Selected key invalid')),
    }).unwrap();
    const result = await routes[0]?.execute({}, undefined, undefined, {
      headers: { 'x-api-key': 'invalid', 'x-auth-token': 'valid-alternate' },
    });
    expect(result?.isErr()).toBe(true);
    expect(calls).toEqual([]);
  });

  test('ignores query-string credentials on the actual Fetch surface', async () => {
    const { app } = fixture();
    let observed: ResolveHttpPermitInput | undefined;
    const handler = createFetchHandler(app, {
      resolvePermit: (input) => {
        observed = input;
        return Result.ok(null);
      },
    });
    const response = await handler(
      new Request(
        'https://example.test/record/read?api_key=secret&x-api-key=secret&access_token=secret&authorization=secret'
      )
    );
    expect(response.status).toBe(200);
    expect(observed?.apiKey).toBeUndefined();
    expect(observed?.authToken).toBeUndefined();
    expect(observed?.authorization).toBeUndefined();
    expect(observed?.bearerToken).toBeUndefined();
  });
});
