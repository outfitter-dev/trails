import { describe, expect, test } from 'bun:test';

import { basePermitSchema } from '../permits.js';

const actor = {
  id: 'delegate',
  issuer: 'https://actor.example',
  kind: 'service',
  verified: true,
};

describe('BasePermit identity evidence', () => {
  test('requires an authored actor chain instead of defaulting unknown to empty', () => {
    expect(
      basePermitSchema.safeParse({ id: 'subject', scopes: [] }).success
    ).toBe(false);
    expect(
      basePermitSchema.parse({ actors: [], id: 'subject', scopes: [] })
    ).toEqual({ actors: [], id: 'subject', scopes: [] });
  });

  test('preserves attester, deadline, tenant and the complete actor identity', () => {
    const permit = {
      actors: [actor],
      expiresAt: 1_800_000_000_123.5,
      id: 'subject',
      issuer: 'https://Issuer.example',
      scopes: ['entry:read'],
      tenantId: 'tenant-a',
    };
    expect(basePermitSchema.parse(permit)).toEqual(permit);
  });

  test('preserves explicitly asserted evidence without promoting its verification', () => {
    const permit = {
      actors: [{ id: 'asserted', kind: 'unknown', verified: false }],
      id: 'subject',
      scopes: [],
    };
    expect(basePermitSchema.parse(permit)).toEqual(permit);
  });

  test('rejects malformed actor evidence, empty namespaces and nonfinite deadlines', () => {
    for (const badActor of [
      { ...actor, verified: 'true' },
      { ...actor, id: '' },
      { ...actor, kind: '' },
      { ...actor, issuer: '' },
    ]) {
      expect(
        basePermitSchema.safeParse({
          actors: [badActor],
          id: 'subject',
          scopes: [],
        }).success
      ).toBe(false);
    }
    for (const expiresAt of [Infinity, -Infinity, Number.NaN]) {
      expect(
        basePermitSchema.safeParse({
          actors: [],
          expiresAt,
          id: 'subject',
          scopes: [],
        }).success
      ).toBe(false);
    }
    expect(
      basePermitSchema.safeParse({
        actors: [],
        id: 'subject',
        issuer: '',
        scopes: [],
      }).success
    ).toBe(false);
  });
});
