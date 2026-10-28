import {
  afterEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test';

import { topo } from '@ontrails/core';
import { resolvePermitFromBearerToken } from '../boundary.js';
import { createJwtAdapter } from '../adapters/jwt.js';
import { authResource, authResourceConfigSchema } from '../auth-resource.js';
import { jwksFixture } from './helpers/jwks.js';

const input = (bearerToken: string) => ({
  bearerToken,
  requestId: 'jwks-test',
  surface: 'mcp' as const,
});

let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  fetchSpy?.mockRestore();
  setSystemTime();
});

const setup = async (algorithm: 'RS256' | 'ES256' | 'EdDSA' = 'RS256') => {
  const fixture = await jwksFixture(algorithm);
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(fixture.fetcher, { preconnect: fetch.preconnect })
  );
  const options = { audience: fixture.audience, issuer: fixture.issuer };
  return { ...fixture, adapter: createJwtAdapter(options), options };
};

describe('issuer JWT verification', () => {
  for (const algorithm of ['RS256', 'ES256', 'EdDSA'] as const) {
    test(`discovers and verifies ${algorithm} into today's Permit`, async () => {
      const { adapter, key, requests } = await setup(algorithm);
      const result = await adapter.authenticate(input(await key.sign()));
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        id: 'user-42',
        scopes: ['read', 'write'],
      });
      expect(requests).toHaveLength(2);
    });
  }

  test('uses RFC 8414 fallback with issuer path before fetching keys', async () => {
    const f = await setup();
    f.state.metadataStatus = 404;
    const outcome1 = await f.adapter.authenticate(input(await f.key.sign()));
    expect(outcome1.isOk()).toBe(true);
    expect(f.requests[1]).toContain('/.well-known/oauth-authorization-server/');
  });

  test('reuses keys and discovery across adapter instances and concurrent requests', async () => {
    const f = await setup();
    const token = await f.key.sign();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createJwtAdapter(f.options).authenticate(input(token))
      )
    );
    expect(results.every((r) => r.isOk())).toBe(true);
    expect(f.requests).toHaveLength(2);
  });

  test('refreshes keys for a rotated kid and throttles repeated misses', async () => {
    const f = await setup();
    const outcome2 = await f.adapter.authenticate(input(await f.key.sign()));
    expect(outcome2.isOk()).toBe(true);
    const rotated = await f.makeKey('second');
    f.state.keys = [rotated.jwk];
    const outcome3 = await f.adapter.authenticate(input(await rotated.sign()));
    expect(outcome3.isOk()).toBe(true);
    expect(f.requests).toHaveLength(3);
    const unknown = await f.makeKey('unknown');
    const outcome4 = await f.adapter.authenticate(input(await unknown.sign()));
    expect(outcome4.isErr()).toBe(true);
    const outcome5 = await f.adapter.authenticate(input(await unknown.sign()));
    expect(outcome5.isErr()).toBe(true);
    expect(f.requests).toHaveLength(3);
  });

  test('refreshes expired keys without using stale keys on failed refresh', async () => {
    const f = await setup();
    const token = await f.key.sign();
    const outcome6 = await f.adapter.authenticate(input(token));
    expect(outcome6.isOk()).toBe(true);
    setSystemTime(Date.now() + 301_000);
    f.state.keysStatus = 503;
    const outcome7 = await f.adapter.authenticate(input(token));
    expect(outcome7.isErr()).toBe(true);
    expect(f.requests).toHaveLength(4);
  });

  for (const [name, claims] of [
    ['issuer', { iss: 'https://wrong.example' }],
    ['audience', { aud: 'other-api' }],
    ['missing audience', { aud: undefined }],
    ['expiration', { exp: 1 }],
    ['missing expiration', { exp: undefined }],
    ['DPoP binding', { cnf: { jkt: 'thumbprint' } }],
    ['malformed confirmation', { cnf: null }],
    ['subject', { sub: 42 }],
  ] as const) {
    test(`rejects invalid ${name}`, async () => {
      const f = await setup('EdDSA');
      const outcome8 = await f.adapter.authenticate(
        input(await f.key.sign(claims))
      );
      expect(outcome8.isErr()).toBe(true);
    });
  }

  test('validates metadata issuer before trusting jwks_uri', async () => {
    const f = await setup();
    f.state.metadata.issuer = 'https://wrong.example';
    const outcome9 = await f.adapter.authenticate(input(await f.key.sign()));
    expect(outcome9.isErr()).toBe(true);
    expect(f.requests).toHaveLength(1);
  });

  test('maps configured scopes and roles and verifies array audiences', async () => {
    const f = await setup();
    const adapter = createJwtAdapter({
      ...f.options,
      rolesClaim: 'groups',
      scopesClaim: 'permissions',
    });
    const token = await f.key.sign({
      aud: ['other', f.audience],
      groups: ['admin'],
      permissions: ['read'],
    });
    const outcome10 = await adapter.authenticate(input(token));
    expect(outcome10.unwrap()).toEqual({
      id: 'user-42',
      roles: ['admin'],
      scopes: ['read'],
    });
  });

  test('supports explicit trusted JWKS endpoints without discovery', async () => {
    const f = await setup();
    const adapter = createJwtAdapter({ ...f.options, jwksUrl: f.jwksUrl });
    const outcome11 = await adapter.authenticate(input(await f.key.sign()));
    expect(outcome11.isOk()).toBe(true);
    expect(f.requests).toEqual([f.jwksUrl]);
  });

  test('resource configuration materializes issuer mode without a secret', async () => {
    const f = await setup();
    const config = authResourceConfigSchema.parse({
      adapter: 'jwt',
      ...f.options,
    });
    const result = await authResource.create({
      config,
      cwd: '/tmp',
      env: {},
      workspaceRoot: '/tmp',
    });
    expect(result.isOk()).toBe(true);
    const outcome12 = await result
      .unwrap()
      .authenticate(input(await f.key.sign()));
    expect(outcome12.isOk()).toBe(true);
  });

  test('issuer mode requires an expected audience even if expiration is optional', async () => {
    const f = await setup();
    const adapter = createJwtAdapter({
      issuer: f.issuer,
      requireExpiration: false,
    });
    const outcome13 = await adapter.authenticate(input(await f.key.sign()));
    expect(outcome13.isErr()).toBe(true);
    expect(
      authResourceConfigSchema.safeParse({ adapter: 'jwt', issuer: f.issuer })
        .success
    ).toBe(false);
    expect(f.requests).toHaveLength(0);
  });
  test('boundary rematerialization shares keys but applies audience policy each time', async () => {
    const f = await setup('EdDSA');
    const graph = topo('issuer-boundary', { auth: authResource });
    const token = await f.key.sign();
    const resolve = (audience: string) =>
      resolvePermitFromBearerToken({
        bearerToken: token,
        configValues: { auth: { adapter: 'jwt', audience, issuer: f.issuer } },
        graph,
        requestId: 'boundary',
        surface: 'mcp',
      });
    const outcome14 = await resolve(f.audience);
    expect(outcome14.isOk()).toBe(true);
    const outcome15 = await resolve(f.audience);
    expect(outcome15.isOk()).toBe(true);
    const outcome16 = await resolve('other');
    expect(outcome16.isErr()).toBe(true);
    expect(f.requests).toHaveLength(2);
  });

  test('deduplicates a concurrent kid rotation', async () => {
    const f = await setup('EdDSA');
    await f.adapter.authenticate(input(await f.key.sign()));
    const rotated = await f.makeKey('rotated');
    f.state.keys = [rotated.jwk];
    const token = await rotated.sign();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => f.adapter.authenticate(input(token)))
    );
    expect(results.every((result) => result.isOk())).toBe(true);
    expect(f.requests).toHaveLength(3);
  });

  test('recovers failed loads after a bounded cooldown', async () => {
    const f = await setup('EdDSA');
    f.state.keysStatus = 503;
    const token = await f.key.sign();
    const outcome17 = await f.adapter.authenticate(input(token));
    expect(outcome17.isErr()).toBe(true);
    f.state.keysStatus = 200;
    const outcome18 = await f.adapter.authenticate(input(token));
    expect(outcome18.isErr()).toBe(true);
    expect(f.requests).toHaveLength(2);
    setSystemTime(Date.now() + 31_000);
    const outcome19 = await f.adapter.authenticate(input(token));
    expect(outcome19.isOk()).toBe(true);
    expect(f.requests).toHaveLength(3);
  });

  test('reloads expired metadata and keys successfully', async () => {
    const f = await setup('EdDSA');
    const token = await f.key.sign();
    const outcome20 = await f.adapter.authenticate(input(token));
    expect(outcome20.isOk()).toBe(true);
    setSystemTime(Date.now() + 301_000);
    const outcome21 = await f.adapter.authenticate(input(token));
    expect(outcome21.isOk()).toBe(true);
    expect(f.requests).toHaveLength(4);
  });

  for (const header of [
    { alg: 'none' },
    { alg: 'HS256' },
    { alg: 'RS512' },
    { crit: ['custom'], custom: true },
    { b64: false },
    { typ: 'dpop+jwt' },
    { kid: 1 },
  ]) {
    test(`rejects unsupported header ${JSON.stringify(header)}`, async () => {
      const f = await setup('EdDSA');
      const outcome22 = await f.adapter.authenticate(
        input(await f.key.sign({}, header))
      );
      expect(outcome22.isErr()).toBe(true);
      expect(f.requests).toHaveLength(0);
    });
  }

  test('rejects invalid signatures and ignores token-supplied key URLs', async () => {
    const f = await setup('EdDSA');
    const attacker = await f.makeKey('first');
    const token = await attacker.sign(
      {},
      {
        jku: 'https://attacker.example/keys',
        x5u: 'https://attacker.example/cert',
      }
    );
    const outcome23 = await f.adapter.authenticate(input(token));
    expect(outcome23.isErr()).toBe(true);
    expect(f.requests).toEqual([
      `${f.issuer}/.well-known/openid-configuration`,
      f.jwksUrl,
    ]);
  });

  for (const override of [
    { use: 'enc' },
    { alg: 'RS256' },
    { kty: 'RSA' },
    { crv: 'Ed448' },
    { key_ops: ['encrypt'] },
  ]) {
    test(`rejects incompatible key ${JSON.stringify(override)}`, async () => {
      const f = await setup('EdDSA');
      f.state.keys = [{ ...f.key.jwk, ...override }];
      const result = await f.adapter.authenticate(input(await f.key.sign()));
      expect(result.isErr()).toBe(true);
    });
  }

  test('reapplies each adapter algorithm policy without caching authorization', async () => {
    const f = await setup('EdDSA');
    const token = await f.key.sign();
    const accepted = await f.adapter.authenticate(input(token));
    expect(accepted.isOk()).toBe(true);
    const restricted = createJwtAdapter({
      ...f.options,
      allowedAlgorithms: ['RS256'],
    });
    const rejected = await restricted.authenticate(input(token));
    expect(rejected.isErr()).toBe(true);
    expect(f.requests).toHaveLength(2);
  });

  test('does not fetch keys when credentials are absent', async () => {
    const f = await setup('EdDSA');
    const result = await f.adapter.authenticate({
      requestId: 'empty',
      surface: 'mcp',
    });
    expect(result.unwrap()).toBeNull();
    expect(f.requests).toHaveLength(0);
  });

  test('rejects duplicate matching keys and permits a single key without kid', async () => {
    const f = await setup('EdDSA');
    f.state.keys = [f.key.jwk, f.key.jwk];
    const outcome25 = await f.adapter.authenticate(input(await f.key.sign()));
    expect(outcome25.isErr()).toBe(true);
    const other = await setup('EdDSA');
    const outcome26 = await other.adapter.authenticate(
      input(await other.key.sign({}, { kid: undefined }))
    );
    expect(outcome26.isOk()).toBe(true);
  });

  test('requires HTTPS issuer and key endpoints', async () => {
    const f = await setup('EdDSA');
    f.state.metadata.jwks_uri = 'http://issuer.example/keys';
    const outcome27 = await f.adapter.authenticate(input(await f.key.sign()));
    expect(outcome27.isErr()).toBe(true);
    expect(f.requests).toHaveLength(1);
  });

  test('issuer mode always requires expiration despite requireExpiration false', async () => {
    const f = await setup('EdDSA');
    const adapter = createJwtAdapter({
      ...f.options,
      requireExpiration: false,
    });
    const outcome28 = await adapter.authenticate(
      input(await f.key.sign({ exp: undefined }))
    );
    expect(outcome28.isErr()).toBe(true);
  });
});
