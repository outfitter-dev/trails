import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { createServer, surface } from '../surface.js';
import { deriveMcpTools } from '../build.js';
import type { McpToolDefinition, ResolveMcpPermitInput } from '../build.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const unwrapOk = <T>(result: Result<T, Error>): T =>
  result.match({
    err: (error) => {
      throw error;
    },
    ok: (value) => value,
  });

const requireTool = (tools: McpToolDefinition[], name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Expected tool: ${name}`);
  }
  return tool;
};

/**
 * Unwrap deriveMcpTools result, throwing on error so test failures show up clearly.
 */
const deriveTools = (
  ...args: Parameters<typeof deriveMcpTools>
): McpToolDefinition[] => {
  const result = deriveMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const createIntegrationFixtures = () => {
  const greetTrail = trail('greet', {
    description: 'Greet someone',
    implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
    input: z.object({ name: z.string() }),
    intent: 'read',
  });

  const deleteTrail = trail('item.delete', {
    description: 'Delete an item',
    implementation: (_input) => Result.ok({ deleted: true }),
    input: z.object({ id: z.string() }),
    intent: 'destroy',
  });

  const app = topo('myapp', { deleteTrail, greetTrail });
  return { app, tools: deriveTools(app) };
};

describe('surface', () => {
  test('surface throws on invalid topo', async () => {
    const t = trail('broken', {
      composes: ['nonexistent.trail'],
      implementation: () => Result.ok({}),
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    await expect(surface(app)).rejects.toThrow(/validation/i);
  });

  test('surface skips validation when validate: false', async () => {
    const t = trail('broken', {
      composes: ['nonexistent.trail'],
      implementation: () => Result.ok({}),
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    const result = await Promise.race([
      surface(app, { validate: false }).then(() => 'resolved' as const),
      // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based timeout
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => {
          resolve('timeout');
        }, 50);
      }),
    ]);
    expect(['resolved', 'timeout']).toContain(result);
  });

  test('CreateServerOptions accepts flattened identity and resource fields', () => {
    const opts: Parameters<typeof surface>[1] = {
      description: 'Test MCP server',
      mcpResources: { examples: true, surfaceMap: true },
      name: 'testapp',
      resources: {},
      trailheads: {
        read: {
          description: 'Read tools.',
          trails: 'read.*',
        },
      },
      validate: false,
      version: '1.2.3',
    };
    expect(opts.description).toBe('Test MCP server');
    expect(opts.trailheads?.read?.trails).toBe('read.*');
    expect(opts.mcpResources).toEqual({ examples: true, surfaceMap: true });
    expect(opts.name).toBe('testapp');
    expect(opts.resources).toEqual({});
    expect(opts.validate).toBe(false);
    expect(opts.version).toBe('1.2.3');
  });

  test('createServer registers tools that can be listed', () => {
    const echoTrail = trail('echo', {
      description: 'Echo',
      implementation: (input) => Result.ok({ reply: input.message }),
      input: z.object({ message: z.string() }),
      intent: 'read',
    });

    const app = topo('testapp', { echoTrail });
    const server = createServer(app, {
      name: 'testapp',
      version: '0.1.0',
    });

    // Server is created successfully
    expect(server).toBeDefined();
  });

  test('createServer handles multiple tools', () => {
    const echoTrail = trail('echo', {
      description: 'Echo',
      implementation: (input) => Result.ok({ reply: input.message }),
      input: z.object({ message: z.string() }),
    });

    const searchTrail = trail('search', {
      description: 'Search',
      implementation: (input) => Result.ok({ results: [input.query] }),
      input: z.object({ query: z.string() }),
      intent: 'read',
    });

    const app = topo('testapp', { echoTrail, searchTrail });
    const tools = deriveTools(app);

    expect(tools).toHaveLength(2);

    const server = createServer(app, {
      name: 'testapp',
      version: '0.1.0',
    });
    expect(server).toBeDefined();
  });

  test('createServer rejects unknown MCP resources as protocol errors', async () => {
    const { app } = createIntegrationFixtures();
    const server = createServer(app, {
      mcpResources: { surfaceMap: true },
      name: 'testapp',
      version: '0.1.0',
    });
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]);

      await expect(
        client.readResource({ uri: 'trails://missing' })
      ).rejects.toMatchObject({
        code: -32_602,
        data: {
          category: 'not_found',
          name: 'NotFoundError',
          retryable: false,
        },
      });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });

  test('deriveMcpTools returns tools and createServer materializes the server', () => {
    const echoTrail = trail('echo', {
      description: 'Echo',
      implementation: (input) => Result.ok({ reply: input.message }),
      input: z.object({ message: z.string() }),
    });
    const app = topo('surface-api', { echoTrail });

    const tools = unwrapOk(deriveMcpTools(app));
    expect(tools).toHaveLength(1);

    const server = createServer(app, {
      description: 'Surface API smoke',
      version: '2.0.0',
    });
    expect(server).toBeDefined();
  });

  test('deriveMcpTools + createServer integration', () => {
    const { app, tools } = createIntegrationFixtures();
    const names = tools.map((t) => t.name);
    expect(names).toContain('myapp_greet');
    expect(names).toContain('myapp_item_delete');

    expect(requireTool(tools, 'myapp_greet').annotations?.readOnlyHint).toBe(
      true
    );
    expect(
      requireTool(tools, 'myapp_item_delete').annotations?.destructiveHint
    ).toBe(true);

    const server = createServer(app, {
      name: 'myapp',
      version: '1.0.0',
    });
    expect(server).toBeDefined();
  });

  for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
    test(`does not forward session context to permits in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      let observedInput: ResolveMcpPermitInput | undefined;
      const identity = trail('identity', {
        implementation: (_input, ctx) =>
          Result.ok({ id: ctx.permit?.id ?? 'anonymous' }),
        input: z.object({}),
        intent: 'read',
        output: z.object({ id: z.string() }),
        permit: { scopes: ['identity:read'] },
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      serverTransport.sessionId = 'legacy-connection';
      const send = clientTransport.send.bind(clientTransport);
      clientTransport.send = (message, options) =>
        send(message, {
          ...options,
          authInfo: {
            clientId: 'fixture-client',
            scopes: [],
            token: 'fixture-token',
          },
        });
      const factory = () =>
        createServer(topo('compat', { identity }), {
          resolvePermit: (input) => {
            observedInput = input;
            return Result.ok({
              actors: [],
              id:
                input.bearerToken ??
                (input._meta?.['requestCredential'] === 'fixture'
                  ? 'metadata-user'
                  : 'missing-token'),
              scopes: ['identity:read'],
            });
          },
        });
      // Stdio is outside HTTP auth; its credential fixture uses request metadata.
      // The legacy custom host also supplies the former SDK session context.
      const modern = typeof mode === 'object';
      const server = modern ? undefined : factory();
      const serving = modern
        ? serveStdio(factory, { transport: serverTransport })
        : undefined;
      const client = new Client(
        { name: 'compat-client', version: '1.0.0' },
        { versionNegotiation: { mode } }
      );
      try {
        await Promise.all([
          client.connect(clientTransport),
          server?.connect(serverTransport),
        ]);
        const result = await client.callTool({
          _meta: { requestCredential: 'fixture' },
          arguments: {},
          name: 'compat_identity',
        });
        expect(observedInput).toMatchObject({
          _meta: { requestCredential: 'fixture' },
          bearerToken: modern ? undefined : 'fixture-token',
        });
        expect(Object.hasOwn(observedInput ?? {}, 'sessionId')).toBe(false);
        expect(result.structuredContent).toEqual({
          id: modern ? 'metadata-user' : 'fixture-token',
        });
      } finally {
        await Promise.allSettled([
          client.close(),
          server?.close(),
          serving?.close(),
        ]);
      }
    });
  }
});
