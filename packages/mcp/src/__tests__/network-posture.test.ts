import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  AuthError,
  createTrailContext,
  isTrailsError,
  PermissionError,
  Result,
  topo,
  trail,
} from '@ontrails/core';
import type { Logger } from '@ontrails/core';
import { z } from 'zod';

import { deriveMcpTools } from '../build.js';
import type { McpToolDefinition, McpToolResult } from '../build.js';
import { createFetchHandler } from '../fetch.js';
import { resetSeededPermitDiagnostic } from '../permit-resolution.js';

const seed = { actors: [], id: 'local-host', scopes: ['record:write'] };

const whoami = trail('whoami', {
  implementation: (_input, ctx) => Result.ok({ id: ctx.permit?.id ?? null }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ id: z.string().nullable() }),
  permit: 'public',
});

const guarded = trail('record.update', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['record:write'] },
});

const graph = () => topo('posture', { guarded, whoami });

const textOf = (result: McpToolResult): string =>
  result.content.map((entry) => ('text' in entry ? entry.text : '')).join('');

const toolNamed = (
  tools: readonly McpToolDefinition[],
  name: string
): McpToolDefinition => {
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
};

const errorMeta = (result: McpToolResult): Record<string, unknown> => {
  const meta = result._meta?.['ontrails/error'];
  return typeof meta === 'object' && meta !== null
    ? (meta as Record<string, unknown>)
    : {};
};

const capturingLogger = (sink: string[]): Logger => {
  const logger: Logger = {
    child: () => logger,
    debug: () => {},
    error: () => {},
    fatal: () => {},
    info: () => {},
    trace: () => {},
    warn: (message) => {
      sink.push(message);
    },
  };
  return logger;
};

