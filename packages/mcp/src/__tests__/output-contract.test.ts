import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { isJSONRPCResultResponse } from '@modelcontextprotocol/server';
import type { JSONRPCResultResponse } from '@modelcontextprotocol/server';
import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import { deriveMcpTools } from '../index.js';
import { createFetchHandler } from '../fetch.js';
import {
  outputApp,
  outputCases,
  outputOptions,
} from './fixtures/output-app.js';

const openStdio = () => ({
  close: () => Promise.resolve(),
  transport: new StdioClientTransport({
    args: [fileURLToPath(new URL('fixtures/output-stdio.ts', import.meta.url))],
    command: process.execPath,
  }),
});

const openHttp = () => {
  const handler = createFetchHandler(outputApp, outputOptions);
  const server = Bun.serve({
    fetch: handler.fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  return {
    close: async () => {
      try {
        await handler.close();
      } finally {
        server.stop(true);
      }
    },
    transport: new StreamableHTTPClientTransport(new URL('/mcp', server.url)),
  };
};

describe('MCP negotiated output contract', () => {
  for (const [surface, open] of [
    ['stdio', openStdio],
    ['HTTP', openHttp],
  ] as const) {
    for (const mode of ['legacy', { pin: '2026-07-28' }] as const) {
      const modern = typeof mode === 'object';
      test(`${surface} serves matching schemas and values in the ${modern ? 'modern' : 'legacy'} era`, async () => {
        const { transport, close } = open();
        const client = new Client(
          { name: 'contract-consumer', version: '1' },
          { versionNegotiation: { mode } }
        );
        try {
          await client.connect(transport);
          expect(client.getNegotiatedProtocolVersion()).toBe(
            modern ? '2026-07-28' : '2025-11-25'
          );
          const responses: JSONRPCResultResponse[] = [];
          const receive = transport.onmessage;
          // oxlint-disable-next-line unicorn/prefer-add-event-listener -- SDK Transport exposes onmessage, not EventTarget.
          transport.onmessage = (message) => {
            if (isJSONRPCResultResponse(message)) {
              responses.push(message);
            }
            receive?.(message);
          };

          const { tools } = await client.listTools();
          const schemas = new Map(
            tools.map((tool) => [tool.name, tool.outputSchema])
          );
          const group = 'output_shapes';
          expect(schemas.get(group)).toMatchObject({
            properties: {
              output: {
                anyOf: expect.arrayContaining([
                  modern
                    ? { type: 'string' }
                    : {
                        properties: { data: { type: 'string' } },
                        required: ['data'],
                        type: 'object',
                      },
                ]),
              },
            },
            type: 'object',
          });

          for (const { id, type, value } of outputCases) {
            const name = `direct_${id}`;
            const rawSchema =
              type === undefined
                ? {
                    anyOf: expect.arrayContaining([
                      { type: 'string' },
                      expect.objectContaining({ type: 'object' }),
                    ]),
                  }
                : { type };
            const wraps = !modern && type !== 'object';
            const advertised = wraps
              ? {
                  properties: { data: expect.objectContaining(rawSchema) },
                  required: ['data'],
                  type: 'object',
                }
              : rawSchema;
            expect(schemas.get(name)).toMatchObject(advertised);
            const expected = wraps ? { data: value } : value;
            const result = await client.callTool({ name });
            expect(result.structuredContent).toEqual(expected);
            expect(responses.at(-1)?.result).toMatchObject({
              structuredContent: expected,
            });
            const trailId = `shape.${id}`;
            const grouped = await client.callTool({
              arguments: { input: {}, trail: trailId },
              name: group,
            });
            expect(grouped.structuredContent).toEqual({
              output: expected,
              trail: trailId,
            });
          }

          expect(schemas.get('direct_implicit')).toBeUndefined();
          const implicit = await client.callTool({ name: 'direct_implicit' });
          expect(implicit.structuredContent).toBeUndefined();
          expect(implicit.content).toEqual([{ text: '[1,2]', type: 'text' }]);
          const groupedImplicit = await client.callTool({
            arguments: { input: {}, trail: 'shape.implicit' },
            name: group,
          });
          expect(groupedImplicit.structuredContent).toEqual({
            output: [1, 2],
            trail: 'shape.implicit',
          });

          const missing = await client.callTool({ name: 'direct_missing' });
          expect(missing.isError).toBe(true);
          expect(missing.structuredContent).toBeUndefined();
          expect(missing._meta?.['ontrails/error']).toMatchObject({
            code: -32_001,
          });
          const groupedMissing = await client.callTool({
            arguments: { input: {}, trail: 'shape.missing' },
            name: group,
          });
          expect(groupedMissing).toEqual(missing);

          const map = await client.readResource({
            uri: 'trails://surface-map',
          });
          const [content] = map.contents;
          if (content === undefined || !('text' in content)) {
            throw new Error('Expected JSON surface map');
          }
          expect(JSON.parse(content.text)).toMatchObject({
            tools: tools.map(({ name, outputSchema }) =>
              outputSchema === undefined ? { name } : { name, outputSchema }
            ),
          });
          const repeat = await client.listTools();
          expect(repeat.tools).toEqual(tools);
          expect(responses.length).toBeGreaterThan(outputCases.length * 2);
          for (const response of responses) {
            expect(response.result['resultType']).toBe(
              modern ? 'complete' : undefined
            );
          }
        } finally {
          await Promise.allSettled([client.close(), close()]);
        }
      });
    }
  }

  test('standalone derivation retains the legacy tool shape', async () => {
    const result = deriveMcpTools(outputApp, outputOptions);
    if (result.isErr()) {
      throw result.error;
    }
    const tool = result.value.find(({ name }) => name === 'direct_mixedobject');
    expect(tool?.outputSchema).toMatchObject({
      properties: { data: { anyOf: expect.any(Array) } },
      type: 'object',
    });
    const call = await tool?.handler({}, {});
    expect(call?.structuredContent).toEqual({
      data: { data: 'branch' },
    });
  });
});
