import { describe, expect, test } from 'bun:test';

import * as permits from '@ontrails/permits';
import {
  authAdapterSchema,
  createTokenCallbackAdapter,
  resolvePermitFromInput,
} from '@ontrails/permits';
import { createJwtAdapter as createJwtAdapterFromSubpath } from '@ontrails/permits/jwt';
import type { JwtAdapterOptions } from '@ontrails/permits/jwt';
import {
  createPermitForTrail,
  createTestPermit,
} from '@ontrails/permits/testing';

describe('@ontrails/permits public API', () => {
  test('keeps test helpers on the testing entrypoint', () => {
    expect('createTestPermit' in permits).toBe(false);
    expect('createPermitForTrail' in permits).toBe(false);

    expect(createTestPermit({ scopes: ['entity:read'] }).scopes).toEqual([
      'entity:read',
    ]);
    expect(createPermitForTrail({ permit: 'public' })).toBeUndefined();
  });

  test('does not expose the legacy auth layer wrapper', () => {
    expect('authLayer' in permits).toBe(false);
  });

  test('exposes the callback adapter and normalized boundary on the existing root', () => {
    expect(typeof createTokenCallbackAdapter).toBe('function');
    expect(typeof resolvePermitFromInput).toBe('function');
  });

  test('keeps JWT adapter APIs canonical on the jwt subpath with root convenience', () => {
    const options: JwtAdapterOptions = { secret: 'test-secret' };

    expect(createJwtAdapterFromSubpath(options)).toBeDefined();
    expect(permits.createJwtAdapter).toBe(createJwtAdapterFromSubpath);
    expect(
      authAdapterSchema.safeParse({ authenticate: () => {} }).success
    ).toBe(true);
  });
});
