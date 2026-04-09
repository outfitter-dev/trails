import { describe, expect, test } from 'bun:test';

import {
  Result,
  TRAILHEAD_KEY,
  ValidationError,
  executeTrail,
} from '@ontrails/core';

import type { AuthConnector } from '../connectors/connector.js';
import { authResource } from '../auth-resource.js';
import { createJwtConnector } from '../connectors/jwt.js';
import type { Permit } from '../permit.js';
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

/** Create an AuthConnector wired to a JWT secret. */
const jwtConnector = (): AuthConnector =>
  createJwtConnector({ secret: TEST_SECRET });

/** Execute auth.verify with a given connector injected as the auth resource. */
const runVerify = async (
  token: string,
  connector: AuthConnector,
  options?: {
    trailhead?: 'http' | 'mcp' | 'cli';
  }
): Promise<
  Result<
    {
      error?: string;
      errorCode?:
        | 'expired_token'
        | 'insufficient_scope'
        | 'invalid_token'
        | 'missing_credentials';
      permit?: {
        id: string;
        metadata?: Record<string, unknown>;
        roles?: string[];
        scopes: string[];
        tenantId?: string;
      };
      valid: boolean;
    },
    Error
  >
> => {
  const result = await executeTrail(
    authVerify,
    { token },
    {
      ctx:
        options?.trailhead === undefined
          ? undefined
          : { extensions: { [TRAILHEAD_KEY]: options.trailhead } },
      resources: { [authResource.id]: connector },
    }
  );
  return result as Result<
    {
      error?: string;
      permit?: {
        id: string;
        metadata?: Record<string, unknown>;
        roles?: string[];
        scopes: string[];
        tenantId?: string;
      };
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

    test('has infrastructure meta', () => {
      expect(authVerify.meta).toEqual({ category: 'infrastructure' });
    });

    test('has examples', () => {
      expect(authVerify.examples).toBeDefined();
      expect(authVerify.examples?.length).toBeGreaterThan(0);
    });

    test('declares authResource dependency', () => {
      expect(authVerify.resources).toHaveLength(1);
      expect(authVerify.resources[0]?.id).toBe('auth');
    });
  });

  describe('with mock connector (no credentials)', () => {
    test('returns valid: false with error message', async () => {
      const noopConnector: AuthConnector = {
        // oxlint-disable-next-line require-await -- satisfies async interface
        authenticate: async () => Result.ok(null),
      };

      const result = await runVerify('some-token', noopConnector);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBe('No credentials');
      expect(value.errorCode).toBe('missing_credentials');
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

      const result = await runVerify(token, jwtConnector());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.permit).toEqual({
        id: 'user-42',
        scopes: ['read', 'write'],
      });
      expect(value.error).toBeUndefined();
    });

    test('returns the full permit payload from the connector', async () => {
      const permit: Permit = {
        id: 'user-42',
        metadata: { plan: 'pro' },
        roles: ['admin'],
        scopes: ['read', 'write'],
        tenantId: 'tenant-1',
      };
      const connector: AuthConnector = {
        // oxlint-disable-next-line require-await -- satisfies async interface
        authenticate: async () => Result.ok(permit),
      };

      const result = await runVerify('full-permit-token', connector);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().permit).toEqual({
        id: 'user-42',
        metadata: { plan: 'pro' },
        roles: ['admin'],
        scopes: ['read', 'write'],
        tenantId: 'tenant-1',
      });
    });

    test('forwards the invoking trailhead from trail context', async () => {
      let seenTrailhead: string | undefined;
      const connector: AuthConnector = {
        // oxlint-disable-next-line require-await -- captures connector input
        authenticate: async (input) => {
          seenTrailhead = input.trailhead;
          return Result.ok({
            id: 'user-42',
            scopes: ['read'],
          });
        },
      };

      const result = await runVerify('trailhead-aware-token', connector, {
        trailhead: 'mcp',
      });

      expect(result.isOk()).toBe(true);
      expect(seenTrailhead).toBe('mcp');
    });
  });

  describe('with invalid token', () => {
    test('returns valid: false with error for bad signature', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { exp: now + 3600, sub: 'user-bad' },
        'wrong-secret'
      );

      const result = await runVerify(token, jwtConnector());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBeDefined();
      expect(value.errorCode).toBe('invalid_token');
      expect(value.permit).toBeUndefined();
    });

    test('returns valid: false for expired token', async () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const token = await signJwt(
        { exp: past, sub: 'user-expired' },
        TEST_SECRET
      );

      const result = await runVerify(token, jwtConnector());

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      expect(value.error).toBeDefined();
      expect(value.errorCode).toBe('expired_token');
      expect(value.permit).toBeUndefined();
    });
  });

  describe('input validation', () => {
    test('rejects empty bearer tokens at the boundary', async () => {
      const result = await executeTrail(
        authVerify,
        { token: '' },
        {
          resources: { [authResource.id]: jwtConnector() },
        }
      );

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });
});
