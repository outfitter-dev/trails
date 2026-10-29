import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { describe, expect, test } from 'bun:test';

import {
  AuthError,
  createTrailContext,
  PermissionError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { MCP_SURFACE_MAP_RESOURCE_URI } from '../resources.js';
import type { McpResourceDefinition } from '../resources.js';
import { createServer } from '../surface.js';
import type { CreateServerOptions } from '../surface.js';

const createApp = () => {
  const read = trail('items.read', {
    examples: [{ expected: { id: 'one' }, input: { id: 'one' }, name: 'one' }],
    implementation: (input) => Result.ok(input),
    input: z.object({ id: z.string() }),
    intent: 'read',
    output: z.object({ id: z.string() }),
    permit: 'public',
  });
  return topo('resource-access', { read });
};

const withClient = async (
  options: CreateServerOptions,
  run: (client: Client) => Promise<void>,
  fixture: { bearerToken?: string; modern?: boolean } = {}
) => {
  const factory = () => createServer(createApp(), options);
  const server = fixture.modern ? undefined : factory();
  const client = new Client(
    { name: 'resource-policy-test', version: '1' },
    {
      versionNegotiation: {
        mode: fixture.modern ? { pin: '2026-07-28' } : 'legacy',
      },
    }
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const { bearerToken } = fixture;
  if (bearerToken !== undefined) {
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, sendOptions) =>
      send(message, {
        ...sendOptions,
        authInfo: { clientId: 'test', scopes: [], token: bearerToken },
      });
  }
  const serving = fixture.modern
    ? serveStdio(factory, { transport: serverTransport })
    : undefined;
  try {
    await Promise.all([
      client.connect(clientTransport),
      server?.connect(serverTransport),
    ]);
    await run(client);
  } finally {
    await Promise.allSettled([
      client.close(),
      server?.close(),
      serving?.close(),
    ]);
  }
};

describe('MCP resource access', () => {
  test('rejects invalid credentials before returning public resource bytes', async () => {
    let resolutions = 0;
    await withClient(
      {
        resolvePermit: (input) => {
          resolutions += 1;
          expect(input._meta).toMatchObject({ credential: 'invalid' });
          return Result.err(new AuthError('Invalid credential'));
        },
      },
      async (client) => {
        await expect(
          client.readResource({
            _meta: { credential: 'invalid' },
            uri: MCP_SURFACE_MAP_RESOURCE_URI,
          })
        ).rejects.toMatchObject({ data: { category: 'auth' } });
        expect(resolutions).toBe(1);
      }
    );
  });

  test('filters each family with one verification per request and rechecks direct reads', async () => {
    let resolutions = 0;
    const targets: McpResourceDefinition[] = [];
    const examplesUri = 'trails://examples/items.read';
    await withClient(
      {
        authorizeResourceRead: ({ permit, resource }) => {
          targets.push(resource);
          return permit?.id === 'alice' && resource.trailId === 'items.read'
            ? Result.ok()
            : Result.err(new PermissionError('Private resource'));
        },
        mcpResources: { graph: true },
        resolvePermit: (input) => {
          resolutions += 1;
          return Result.ok({ id: String(input._meta?.['caller']), scopes: [] });
        },
      },
      async (client) => {
        const alice = await client.listResources({
          _meta: { caller: 'alice' },
        });
        expect(alice.resources.map((resource) => resource.uri)).toEqual([
          examplesUri,
          'trails://trail/items.read',
        ]);
        expect(resolutions).toBe(1);
        expect(targets).toContainEqual(
          expect.objectContaining({ uri: MCP_SURFACE_MAP_RESOURCE_URI })
        );
        expect(
          targets.find((target) => target.uri === MCP_SURFACE_MAP_RESOURCE_URI)
            ?.trailId
        ).toBeUndefined();
        const bob = await client.listResources({ _meta: { caller: 'bob' } });
        expect(bob.resources).toEqual([]);
        expect(resolutions).toBe(2);
        await expect(
          client.readResource({
            _meta: { caller: 'bob' },
            uri: examplesUri,
          })
        ).rejects.toMatchObject({ data: { category: 'permission' } });
        expect(resolutions).toBe(3);
        const allowed = await client.readResource({
          _meta: { caller: 'alice' },
          uri: examplesUri,
        });
        expect(allowed.contents[0]).toMatchObject({ uri: examplesUri });
        expect(resolutions).toBe(4);
        await expect(
          client.readResource({
            _meta: { caller: 'bob' },
            uri: examplesUri,
          })
        ).rejects.toMatchObject({ data: { category: 'permission' } });
        expect(resolutions).toBe(5);
      }
    );
  });

  test('keeps all built-in families public by default and checks credentials on empty lists', async () => {
    await withClient({ mcpResources: { graph: true } }, async (client) => {
      const listed = await client.listResources();
      expect(listed.resources.map((resource) => resource.uri)).toEqual([
        'trails://surface-map',
        'trails://examples/items.read',
        'trails://trail/items.read',
      ]);
      for (const uri of [
        'trails://surface-map',
        'trails://examples/items.read',
        'trails://trail/items.read',
      ]) {
        const read = await client.readResource({ uri });
        expect(read.contents).toHaveLength(1);
      }
    });
    let resolutions = 0;
    await withClient(
      {
        mcpResources: { examples: false, surfaceMap: false },
        resolvePermit: () => {
          resolutions += 1;
          return Result.ok(null);
        },
      },
      async (client) => {
        const listed = await client.listResources();
        expect(listed.resources).toEqual([]);
        expect(resolutions).toBe(1);
      }
    );
  });

  test('verifies a host-supplied bearer and rejects invalid credentials on listing', async () => {
    let resolutions = 0;
    await withClient(
      {
        resolvePermit: (input) => {
          resolutions += 1;
          expect(input.authorization).toBe('Bearer invalid-token');
          expect(input.bearerToken).toBe('invalid-token');
          return Result.err(new AuthError('Rejected token'));
        },
      },
      async (client) => {
        await expect(client.listResources()).rejects.toMatchObject({
          data: { category: 'auth' },
        });
        expect(resolutions).toBe(1);
      },
      { bearerToken: 'invalid-token' }
    );
  });

  for (const modern of [false, true]) {
    test(`rechecks metadata-only credentials for all reads in ${modern ? 'modern' : 'legacy'} era`, async () => {
      let resolutions = 0;
      await withClient(
        {
          authorizeResourceRead: ({ permit }) => {
            expect(permit?.id).toBe('metadata-user');
            return Result.ok();
          },
          mcpResources: { graph: true },
          resolvePermit: (input) => {
            resolutions += 1;
            expect(input.bearerToken).toBeUndefined();
            return input._meta?.['credential'] === 'valid'
              ? Result.ok({ id: 'metadata-user', scopes: [] })
              : Result.err(new AuthError('Rejected metadata'));
          },
        },
        async (client) => {
          await expect(
            client.listResources({ _meta: { credential: 'invalid' } })
          ).rejects.toMatchObject({ data: { category: 'auth' } });
          const listed = await client.listResources({
            _meta: { credential: 'valid' },
          });
          expect(listed.resources).toHaveLength(3);
          for (const uri of [
            'trails://surface-map',
            'trails://examples/items.read',
            'trails://trail/items.read',
          ]) {
            await expect(
              client.readResource({ _meta: { credential: 'invalid' }, uri })
            ).rejects.toMatchObject({ data: { category: 'auth' } });
            const read = await client.readResource({
              _meta: { credential: 'valid' },
              uri,
            });
            expect(read.contents[0]).toMatchObject({ uri });
          }
          expect(resolutions).toBe(8);
        },
        { modern }
      );
    });
  }

  test('uses host permit only after credential absence and never after failure', async () => {
    let state: 'absent' | 'valid' | 'invalid' = 'absent';
    let factories = 0;
    const seen: (string | undefined)[] = [];
    await withClient(
      {
        authorizeResourceRead: ({ permit }) => {
          seen.push(permit?.id);
          return Result.ok();
        },
        createContext: () => {
          factories += 1;
          return createTrailContext({
            permit: { id: 'host-user', scopes: [] },
          });
        },
        resolvePermit: () =>
          state === 'invalid'
            ? Result.err(new AuthError('Rejected credential'))
            : Result.ok(
                state === 'valid' ? { id: 'request-user', scopes: [] } : null
              ),
      },
      async (client) => {
        await client.readResource({ uri: MCP_SURFACE_MAP_RESOURCE_URI });
        expect(seen).toEqual(['host-user']);
        expect(factories).toBe(1);
        state = 'valid';
        await client.readResource({ uri: MCP_SURFACE_MAP_RESOURCE_URI });
        expect(seen).toEqual(['host-user', 'request-user']);
        expect(factories).toBe(1);
        state = 'invalid';
        await expect(
          client.readResource({ uri: MCP_SURFACE_MAP_RESOURCE_URI })
        ).rejects.toMatchObject({ data: { category: 'auth' } });
        expect(seen).toEqual(['host-user', 'request-user']);
        expect(factories).toBe(1);
      }
    );
  });

  test('preserves static tools while policy denies aggregates and every direct family read', async () => {
    await withClient(
      {
        authorizeResourceRead: () => Result.err(new PermissionError('Private')),
        mcpResources: { graph: true },
      },
      async (client) => {
        const listed = await client.listResources();
        expect(listed.resources).toEqual([]);
        const tools = await client.listTools();
        expect(tools.tools).toHaveLength(1);
        for (const uri of [
          'trails://surface-map',
          'trails://examples/items.read',
          'trails://trail/items.read',
        ]) {
          await expect(client.readResource({ uri })).rejects.toMatchObject({
            data: { category: 'permission' },
          });
        }
      }
    );
  });

  test('fails listing on policy errors and preserves not-found errors without evaluating unknown targets', async () => {
    let policies = 0;
    await withClient(
      {
        authorizeResourceRead: () => {
          policies += 1;
          return Result.err(new AuthError('Policy unavailable'));
        },
      },
      async (client) => {
        await expect(client.listResources()).rejects.toMatchObject({
          data: { category: 'auth' },
        });
        expect(policies).toBe(1);
        for (const uri of [
          'trails://missing',
          'trails://examples/%69tems.read',
          'skill://app/../SKILL.md',
        ]) {
          await expect(client.readResource({ uri })).rejects.toMatchObject({
            code: -32_602,
            data: { category: 'not_found' },
          });
        }
        expect(policies).toBe(1);
      }
    );
  });

  test('keeps excluded trails absent and resource registration disabled when configured', async () => {
    const seen: string[] = [];
    await withClient(
      {
        authorizeResourceRead: ({ resource }) => {
          seen.push(resource.uri);
          return Result.ok();
        },
        exclude: ['items.read'],
        mcpResources: { graph: true },
      },
      async (client) => {
        const listed = await client.listResources();
        expect(listed.resources.map((resource) => resource.uri)).toEqual([
          'trails://surface-map',
        ]);
        await expect(
          client.readResource({ uri: 'trails://trail/items.read' })
        ).rejects.toMatchObject({ code: -32_602 });
        expect(seen).toEqual(['trails://surface-map']);
      }
    );
    await withClient({ mcpResources: false }, async (client) => {
      const listed = await client.listResources();
      expect(listed.resources).toEqual([]);
    });
  });

  test('redacts unexpected app policy failures instead of leaking their messages', async () => {
    await withClient(
      {
        authorizeResourceRead: () => {
          throw new Error('private-policy-detail');
        },
      },
      async (client) => {
        for (const request of [
          () => client.listResources(),
          () => client.readResource({ uri: MCP_SURFACE_MAP_RESOURCE_URI }),
        ]) {
          await expect(request()).rejects.toMatchObject({
            message: expect.not.stringContaining('private-policy-detail'),
          });
        }
      }
    );
  });
});
