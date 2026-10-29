import { describe, expect, test } from 'bun:test';
import { Result } from '@ontrails/core';

import { createTokenCallbackAdapter } from '../adapters/token-callback.js';
import type { AuthError } from '../adapters/adapter.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

const input: PermitExtractionInput = {
  apiKey: 'chosen',
  authToken: 'alternate',
  requestId: 'req',
  surface: 'http',
};
const permit: Permit = { id: 'org-42', scopes: ['org:read'] };

describe('token callback adapter', () => {
  test('distinguishes absence from a selected empty credential without lookup', async () => {
    for (const token of [undefined, '']) {
      let selections = 0;
      let lookups = 0;
      const adapter = createTokenCallbackAdapter({
        extractToken: () => {
          selections += 1;
          return token;
        },
        lookup: async () => {
          lookups += 1;
          return Result.ok(permit);
        },
      });
      const result = await adapter.authenticate(input);
      expect(selections).toBe(1);
      expect(lookups).toBe(0);
      if (token === undefined) {
        expect(result.unwrap()).toBeNull();
      } else {
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error.code).toBe('invalid_token');
        }
      }
    }
  });

  test('uses a portable mock lookup for hit, miss and operational error', async () => {
    const store = new Map<string, Permit>([['chosen', permit]]);
    let lookups = 0;
    const lookup = async (
      token: string
    ): Promise<Result<Permit | null, AuthError>> => {
      lookups += 1;
      return token === 'offline'
        ? Result.err({ code: 'invalid_token', message: 'Lookup unavailable' })
        : Result.ok(store.get(token) ?? null);
    };
    const adapter = createTokenCallbackAdapter({
      extractToken: (value) => value.apiKey,
      lookup,
    });
    const hit = await adapter.authenticate(input);
    expect(hit.unwrap()).toEqual(permit);
    for (const apiKey of ['missing', 'offline']) {
      const result = await adapter.authenticate({ ...input, apiKey });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('invalid_token');
      }
    }
    expect(lookups).toBe(3);
  });

  test('preserves exact opaque bytes and never falls back to another candidate', async () => {
    const token = '  Case%2Fopaque\t';
    let selections = 0;
    const seen: string[] = [];
    const adapter = createTokenCallbackAdapter({
      extractToken: (value) => {
        selections += 1;
        return value.apiKey;
      },
      lookup: async (selected, original) => {
        seen.push(selected);
        expect(original.authToken).toBe('alternate');
        return Result.ok(null);
      },
    });
    const result = await adapter.authenticate({ ...input, apiKey: token });
    expect(result.isErr()).toBe(true);
    expect(selections).toBe(1);
    expect(seen).toEqual([token]);
  });

  test('sanitizes exceptions from both extraction and lookup', async () => {
    const secret = 'do-not-disclose-credential';
    for (const extractionFails of [true, false]) {
      const adapter = createTokenCallbackAdapter({
        extractToken: () => {
          if (extractionFails) {
            throw new Error(secret);
          }
          return secret;
        },
        lookup: async () => {
          throw new Error(secret);
        },
      });
      const result = await adapter.authenticate(input);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('invalid_token');
        expect(JSON.stringify(result.error)).not.toContain(secret);
      }
    }
  });
});
