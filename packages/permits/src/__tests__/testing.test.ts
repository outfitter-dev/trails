import { describe, expect, test } from 'bun:test';

import { createPermitForTrail, createTestPermit } from '../testing';

describe('createTestPermit()', () => {
  test('returns a Permit with the given scopes', () => {
    const permit = createTestPermit({ scopes: ['user:read', 'user:write'] });
    expect(permit.scopes).toEqual(['user:read', 'user:write']);
  });

  test('generates a unique id when not specified', () => {
    const a = createTestPermit();
    const b = createTestPermit();
    expect(a.id).not.toBe(b.id);
  });

  test('uses the provided id when specified', () => {
    const permit = createTestPermit({ id: 'custom-id' });
    expect(permit.id).toBe('custom-id');
  });

  test('returns empty scopes when no options provided', () => {
    const permit = createTestPermit();
    expect(permit.scopes).toEqual([]);
  });

  test('includes roles when provided', () => {
    const permit = createTestPermit({ roles: ['admin', 'editor'] });
    expect(permit.roles).toEqual(['admin', 'editor']);
  });

  test('includes tenantId when provided', () => {
    const permit = createTestPermit({ tenantId: 'tenant_abc' });
    expect(permit.tenantId).toBe('tenant_abc');
  });
});

describe('createPermitForTrail()', () => {
  test('extracts scopes from trail permit requirement', () => {
    const trail = { permit: { scopes: ['entity:read', 'entity:write'] } };
    const permit = createPermitForTrail(trail);
    expect(permit).toBeDefined();
    expect(permit?.scopes).toEqual(['entity:read', 'entity:write']);
  });

  test('returns undefined for public trails', () => {
    const trail = { permit: 'public' as const };
    const permit = createPermitForTrail(trail);
    expect(permit).toBeUndefined();
  });

  test('returns undefined when no permit declared', () => {
    const trail = {};
    const permit = createPermitForTrail(trail);
    expect(permit).toBeUndefined();
  });
});
