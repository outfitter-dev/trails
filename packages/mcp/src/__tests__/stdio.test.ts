import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { specTypeSchemas } from '@modelcontextprotocol/server';
import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(
  new URL('fixtures/stdio-app.ts', import.meta.url)
);

describe('stdio protocol serving', () => {
  for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
    const modern = typeof mode === 'object';
    test(`serves tools, resources, blobs and progress in ${modern ? 'modern' : 'legacy'} era`, async () => {
      const client = new Client(
        { name: 'trails-test', version: '1.0.0' },
        {
          versionNegotiation: { mode },
        }
      );
      const transport = new StdioClientTransport({
        args: [fixture],
        command: process.execPath,
      });
      try {
        await client.connect(transport);
        expect(client.getNegotiatedProtocolVersion()).toBe(
          modern ? '2026-07-28' : '2025-11-25'
        );
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain(
          'stdio_fixture_greet'
        );
        // SDK 2.4.0 defers notification dispatch but removes its onprogress
        // listener as soon as a response arrives. Coalesced pipe reads can lose
        // that callback; assert the server's actual wire ordering and payload.
        const wireProgress: unknown[] = [];
        const wireOrder: string[] = [];
        const receive = transport.onmessage;
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- SDK Transport exposes onmessage rather than EventTarget; preserve its receiver.
        transport.onmessage = (message) => {
          if (
            'method' in message &&
            message.method === 'notifications/progress'
          ) {
            wireProgress.push(message.params);
            wireOrder.push('progress');
          } else if ('result' in message) {
            wireOrder.push('result');
          }
          receive?.(message);
        };
        const result = await client.callTool(
          { arguments: { name: 'Ada' }, name: 'stdio_fixture_greet' },
          { onprogress: () => {} }
        );
        expect(result.structuredContent).toEqual({ greeting: 'Hello, Ada!' });
        expect(wireProgress).toContainEqual(
          expect.objectContaining({ progress: 1, total: 1 })
        );
        for (const notification of wireProgress) {
          expect(
            specTypeSchemas.ProgressNotificationParams['~standard'].validate(
              notification
            ).issues
          ).toBeUndefined();
        }
        expect(wireOrder.lastIndexOf('progress')).toBeLessThan(
          wireOrder.indexOf('result')
        );
        const identityRequest = {
          _meta: { fixtureCredential: 'reader' },
          arguments: {},
          name: 'stdio_fixture_identity',
        };
        const firstIdentity = await client.callTool(identityRequest);
        expect(firstIdentity.structuredContent).toEqual({
          id: 'fixture-reader',
        });
        const rejectedIdentity = await client.callTool({
          ...identityRequest,
          _meta: { fixtureCredential: 'wrong' },
        });
        expect(rejectedIdentity.isError).toBe(true);
        const repeatedIdentity = await client.callTool(identityRequest);
        expect(repeatedIdentity.structuredContent).toEqual(
          firstIdentity.structuredContent
        );
        const file = await client.callTool({
          arguments: {},
          name: 'stdio_fixture_file',
        });
        expect(file.content).toContainEqual({
          resource: {
            blob: 'AQID',
            mimeType: 'application/pdf',
            uri: 'blob://report.pdf',
          },
          type: 'resource',
        });
        const resources = await client.listResources();
        for (const uri of [
          'trails://surface-map',
          'trails://examples/greet',
          'trails://trail/greet',
        ]) {
          expect(resources.resources.map((resource) => resource.uri)).toContain(
            uri
          );
          const resource = await client.readResource({ uri });
          expect(resource.contents[0]?.uri).toBe(uri);
        }
        await expect(
          client.readResource({ uri: 'trails://missing' })
        ).rejects.toMatchObject({ code: -32_602 });
      } finally {
        await client.close();
        await transport.close();
      }
    }, 15_000);
  }
});

// Bun 1.4.4 qualification (TRL-1433): warnings emitted during startup and
// invocation must reach stderr and never interleave with protocol stdout.
// SDK v2 no longer exports a LATEST_PROTOCOL_VERSION constant, so the modern
// era is pinned literally here, matching the negotiation test above.
test('stdio keeps startup and invocation warnings off protocol stdout', async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !['BUN_OPTIONS', 'NODE_OPTIONS', 'NODE_NO_WARNINGS'].includes(key)
    )
  );
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('fixtures/stdio-warning.ts', import.meta.url)),
    ],
    {
      env,
      signal: AbortSignal.timeout(4000),
      stderr: 'pipe',
      stdin: 'pipe',
      stdout: 'pipe',
    }
  );
  const [protocol, capture] = child.stdout.tee();
  const [warningStream, warningCapture] = child.stderr.tee();
  const stdout = new Response(capture).text();
  const stderr = new Response(warningCapture).text();
  const reader = protocol.getReader();
  const warningReader = warningStream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let warningsSeen = '';

  // process.emitWarning prints asynchronously, so the invocation warning can
  // land after the protocol response. Wait for it before killing the child.
  const awaitWarning = async (marker: string) => {
    const deadline = Date.now() + 3000;
    while (!warningsSeen.includes(marker)) {
      // Race each read against the remaining time: a read blocks for as long
      // as the child keeps stderr open, so the deadline must cut it short.
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`MCP subprocess never emitted ${marker}`);
      }
      const expiry = Promise.withResolvers<never>();
      const timer = setTimeout(() => {
        expiry.reject(new Error(`MCP subprocess never emitted ${marker}`));
      }, remaining);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([warningReader.read(), expiry.promise]);
      } finally {
        clearTimeout(timer);
      }
      if (chunk.done) {
        throw new Error(`MCP subprocess closed stderr before ${marker}`);
      }
      warningsSeen += decoder.decode(chunk.value, { stream: true });
    }
  };

  const receive = async () => {
    while (!pending.includes('\n')) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error('MCP subprocess closed before its protocol response');
      }
      pending += decoder.decode(chunk.value, { stream: true });
    }
    const boundary = pending.indexOf('\n');
    const message = JSON.parse(pending.slice(0, boundary));
    pending = pending.slice(boundary + 1);
    return message;
  };
  const send = (message: Record<string, unknown>) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };

  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '1.0.0' },
        protocolVersion: '2026-07-28',
      },
    });
    expect(await receive()).toMatchObject({
      id: 1,
      jsonrpc: '2.0',
      result: {},
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    const listing = await receive();
    expect(listing.id).toBe(2);
    expect(listing.result.tools).toHaveLength(1);
    const toolName = listing.result.tools[0].name;
    expect(typeof toolName).toBe('string');
    send({
      id: 3,
      method: 'tools/call',
      params: { arguments: { text: 'qualified' }, name: toolName },
    });
    const response = await receive();
    expect(response.id).toBe(3);
    expect(response.result.content).toHaveLength(1);
    expect(response.result.content[0].type).toBe('text');
    expect(JSON.parse(response.result.content[0].text)).toEqual({
      text: 'qualified',
    });
    await awaitWarning('TRL1433_CALL');
  } finally {
    reader.releaseLock();
    warningReader.releaseLock();
    child.kill();
    await child.exited;
  }

  const rawStdout = await stdout;
  const messages = rawStdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(messages.map((message) => message.id)).toEqual([1, 2, 3]);
  expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true);
  const warnings = await stderr;
  expect(warnings).toContain('TRL1433_START');
  expect(warnings).toContain('TRL1433_CALL');
});
