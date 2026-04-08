import { describe, expect, test } from 'bun:test';

import type { ResourceContext } from '@ontrails/core';

import type { AuthConnector } from '../connectors/connector.js';
import { authResource } from '../auth-resource.js';
import type { PermitExtractionInput } from '../extraction.js';

/** Minimal extraction input for tests. */
const testInput = (
  overrides?: Partial<PermitExtractionInput>
): PermitExtractionInput => ({
  requestId: 'test-svc-req',
  trailhead: 'http',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testSvcCtx: ResourceContext = {
  config: undefined,
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
});
