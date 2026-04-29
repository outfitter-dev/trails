import { describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import type { AuthConnector, AuthError } from '../connectors/connector.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';
import { createJwtConnector } from '../connectors/jwt.js';
import type { JwtAlgorithm } from '../connectors/jwt.js';

// ---------------------------------------------------------------------------
// Test helper: sign a JWT with HMAC-SHA256 using crypto.subtle
// ---------------------------------------------------------------------------

const base64url = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCodePoint(b);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

const base64urlEncode = (str: string): string => {
  const encoder = new TextEncoder();
  return base64url(encoder.encode(str).buffer as ArrayBuffer);
};

const signJwtPayload = async (
  payloadJson: string,
  secret: string,
  headerOverrides?: Record<string, unknown>
): Promise<string> => {
  const header = base64urlEncode(
    JSON.stringify({ alg: 'HS256', typ: 'JWT', ...headerOverrides })
  );
  const body = base64urlEncode(payloadJson);
  const data = `${header}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${base64url(sig)}`;
};

const signJwt = (
  payload: Record<string, unknown>,
  secret: string,
  headerOverrides?: Record<string, unknown>
): Promise<string> =>
  signJwtPayload(JSON.stringify(payload), secret, headerOverrides);

const TEST_SECRET = 'test-secret-for-hmac-256';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Minimal extraction input for tests that don't need all fields. */
const testInput = (
  overrides?: Partial<PermitExtractionInput>
): PermitExtractionInput => ({
  requestId: 'test-req',
  trailhead: 'http',
  ...overrides,
});

describe('AuthConnector interface', () => {
  test('accepts a valid connector implementation', async () => {
    const connector: AuthConnector = {
      // oxlint-disable-next-line require-await -- stub connector for type test
      authenticate: async (_input: PermitExtractionInput) => Result.ok(null),
    };
    const result = await connector.authenticate(testInput());
    expect(result.isOk()).toBe(true);
  });
});

/* oxlint-disable max-statements -- test suite with multiple concern groups */
describe('createJwtConnector', () => {
  test('returns an AuthConnector', () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    expect(connector).toBeDefined();
    expect(connector.authenticate).toBeInstanceOf(Function);
  });

  test('verifies a valid HS256 token and returns a Permit', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, scope: 'read write', sub: 'user-123' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit).not.toBeNull();
    expect(permit.id).toBe('user-123');
    expect(permit.scopes).toEqual(['read', 'write']);
  });

  test('rejects an expired token', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signJwt(
      { exp: past, sub: 'user-expired' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('expired_token');
  });

  test('accepts an exp just inside the default clock skew', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now - 30, sub: 'user-skew-exp' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
  });

  test('rejects expired tokens when clock skew is non-finite', async () => {
    const connector = createJwtConnector({
      clockSkewSeconds: Number.NaN,
      secret: TEST_SECRET,
    });
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signJwt(
      { exp: past, sub: 'user-nan-skew-exp' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('expired_token');
  });

  test('uses the default clock skew when configured skew is non-finite', async () => {
    const connector = createJwtConnector({
      clockSkewSeconds: Number.NaN,
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now - 30, nbf: now + 30, sub: 'user-nan-skew-default' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
  });

  test('rejects tokens missing an expiration claim by default', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const token = await signJwt({ sub: 'user-no-exp' }, TEST_SECRET);
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Missing expiration claim');
  });

  test('treats null expiration as missing when expiration is required', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const token = await signJwtPayload(
      '{"exp":null,"sub":"user-null-exp"}',
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Missing expiration claim');
  });

  test('allows missing expiration only when explicitly configured', async () => {
    const connector = createJwtConnector({
      requireExpiration: false,
      secret: TEST_SECRET,
    });
    const token = await signJwt({ sub: 'user-no-exp-allowed' }, TEST_SECRET);
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.id).toBe('user-no-exp-allowed');
  });

  test('rejects null expiration even when expiration is optional', async () => {
    const connector = createJwtConnector({
      requireExpiration: false,
      secret: TEST_SECRET,
    });
    const token = await signJwtPayload(
      '{"exp":null,"sub":"user-null-exp-optional"}',
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Invalid expiration claim');
  });

  test('rejects expired tokens even when expiration is optional', async () => {
    const connector = createJwtConnector({
      requireExpiration: false,
      secret: TEST_SECRET,
    });
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await signJwt(
      { exp: past, sub: 'user-expired-optional' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('expired_token');
  });

  test('rejects non-finite expiration claims', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const token = await signJwtPayload(
      '{"exp":1e9999,"sub":"user-infinite-exp"}',
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Invalid expiration claim');
  });

  test('rejects tokens before nbf outside clock skew', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, nbf: now + 120, sub: 'user-future' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('not valid yet');
  });

  test('rejects non-finite not-before claims', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwtPayload(
      `{"exp":${now + 3600},"nbf":1e9999,"sub":"user-infinite-nbf"}`,
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Invalid not-before claim');
  });

  test('accepts nbf inside the default clock skew', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, nbf: now + 30, sub: 'user-future-skew' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
  });

  test('rejects future nbf claims when clock skew is non-finite', async () => {
    const connector = createJwtConnector({
      clockSkewSeconds: Number.NaN,
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, nbf: now + 120, sub: 'user-nan-skew-nbf' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('not valid yet');
  });

  test('rejects an invalid signature', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-bad-sig' },
      'wrong-secret'
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
  });

  test('rejects tokens with missing alg headers', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-no-alg' },
      TEST_SECRET,
      { alg: undefined }
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Missing JWT alg');
  });

  test('rejects tokens with unexpected alg headers', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-wrong-alg' },
      TEST_SECRET,
      { alg: 'HS512' }
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Unsupported JWT alg');
  });

  test('reports an empty algorithm allowlist as connector misconfiguration', async () => {
    const connector = createJwtConnector({
      allowedAlgorithms: [],
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-empty-alg-list' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('allowedAlgorithms');
  });

  test('rejects unsupported runtime algorithms even when config is malformed', async () => {
    const connector = createJwtConnector({
      allowedAlgorithms: ['HS512' as JwtAlgorithm],
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-configured-unsupported-alg' },
      TEST_SECRET,
      { alg: 'HS512' }
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Unsupported JWT alg');
  });

  test('rejects tokens with alg none headers', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-none-alg' },
      TEST_SECRET,
      { alg: 'none' }
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Unsupported JWT alg');
  });

  test('rejects tokens with a missing subject claim', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, scope: 'read' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
    expect(err.message).toContain('Missing subject claim');
  });

  test('extracts scopes from token claims', async () => {
    const connector = createJwtConnector({
      scopesClaim: 'permissions',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        exp: now + 3600,
        permissions: 'admin:read admin:write',
        sub: 'user-scopes',
      },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.scopes).toEqual(['admin:read', 'admin:write']);
  });

  test('extracts roles from token claims', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, roles: ['admin', 'editor'], sub: 'user-roles' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.roles).toEqual(['admin', 'editor']);
  });

  test('returns null for missing credentials', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const result = await connector.authenticate(testInput());
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeNull();
  });

  test('checks issuer claim when configured', async () => {
    const connector = createJwtConnector({
      issuer: 'https://auth.example.com',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, iss: 'https://evil.example.com', sub: 'user-iss' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
  });

  test('checks audience claim when configured', async () => {
    const connector = createJwtConnector({
      audience: 'my-api',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { aud: 'other-api', exp: now + 3600, sub: 'user-aud' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
  });

  test('accepts array-format audience containing configured value', async () => {
    const connector = createJwtConnector({
      audience: 'my-api',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { aud: ['my-api', 'account'], exp: now + 3600, sub: 'user-arr-aud' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.id).toBe('user-arr-aud');
  });

  test('rejects array-format audience not containing configured value', async () => {
    const connector = createJwtConnector({
      audience: 'my-api',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { aud: ['other-api', 'account'], exp: now + 3600, sub: 'user-no-aud' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
  });

  test('extracts scopes from array-format claim', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, scope: ['read', 'write'], sub: 'user-arr-scope' },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.scopes).toEqual(['read', 'write']);
  });

  test('filters empty strings from array-format scope claims', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        exp: now + 3600,
        scope: ['', 'read', '', 'write'],
        sub: 'user-arr-scope-empty',
      },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.scopes).toEqual(['read', 'write']);
  });

  test('returns error for malformed signature bytes', async () => {
    const connector = createJwtConnector({ secret: TEST_SECRET });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, sub: 'user-bad' },
      TEST_SECRET
    );
    const parts = token.split('.');
    const malformed = `${parts[0]}.${parts[1]}.!!!invalid-base64!!!`;
    const result = await connector.authenticate(
      testInput({ bearerToken: malformed })
    );
    expect(result.isErr()).toBe(true);
    const err = (result as ReturnType<typeof Result.err<AuthError>>).error;
    expect(err.code).toBe('invalid_token');
  });

  test('accepts token with matching issuer and audience', async () => {
    const connector = createJwtConnector({
      audience: 'my-api',
      issuer: 'https://auth.example.com',
      secret: TEST_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        aud: 'my-api',
        exp: now + 3600,
        iss: 'https://auth.example.com',
        scope: 'read',
        sub: 'user-valid',
      },
      TEST_SECRET
    );
    const result = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(result.isOk()).toBe(true);
    const permit = result.unwrap() as Permit;
    expect(permit.id).toBe('user-valid');
  });
});
