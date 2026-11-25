import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createFetchHandler } from '@ontrails/mcp/fetch';
import { PermissionError, Result, topo, trail } from '@ontrails/core';
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { z } from 'zod';

describe('MCP Hono mount', () => {
  for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
    test(`shares the fetch handler in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      let resolutions = 0;
      const graph = topo('hono', {
        read: trail('read', {
          implementation: () => Result.ok({ ok: true }),
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          permit: { scopes: ['read'] },
        }),
      });
      const mcp = createFetchHandler(graph, {
        authorizeResourceRead: ({ permit }) =>
          permit === undefined
            ? Result.err(new PermissionError('Private resource'))
            : Result.ok(),
        resolvePermit: (input) => {
          resolutions += 1;
          expect(input.bearerToken).toBe('allowed');
          return Result.ok({ actors: [], id: 'hono-user', scopes: ['read'] });
        },
      });
      const app = new Hono();
      app.all('/mcp', (context) => mcp.fetch(context.req.raw));
      app.get('/health', (context) => context.json({ ok: true }));
      const client = new Client(
        { name: 'hono-client', version: '1' },
        { versionNegotiation: { mode } }
      );
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
            fetch: async (input, init) =>
              await app.fetch(new Request(input, init)),
            requestInit: { headers: { authorization: 'Bearer allowed' } },
          })
        );
        const result = await client.callTool({
          arguments: {},
          name: 'hono_read',
        });
        expect(result.structuredContent).toEqual({ ok: true });
        const resource = await client.readResource({
          uri: 'trails://surface-map',
        });
        expect(resource.contents).toHaveLength(1);
        expect(resolutions).toBe(2);
        const denied = await app.request('http://localhost/mcp', {
          body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { arguments: {}, name: 'hono_read' },
          }),
          headers: {
            'content-type': 'application/json',
            origin: 'https://untrusted.example',
          },
          method: 'POST',
        });
        expect(denied.status).toBe(403);
        expect(resolutions).toBe(2);
        const health = await app.request('http://localhost/health');
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ ok: true });
      } finally {
        await Promise.allSettled([client.close(), mcp.close()]);
      }
    });
  }
});
