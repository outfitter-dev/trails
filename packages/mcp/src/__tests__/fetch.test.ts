import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { describe, expect, test } from 'bun:test';
import {
  AuthError,
  PermissionError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { createFetchHandler } from '../fetch.js';
import type { ResolveMcpPermitInput } from '../build.js';

describe('portable MCP fetch entry', () => {
  for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
    test(`close cancels an active ${typeof mode === 'object' ? 'modern' : 'legacy'} exchange`, async () => {
      const started = Promise.withResolvers<undefined>();
      let signal: AbortSignal | undefined;
      const graph = topo('shutdown', {
        wait: trail('wait', {
          implementation: async (_input, ctx) => {
            signal = ctx.abortSignal;
            started.resolve();
            // oxlint-disable-next-line avoid-new -- Deliberately pending user work exercises host teardown.
            return await new Promise<Result<{ ok: boolean }, Error>>(() => {});
          },
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          permit: 'public',
        }),
      });
      const handler = createFetchHandler(graph);
      const client = new Client(
        { name: 'close-test', version: '1' },
        { versionNegotiation: { mode } }
      );
      let streamEnd: Promise<string> | undefined;
      const transport = new StreamableHTTPClientTransport(
        new URL('http://localhost/mcp'),
        {
          fetch: async (input, init) => {
            const response = await handler.fetch(new Request(input, init));
            if (
              response.headers
                .get('content-type')
                ?.includes('text/event-stream')
            ) {
              streamEnd = response.clone().text();
            }
            return response;
          },
        }
      );
      try {
        await client.connect(transport);
        const pending = client.callTool({
          arguments: {},
          name: 'shutdown_wait',
        });
        const outcome = pending.then(
          () => 'settled',
          () => 'settled'
        );
        await started.promise;
        await handler.close();
        expect(signal?.aborted).toBe(true);
        if (mode === 'legacy') {
          expect(streamEnd).toBeDefined();
          expect(
            await Promise.race([
              streamEnd?.then(() => 'closed'),
              Bun.sleep(200).then(() => 'pending'),
            ])
          ).toBe('closed');
        } else {
          expect(
            await Promise.race([outcome, Bun.sleep(200).then(() => 'pending')])
          ).toBe('settled');
        }
        // Legacy SDK calls can retain their deadline after EOF; the client owns cancellation.
        await client.close();
        expect(await outcome).toBe('settled');
        await expect(
          handler.fetch(new Request('http://localhost/mcp'))
        ).rejects.toThrow(/closed/);
        await handler.close();
      } finally {
        await Promise.allSettled([client.close(), handler.close()]);
      }
    });
  }

  for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
    test(`serves a real SDK client with request credentials in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      let invocations = 0;
      const app = topo('fetch', {
        identity: trail('identity.read', {
          implementation: (_input, ctx) => {
            invocations += 1;
            return Result.ok({ caller: ctx.permit?.id ?? 'anonymous' });
          },
          input: z.object({}),
          intent: 'read',
          output: z.object({ caller: z.string() }),
          permit: { scopes: ['identity:read'] },
        }),
      });
      const seen: ResolveMcpPermitInput[] = [];
      const handler = createFetchHandler(app, {
        authorizeResourceRead: ({ permit }) =>
          permit?.id === 'verified-user'
            ? Result.ok()
            : Result.err(new PermissionError('Private resources')),
        resolvePermit: (input) => {
          seen.push(input);
          return input.authorization === 'opaque-key' &&
            input._meta?.['credential'] === 'request'
            ? Result.ok({ id: 'verified-user', scopes: ['identity:read'] })
            : Result.err(new AuthError('Invalid credential'));
        },
      });
      let authorization = 'opaque-key';
      const transport = new StreamableHTTPClientTransport(
        new URL('http://localhost/mcp'),
        {
          fetch: (input, init) => {
            const request = new Request(input, init);
            request.headers.set('authorization', authorization);
            return handler.fetch(request);
          },
        }
      );
      const client = new Client(
        { name: 'fetch-test', version: '1' },
        { versionNegotiation: { mode } }
      );
      try {
        await client.connect(transport);
        const success = await client.callTool({
          _meta: { credential: 'request' },
          arguments: {},
          name: 'fetch_identity_read',
        });
        expect(success.structuredContent).toEqual({ caller: 'verified-user' });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
          _meta: { credential: 'request' },
          authorization: 'opaque-key',
          bearerToken: undefined,
        });
        const listed = await client.listResources({
          _meta: { credential: 'request' },
        });
        expect(listed.resources).toHaveLength(1);
        expect(seen).toHaveLength(2);
        const content = await client.readResource({
          _meta: { credential: 'request' },
          uri: 'trails://surface-map',
        });
        expect(content.contents).toHaveLength(1);
        expect(seen).toHaveLength(3);
        authorization = 'invalid-key';
        const denied = await client.callTool({
          _meta: { credential: 'request' },
          arguments: {},
          name: 'fetch_identity_read',
        });
        expect(denied.isError).toBe(true);
        await expect(
          client.readResource({
            _meta: { credential: 'request' },
            uri: 'trails://surface-map',
          })
        ).rejects.toMatchObject({ data: { category: 'auth' } });
        expect(seen).toHaveLength(5);
        expect(invocations).toBe(1);
      } finally {
        await Promise.allSettled([client.close(), handler.close()]);
      }
    });
  }

  test('mounts the same handler on a real Bun HTTP server', async () => {
    const app = topo('bun-mount', {
      read: trail('read', {
        implementation: () => Result.ok({ ok: true }),
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        permit: 'public',
      }),
    });
    const handler = createFetchHandler(app);
    const server = Bun.serve({
      fetch: handler.fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    const client = new Client(
      { name: 'bun-test', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL('/mcp', server.url))
      );
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['bun_mount_read']);
      const result = await client.callTool({
        arguments: {},
        name: 'bun_mount_read',
      });
      expect(result.structuredContent).toEqual({ ok: true });
    } finally {
      await Promise.allSettled([client.close(), handler.close()]);
      server.stop(true);
    }
  });

  test('retains modern request-scoped SSE progress before the terminal result', async () => {
    const app = topo('progress', {
      read: trail('read', {
        implementation: (_input, ctx) => {
          ctx.progress?.({
            current: 1,
            total: 1,
            ts: new Date().toISOString(),
            type: 'progress',
          });
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        permit: 'public',
      }),
    });
    const handler = createFetchHandler(app);
    let wire: Promise<string> | undefined;
    const client = new Client(
      { name: 'progress-test', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/mcp'),
      {
        fetch: async (input, init) => {
          const response = await handler.fetch(new Request(input, init));
          if (
            response.headers.get('content-type')?.includes('text/event-stream')
          ) {
            wire = response.clone().text();
          }
          return response;
        },
      }
    );
    try {
      await client.connect(transport);
      const result = await client.callTool(
        { arguments: {}, name: 'progress_read' },
        { onprogress: () => {} }
      );
      expect(result.structuredContent).toEqual({ ok: true });
      expect(wire).toBeDefined();
      const messages = await wire;
      expect(messages).toContain('notifications/progress');
      expect(messages?.indexOf('notifications/progress')).toBeLessThan(
        messages?.lastIndexOf('"result"') ?? -1
      );
    } finally {
      await Promise.allSettled([client.close(), handler.close()]);
    }
  });

  test('bundles the portable entry for browser runtimes without Node externals', async () => {
    const bundle = await Bun.build({
      entrypoints: [new URL('../fetch.ts', import.meta.url).pathname],
      format: 'esm',
      target: 'browser',
    });
    expect(bundle.logs).toEqual([]);
    expect(bundle.success).toBe(true);
    expect(bundle.outputs).toHaveLength(1);
  });
  for (const removedHeader of ['mcp-method', 'mcp-name']) {
    test(`preserves SDK rejection before dispatch when ${removedHeader} is missing`, async () => {
      let invocations = 0;
      let resolutions = 0;
      const app = topo('headers', {
        read: trail('read', {
          implementation: () => {
            invocations += 1;
            return Result.ok({ ok: true });
          },
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          permit: 'public',
        }),
      });
      const handler = createFetchHandler(app, {
        resolvePermit: () => {
          resolutions += 1;
          return Result.ok(null);
        },
      });
      let rejectedStatus: number | undefined;
      const transport = new StreamableHTTPClientTransport(
        new URL('http://localhost/mcp'),
        {
          fetch: async (input, init) => {
            const request = new Request(input, init);
            const isCall = request.headers.get('mcp-method') === 'tools/call';
            if (isCall) {
              request.headers.delete(removedHeader);
            }
            const response = await handler.fetch(request);
            if (isCall) {
              rejectedStatus = response.status;
            }
            expect(response.headers.has('mcp-session-id')).toBe(false);
            return response;
          },
        }
      );
      const client = new Client(
        { name: 'header-test', version: '1' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      );
      try {
        await client.connect(transport);
        await expect(
          client.callTool({ arguments: {}, name: 'headers_read' })
        ).rejects.toThrow();
        expect(rejectedStatus).toBe(400);
        expect(invocations).toBe(0);
        expect(resolutions).toBe(0);
        for (const method of ['GET', 'DELETE']) {
          const response = await handler.fetch(
            new Request('http://localhost/mcp', {
              headers: {
                'last-event-id': 'obsolete-replay',
                'mcp-protocol-version': '2026-07-28',
              },
              method,
            })
          );
          expect(response.status).toBe(405);
          expect(response.headers.has('mcp-session-id')).toBe(false);
        }
      } finally {
        await Promise.allSettled([client.close(), handler.close()]);
      }
    });
  }
});
