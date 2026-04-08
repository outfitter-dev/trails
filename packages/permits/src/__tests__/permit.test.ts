import { describe, expect, test } from 'bun:test';

import type { Permit, PermitExtractionInput } from '../index';
import { getPermit } from '../index';

describe('Permit type', () => {
  test('accepts a valid permit with required fields only', () => {
    const permit: Permit = {
      id: 'usr_abc123',
      scopes: ['user:read', 'user:write'],
    };
    expect(permit.id).toBe('usr_abc123');
    expect(permit.scopes).toEqual(['user:read', 'user:write']);
  });

  test('accepts a permit with all optional fields', () => {
    const permit: Permit = {
      id: 'usr_full',
      metadata: { plan: 'pro', provider: 'clerk' },
      roles: ['admin', 'editor'],
      scopes: ['entity:read'],
      tenantId: 'tenant_xyz',
    };
    expect(permit.roles).toEqual(['admin', 'editor']);
    expect(permit.tenantId).toBe('tenant_xyz');
    expect(permit.metadata).toEqual({ plan: 'pro', provider: 'clerk' });
  });

  test('scopes and roles arrays are readonly', () => {
    const permit: Permit = {
      id: 'usr_ro',
      roles: ['viewer'],
      scopes: ['read'],
    };
    // Structural check: readonly arrays are assignable to readonly string[]
    const { scopes } = permit;
    const { roles } = permit;
    expect(scopes).toEqual(['read']);
    expect(roles).toEqual(['viewer']);
  });
});

describe('getPermit()', () => {
  test('returns Permit from a context with a permit', () => {
    const permit: Permit = { id: 'usr_1', scopes: ['user:read'] };
    const ctx = { permit, requestId: 'req-1' };
    const result = getPermit(ctx);
    expect(result).toEqual(permit);
  });

  test('returns undefined when context has no permit', () => {
    const ctx = { requestId: 'req-2' };
    const result = getPermit(ctx);
    expect(result).toBeUndefined();
  });

  test('returns undefined when permit is explicitly undefined', () => {
    const ctx = { permit: undefined, requestId: 'req-3' };
    const result = getPermit(ctx);
    expect(result).toBeUndefined();
  });

  test('preserves extended permit fields from the auth layer', () => {
    const ctx = {
      permit: {
        id: 'usr_2',
        metadata: { plan: 'pro' },
        roles: ['admin'],
        scopes: ['user:read'],
        tenantId: 'tenant-1',
      } satisfies Permit,
      requestId: 'req-4',
    };
    const result = getPermit(ctx);
    expect(result).toEqual(ctx.permit);
  });
});

describe('PermitExtractionInput', () => {
  test('accepts HTTP trailhead extraction', () => {
    const input: PermitExtractionInput = {
      bearerToken: 'eyJhbGciOiJSUzI1NiJ9.test',
      headers: new Headers({
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.test',
      }),
      requestId: 'req-http-1',
      trailhead: 'http',
    };
    expect(input.trailhead).toBe('http');
    expect(input.bearerToken).toBeDefined();
  });

  test('accepts MCP trailhead extraction', () => {
    const input: PermitExtractionInput = {
      requestId: 'req-mcp-1',
      sessionId: 'mcp-session-abc',
      trailhead: 'mcp',
    };
    expect(input.trailhead).toBe('mcp');
    expect(input.sessionId).toBe('mcp-session-abc');
  });

  test('accepts CLI trailhead extraction', () => {
    const input: PermitExtractionInput = {
      bearerToken: 'cli-token-from-keyring',
      requestId: 'req-cli-1',
      trailhead: 'cli',
    };
    expect(input.trailhead).toBe('cli');
  });

  test('accepts minimal extraction with only required fields', () => {
    const input: PermitExtractionInput = {
      requestId: 'req-minimal',
      trailhead: 'http',
    };
    expect(input.requestId).toBe('req-minimal');
    expect(input.bearerToken).toBeUndefined();
    expect(input.sessionId).toBeUndefined();
    expect(input.headers).toBeUndefined();
  });
});
