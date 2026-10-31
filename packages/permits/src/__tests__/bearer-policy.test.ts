import { describe, expect, test } from 'bun:test';

import { createJwtAdapter } from '../adapters/jwt.js';
import { resolvePermitFromInput } from '../boundary.js';
import { topo } from '@ontrails/core';
import { TEST_SECRET, signJwt } from './helpers/jwt.js';

const input = { requestId: 'request-bearer', surface: 'http' as const };

describe('JWT accepted Bearer source policy', () => {
  test('distinguishes missing credentials from a selected malformed Bearer', async () => {
    const adapter = createJwtAdapter({ secret: TEST_SECRET });
    const absent = await adapter.authenticate(input);
    expect(absent.unwrap()).toBeNull();
    for (const authorization of [
      'Bearer',
      'Bearer ',
      'Bearer\tbad',
      ' Bearer bad',
      'Bearer bad token',
      'Bearer bad\r\n',
    ]) {
      const result = await adapter.authenticate({ ...input, authorization });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('invalid_token');
      }
    }
    const empty = await adapter.authenticate({ ...input, bearerToken: '' });
    expect(empty.isErr()).toBe(true);
  });

  test('verifies raw Bearer input and never rescues a malformed selected source with another candidate', async () => {
    const token = await signJwt(
      { exp: Math.floor(Date.now() / 1000) + 300, sub: 'user-42' },
      TEST_SECRET
    );
    const adapter = createJwtAdapter({ secret: TEST_SECRET });
    const valid = await adapter.authenticate({
      ...input,
      authorization: `bEaReR ${token}`,
    });
    expect(valid.unwrap()?.id).toBe('user-42');
    for (const authorization of [
      'Bearer',
      `Bearer ${token}\n`,
      `Bearer\t${token}`,
    ]) {
      const rejected = await adapter.authenticate({
        ...input,
        apiKey: 'alternative',
        authorization,
        bearerToken: token,
      });
      expect(rejected.isErr()).toBe(true);
    }
  });

  test('leaves unrelated Authorization to other policies when no Bearer was selected', async () => {
    const result = await createJwtAdapter({ secret: TEST_SECRET }).authenticate(
      { ...input, apiKey: 'not-a-jwt-source', authorization: 'Basic unrelated' }
    );
    expect(result.unwrap()).toBeNull();
  });

  test('preserves selected malformed errors through the normalized boundary', async () => {
    const result = await resolvePermitFromInput({
      ...input,
      authorization: 'Bearer',
      graph: topo('bearer-policy'),
      resources: { auth: createJwtAdapter({ secret: TEST_SECRET }) },
    });
    expect(result.isErr()).toBe(true);
  });
});
