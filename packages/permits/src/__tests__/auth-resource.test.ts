import { describe, expect, test } from 'bun:test';

import type { ResourceContext } from '@ontrails/core';

import type { AuthResourceConfig } from '../auth-resource.js';
import type { AuthConnector } from '../connectors/connector.js';
import { authResource, authResourceConfigSchema } from '../auth-resource.js';
import type { PermitExtractionInput } from '../extraction.js';
import { TEST_SECRET, signJwt } from './helpers/jwt.js';

/** Minimal extraction input for tests. */
const testInput = (
  overrides?: Partial<PermitExtractionInput>
): PermitExtractionInput => ({
  requestId: 'test-svc-req',
  surface: 'http',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testSvcCtx: ResourceContext<AuthResourceConfig> = {
  config: authResourceConfigSchema.parse(),
  cwd: '/tmp',
  env: {},
  workspaceRoot: '/tmp',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authResource', () => {
  test('has correct id and kind', () => {
    expect(authResource.id).toBe('auth');
    expect(authResource.kind).toBe('resource');
  });

  test('has infrastructure meta', () => {
    expect(authResource.meta).toEqual({ category: 'infrastructure' });
  });

  test('defaults config to the no-op connector', () => {
    expect(authResourceConfigSchema.parse()).toEqual({
      connector: 'none',
    });
  });

  test('mock returns an AuthConnector', async () => {
    const mock = authResource.mock?.();
    expect(mock).toBeDefined();

    const connector = mock as AuthConnector;
    const result = await connector.authenticate(testInput());
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeNull();
  });

  test('create returns Result.ok with an AuthConnector', async () => {
    const result = await authResource.create(testSvcCtx);
    expect(result.isOk()).toBe(true);

    const connector = result.unwrap() as AuthConnector;
    const authResult = await connector.authenticate(testInput());
    expect(authResult.isOk()).toBe(true);
    expect(authResult.unwrap()).toBeNull();
  });

  test('create wires JWT config into a real connector', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, scope: 'read write', sub: 'user-42' },
      TEST_SECRET
    );

    const result = await authResource.create({
      ...testSvcCtx,
      config: { connector: 'jwt', secret: TEST_SECRET },
    });

    expect(result.isOk()).toBe(true);
    const connector = result.unwrap() as AuthConnector;
    const authResult = await connector.authenticate(
      testInput({ bearerToken: token })
    );
    expect(authResult.isOk()).toBe(true);
    expect(authResult.unwrap()).toEqual({
      id: 'user-42',
      scopes: ['read', 'write'],
    });
  });

  test('JWT config requires the implemented secret-backed connector path', () => {
    const parsed = authResourceConfigSchema.safeParse({
      connector: 'jwt',
      jwksUrl: 'https://example.com/.well-known/jwks.json',
    });

    expect(parsed.success).toBe(false);
  });
});
