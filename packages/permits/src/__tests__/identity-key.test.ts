import { describe, expect, test } from 'bun:test';
import { ValidationError } from '@ontrails/core';

import { derivePermitIdentityKey } from '../identity.js';

describe('issuer-qualified permit identity', () => {
  test('refuses to invent a stable namespace for an issuerless local permit', () => {
    const result = derivePermitIdentityKey({ id: 'subject' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });

  test('encodes exact issuer, subject and tenant with an explicit unknown tenant', () => {
    expect(
      JSON.parse(
        derivePermitIdentityKey({
          id: 'subject',
          issuer: 'https://Issuer.example',
        }).unwrap()
      )
    ).toEqual(['https://Issuer.example', 'subject', null]);
    expect(
      JSON.parse(
        derivePermitIdentityKey({
          id: 'subject',
          issuer: 'https://Issuer.example',
          tenantId: 'tenant',
        }).unwrap()
      )
    ).toEqual(['https://Issuer.example', 'subject', 'tenant']);
  });

  test('separates identical subjects across namespaces and resists delimiter collisions', () => {
    const inputs = [
      { id: 'subject', issuer: 'https://Issuer.example' },
      { id: 'subject', issuer: 'https://issuer.example' },
      { id: 'subject', issuer: 'https://Issuer.example', tenantId: '' },
      { id: 'b|c', issuer: 'a' },
      { id: 'c', issuer: 'a|b' },
    ];
    const keys = inputs.map((input) => derivePermitIdentityKey(input).unwrap());
    expect(new Set(keys).size).toBe(inputs.length);
  });

  test('rejects invalid identity fields without serializing arbitrary values', () => {
    expect(derivePermitIdentityKey({ id: 'subject', issuer: '' }).isErr()).toBe(
      true
    );
    expect(
      derivePermitIdentityKey({ id: 12 as never, issuer: 'issuer' }).isErr()
    ).toBe(true);
  });
});
