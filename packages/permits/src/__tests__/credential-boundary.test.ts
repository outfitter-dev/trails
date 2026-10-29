import { describe, expect, test } from 'bun:test';
import { AuthError, Result, topo } from '@ontrails/core';

import {
  resolvePermitFromInput,
  resolvePermitFromBearerToken,
} from '../boundary.js';
import { createTokenCallbackAdapter } from '../adapters/token-callback.js';
import type { PermitExtractionInput } from '../extraction.js';

const graph = topo('credential-boundary');
const permit = { actors: [], id: 'org-42', scopes: ['org:read'] };
const options = { graph, requestId: 'req-key', surface: 'http' as const };

describe('normalized credential boundary', () => {
  test('passes all candidates to the adapter without requiring Bearer', async () => {
    let observed: PermitExtractionInput | undefined;
    const headers = new Headers({ 'x-api-key': 'key-bytes' });
    const result = await resolvePermitFromInput({
      ...options,
      apiKey: 'key-bytes',
      authToken: 'other-candidate',
      authorization: 'raw-key',
      headers,
      resources: {
        auth: {
          authenticate: async (input: PermitExtractionInput) => {
            observed = input;
            return Result.ok(permit);
          },
        },
      },
    });
    expect(result.unwrap()).toEqual(permit);
    expect(observed).toMatchObject({
      apiKey: 'key-bytes',
      authToken: 'other-candidate',
      authorization: 'raw-key',
    });
    expect(observed?.headers).toBe(headers);
  });

  test('preserves adapter absence while the strict Bearer wrapper rejects null', async () => {
    const resources = { auth: { authenticate: async () => Result.ok(null) } };
    const optional = await resolvePermitFromInput({ ...options, resources });
    expect(optional.unwrap()).toBeNull();
    const strict = await resolvePermitFromBearerToken({
      ...options,
      bearerToken: 'selected',
      resources,
    });
    expect(strict.isErr()).toBe(true);
    if (strict.isErr()) {
      expect(strict.error).toBeInstanceOf(AuthError);
    }
  });

  test('preserves callback lookup failure through normalized HTTP and MCP inputs', async () => {
    const keys = new Map([['valid', permit]]);
    const adapter = createTokenCallbackAdapter({
      extractToken: (input) => input.apiKey,
      lookup: async (token) => Result.ok(keys.get(token) ?? null),
    });
    for (const surface of ['http', 'mcp'] as const) {
      for (const apiKey of [undefined, 'valid', 'missing']) {
        const result = await resolvePermitFromInput({
          ...options,
          apiKey,
          resources: { auth: adapter },
          surface,
        });
        if (apiKey === undefined) {
          expect(result.unwrap()).toBeNull();
        } else if (apiKey === 'valid') {
          expect(result.unwrap()).toEqual(permit);
        } else {
          expect(result.isErr()).toBe(true);
          if (result.isErr()) {
            expect(result.error).toBeInstanceOf(AuthError);
          }
        }
      }
    }
  });

  test('normalizes callback failures and validates permits in the shared boundary', async () => {
    for (const outcome of [
      Result.err({
        code: 'invalid_token',
        message: 'Selected credential rejected',
      }),
      Result.ok({ actors: [], id: 'bad', scopes: 'invalid' }),
    ]) {
      const result = await resolvePermitFromInput({
        ...options,
        apiKey: 'selected',
        resources: { auth: { authenticate: async () => outcome } },
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(AuthError);
      }
    }
  });
});
