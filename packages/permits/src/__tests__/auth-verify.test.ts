import { describe, expect, test } from 'bun:test';

import { Result, executeTrail } from '@ontrails/core';

import type { AuthAdapter } from '../adapter.js';
import { authService } from '../auth-service.js';
import { createJwtAdapter } from '../adapters/jwt.js';
import { authVerify } from '../trails/auth-verify.js';

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

const signJwt = async (
  payload: Record<string, unknown>,
  secret: string
): Promise<string> => {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
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

const TEST_SECRET = 'test-secret-for-hmac-256';

/** Create an AuthAdapter wired to a JWT secret. */
const jwtAdapter = (): AuthAdapter => createJwtAdapter({ secret: TEST_SECRET });

/** Execute auth.verify with a given adapter injected as the auth service. */
const runVerify = async (
  token: string,
  adapter: AuthAdapter
): Promise<
  Result<
    {
      error?: string;
      permit?: { id: string; scopes: string[] };
      valid: boolean;
    },
    Error
  >
> => {
  const result = await executeTrail(
    authVerify,
    { token },
    {
      services: { [authService.id]: adapter },
    }
  );
  return result as Result<
    {
      error?: string;
      permit?: { id: string; scopes: string[] };
      valid: boolean;
    },
    Error
  >;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth.verify trail', () => {
  describe('contract', () => {
    test('has correct id and intent', () => {
      expect(authVerify.id).toBe('auth.verify');
      expect(authVerify.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(authVerify.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(authVerify.examples).toBeDefined();
      expect(authVerify.examples?.length).toBeGreaterThan(0);
    });

    test('declares authService dependency', () => {
      expect(authVerify.services).toHaveLength(1);
      expect(authVerify.services[0]?.id).toBe('auth');
    });
  });

  describe('with mock adapter (no credentials)', () => {
    test('returns valid: false with error message', async () => {
      const noopAdapter: AuthAdapter = {
        // oxlint-disable-next-line require-await -- satisfies async interface
        authenticate: async () => Result.ok(null),
      };

      const result = await runVerify('some-token', noopAdapter);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBe('No credentials');
      expect(value.permit).toBeUndefined();
    });
  });

  describe('with valid token and secret', () => {
    test('returns valid: true with permit', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { exp: now + 3600, scope: 'read write', sub: 'user-42' },
        TEST_SECRET
      );

      const result = await runVerify(token, jwtAdapter());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.permit).toEqual({
        id: 'user-42',
        scopes: ['read', 'write'],
      });
      expect(value.error).toBeUndefined();
    });
  });

  describe('with invalid token', () => {
    test('returns valid: false with error for bad signature', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { exp: now + 3600, sub: 'user-bad' },
        'wrong-secret'
      );

      const result = await runVerify(token, jwtAdapter());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBeDefined();
      expect(value.permit).toBeUndefined();
    });

    test('returns valid: false for expired token', async () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const token = await signJwt(
        { exp: past, sub: 'user-expired' },
        TEST_SECRET
      );

      const result = await runVerify(token, jwtAdapter());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBeDefined();
      expect(value.permit).toBeUndefined();
    });
  });
});
