import { describe, expect, test } from 'bun:test';

import type { ProvisionContext } from '@ontrails/core';

import type { AuthConnector } from '../connectors/connector.js';
import { authProvision } from '../auth-resource.js';
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

const testSvcCtx: ProvisionContext = {
  config: undefined,
  cwd: '/tmp',
  env: {},
  workspaceRoot: '/tmp',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authProvision', () => {
  test('has correct id and kind', () => {
    expect(authProvision.id).toBe('auth');
    expect(authProvision.kind).toBe('resource');
  });

  test('has infrastructure meta', () => {
    expect(authProvision.meta).toEqual({ category: 'infrastructure' });
  });

  test('mock returns an AuthConnector', async () => {
    const mock = authProvision.mock?.();
    expect(mock).toBeDefined();

    const connector = mock as AuthConnector;
    const result = await connector.authenticate(testInput());
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeNull();
  });

  test('create returns Result.ok with an AuthConnector', async () => {
    const result = await authProvision.create(testSvcCtx);
    expect(result.isOk()).toBe(true);

    const connector = result.unwrap() as AuthConnector;
    const authResult = await connector.authenticate(testInput());
    expect(authResult.isOk()).toBe(true);
    expect(authResult.unwrap()).toBeNull();
  });
});
