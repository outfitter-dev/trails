import { describe, expect, test } from 'bun:test';

import type { ServiceContext } from '@ontrails/core';

import type { AuthAdapter } from '../adapter.js';
import { authService } from '../auth-service.js';
import type { PermitExtractionInput } from '../extraction.js';

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

const testSvcCtx: ServiceContext = {
  config: undefined,
  cwd: '/tmp',
  env: {},
  workspaceRoot: '/tmp',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authService', () => {
  test('has correct id and kind', () => {
    expect(authService.id).toBe('auth');
    expect(authService.kind).toBe('service');
  });

  test('has infrastructure metadata', () => {
    expect(authService.metadata).toEqual({ category: 'infrastructure' });
  });

  test('mock returns an AuthAdapter', async () => {
    const mock = authService.mock?.();
    expect(mock).toBeDefined();

    const adapter = mock as AuthAdapter;
    const result = await adapter.authenticate(testInput());
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBeNull();
  });

  test('create returns Result.ok with an AuthAdapter', async () => {
    const result = await authService.create(testSvcCtx);
    expect(result.isOk()).toBe(true);

    const adapter = result.unwrap() as AuthAdapter;
    const authResult = await adapter.authenticate(testInput());
    expect(authResult.isOk()).toBe(true);
    expect(authResult.unwrap()).toBeNull();
  });
});
