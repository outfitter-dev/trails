import { describe, expect, test } from 'bun:test';
import { Result, trail, topo } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';
import { createFetchHandler } from '@ontrails/http/fetch';
import { createJwtAdapter } from '@ontrails/permits/jwt';
import {
  createTokenCallbackAdapter,
  resolvePermitFromInput,
} from '@ontrails/permits';
import type { AuthAdapter } from '@ontrails/permits';
import { z } from 'zod';

const createApp = (adapter: AuthAdapter, protectedTrail: boolean) => {
  const calls: string[] = [];
  const read = trail('record.read', {
    implementation: (_input, ctx) => {
      calls.push('execute');
      return Result.ok({ id: ctx.permit?.id ?? 'anonymous' });
    },
    input: z.object({}),
    intent: 'read',
    output: z.object({ id: z.string() }),
    permit: protectedTrail ? { scopes: ['record:read'] } : 'public',
  });
  const graph = topo('opaque-credentials', { read });
  const fetch = createFetchHandler(graph, {
    resolvePermit: (input) =>
      resolvePermitFromInput({
        ...input,
        graph,
        headers: input.headers instanceof Headers ? input.headers : undefined,
        requestId: input.requestId ?? 'request-test',
        resources: { auth: adapter },
        surface: 'http',
      }),
  });
  return { calls, fetch };
};

describe('opaque and Bearer HTTP auth boundary', () => {
  test('default JWT rejects malformed presented Bearer before public or protected execution', async () => {
    for (const protectedTrail of [false, true]) {
      const { calls, fetch } = createApp(
        createJwtAdapter({ secret: 'test-secret' }),
        protectedTrail
      );
      const response = await fetch(
        new Request('https://example.test/record/read', {
          headers: { Authorization: 'Bearer' },
        })
      );
      expect(response.status).toBe(401);
      expect(calls).toEqual([]);
    }
  });

  test('portable key lookup propagates organization identity and fails selected misses without fallback', async () => {
    const keys = new Map<string, BasePermit>([
      ['trusted-key', { id: 'org-42', scopes: ['record:read'] }],
    ]);
    const adapter = createTokenCallbackAdapter({
      extractToken: (input) => input.apiKey,
      lookup: async (token) => Result.ok(keys.get(token) ?? null),
    });
    const { fetch } = createApp(adapter, true);
    const accepted = await fetch(
      new Request('https://example.test/record/read', {
        headers: { Authorization: 'Bearer', 'x-api-key': 'trusted-key' },
      })
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ data: { id: 'org-42' } });
    const denied = await fetch(
      new Request('https://example.test/record/read', {
        headers: { 'x-api-key': 'missing', 'x-auth-token': 'trusted-key' },
      })
    );
    expect(denied.status).toBe(401);
  });
});