describe('network credential posture', () => {
  let warnings: string[] = [];

  beforeEach(() => {
    warnings = [];
    resetSeededPermitDiagnostic();
  });

  const seededContext = () =>
    createTrailContext({ logger: capturingLogger(warnings), permit: seed });

  test('no credential is anonymous: public runs, protected fails at enforcement', async () => {
    const tools = deriveMcpTools(graph(), {
      credentialPosture: 'network',
      resolvePermit: () => Result.ok(null),
    }).unwrap();
    const open = await toolNamed(tools, 'posture_whoami').handler({}, {});
    expect(open.structuredContent).toEqual({ id: null });
    const denied = await toolNamed(tools, 'posture_record_update').handler(
      {},
      {}
    );
    expect(denied.isError).toBe(true);
    expect(errorMeta(denied)['category']).toBe('permission');
  });

  test('an invalid credential is the resolver error, even for a public tool', async () => {
    const tools = deriveMcpTools(graph(), {
      credentialPosture: 'network',
      resolvePermit: () => Result.err(new AuthError('bad token')),
    }).unwrap();
    const result = await toolNamed(tools, 'posture_whoami').handler(
      {},
      { authorization: 'Bearer nope' }
    );
    expect(result.isError).toBe(true);
    expect(errorMeta(result)['category']).toBe('auth');
  });

  test('a presented bearer with no resolver is an AuthError, never absence', async () => {
    const tools = deriveMcpTools(topo('open', { whoami }), {
      credentialPosture: 'network',
    }).unwrap();
    const result = await toolNamed(tools, 'open_whoami').handler(
      {},
      { authorization: 'Bearer abc' }
    );
    expect(result.isError).toBe(true);
    expect(errorMeta(result)).toMatchObject({ category: 'auth' });
    expect(textOf(result)).toContain('no permit resolver');
    const anonymous = await toolNamed(tools, 'open_whoami').handler({}, {});
    expect(anonymous.structuredContent).toEqual({ id: null });
  });

  test('an inherited createContext permit is discarded with one diagnostic', async () => {
    const tools = deriveMcpTools(graph(), {
      createContext: seededContext,
      credentialPosture: 'network',
      resolvePermit: () => Result.ok(null),
    }).unwrap();
    const open = await toolNamed(tools, 'posture_whoami').handler({}, {});
    expect(open.structuredContent).toEqual({ id: null });
    const denied = await toolNamed(tools, 'posture_record_update').handler(
      {},
      {}
    );
    expect(denied.isError).toBe(true);
    expect(errorMeta(denied)['category']).toBe('permission');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('createContext permit was discarded');
  });

  test('extra.permit is ignored on the network posture and honored on the host posture', async () => {
    const network = deriveMcpTools(graph(), {
      credentialPosture: 'network',
      resolvePermit: () => Result.ok(null),
    }).unwrap();
    const smuggled = await toolNamed(network, 'posture_record_update').handler(
      {},
      { permit: seed }
    );
    expect(smuggled.isError).toBe(true);

    const host = deriveMcpTools(graph(), {
      createContext: seededContext,
      resolvePermit: () => Result.ok(null),
    }).unwrap();
    const hostCall = await toolNamed(host, 'posture_record_update').handler(
      {},
      {}
    );
    expect(hostCall.structuredContent).toEqual({ ok: true });
    const viaExtra = await toolNamed(host, 'posture_whoami').handler(
      {},
      { permit: { actors: [], id: 'extra', scopes: [] } }
    );
    expect(viaExtra.structuredContent).toEqual({ id: 'extra' });
    expect(warnings).toHaveLength(0);
  });

  test('protected trails without a verifier are refused at build time on the network posture', () => {
    const refused = deriveMcpTools(graph(), { credentialPosture: 'network' });
    expect(refused.isErr()).toBe(true);
    if (!refused.isErr()) {
      return;
    }
    expect(isTrailsError(refused.error) && refused.error.category).toBe(
      'validation'
    );
    expect(refused.error.message).toContain('record.update');
    expect(refused.error.message).toContain('resolvePermit');

    expect(
      deriveMcpTools(graph(), {
        credentialPosture: 'network',
        resolvePermit: () => Result.ok(null),
      }).isOk()
    ).toBe(true);
    expect(deriveMcpTools(graph()).isOk()).toBe(true);
    expect(
      deriveMcpTools(topo('open', { whoami }), {
        credentialPosture: 'network',
      }).isOk()
    ).toBe(true);
    expect(() => createFetchHandler(graph())).toThrow(/record\.update/);
  });

  test('the fetch entry never inherits a seed, for tools and resource reads', async () => {
    const policyPermits: (string | null)[] = [];
    const handler = createFetchHandler(graph(), {
      authorizeResourceRead: ({ permit }) => {
        policyPermits.push(permit?.id ?? null);
        return permit === undefined
          ? Result.err(new PermissionError('private'))
          : Result.ok();
      },
      createContext: seededContext,
      resolvePermit: ({ bearerToken }) =>
        bearerToken === 'verified'
          ? Result.ok({
              actors: [],
              id: 'verified-user',
              scopes: ['record:write'],
            })
          : Result.ok(null),
    });
    let authorization: string | undefined;
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/mcp'),
      {
        fetch: (input, init) => {
          const request = new Request(input, init);
          if (authorization !== undefined) {
            request.headers.set('authorization', authorization);
          }
          return handler.fetch(request);
        },
      }
    );
    const client = new Client(
      { name: 'posture-test', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    try {
      await client.connect(transport);
      const who = await client.callTool({
        arguments: {},
        name: 'posture_whoami',
      });
      expect(who.structuredContent).toEqual({ id: null });
      const denied = await client.callTool({
        arguments: {},
        name: 'posture_record_update',
      });
      expect(denied.isError).toBe(true);
      await expect(
        client.readResource({ uri: 'trails://surface-map' })
      ).rejects.toMatchObject({ data: { category: 'permission' } });
      expect(policyPermits).toEqual([null]);

      authorization = 'Bearer verified';
      const allowed = await client.callTool({
        arguments: {},
        name: 'posture_record_update',
      });
      expect(allowed.structuredContent).toEqual({ ok: true });
      const read = await client.readResource({ uri: 'trails://surface-map' });
      expect(read.contents).toHaveLength(1);
      expect(policyPermits).toEqual([null, 'verified-user']);
      expect(warnings).toHaveLength(1);
    } finally {
      await Promise.allSettled([client.close(), handler.close()]);
    }
  });
});
