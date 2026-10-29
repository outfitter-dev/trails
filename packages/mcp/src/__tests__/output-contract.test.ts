import { describe, expect, test } from 'bun:test';
import {
  NotFoundError,
  Result,
  surfaceOverlay,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { createServer } from '../surface.js';
import { deriveMcpTools } from '../build.js';
import {
  connectOutputClient,
  outputProtocolModes,
} from './fixtures/output-client.js';

interface OutputFixture {
  readonly id: string;
  readonly schema: z.ZodType;
  readonly value: unknown;
  readonly legacy: Record<string, unknown>;
  readonly modernType: string | undefined;
}

const fixtures: readonly OutputFixture[] = [
  {
    id: 'text',
    legacy: { data: 'hello' },
    modernType: 'string',
    schema: z.string(),
    value: 'hello',
  },
  {
    id: 'zero',
    legacy: { data: 0 },
    modernType: 'number',
    schema: z.number(),
    value: 0,
  },
  {
    id: 'false',
    legacy: { data: false },
    modernType: 'boolean',
    schema: z.boolean(),
    value: false,
  },
  {
    id: 'empty',
    legacy: { data: '' },
    modernType: 'string',
    schema: z.string(),
    value: '',
  },
  {
    id: 'null',
    legacy: { data: null },
    modernType: 'null',
    schema: z.null(),
    value: null,
  },
  {
    id: 'array',
    legacy: { data: [1, 2] },
    modernType: 'array',
    schema: z.array(z.number()),
    value: [1, 2],
  },
  {
    id: 'data',
    legacy: { data: 'authored' },
    modernType: 'object',
    schema: z.object({ data: z.string() }),
    value: { data: 'authored' },
  },
  {
    id: 'mixedobject',
    legacy: { data: { data: 'authored' } },
    modernType: undefined,
    schema: z.union([z.object({ data: z.string() }), z.string()]),
    value: { data: 'authored' },
  },
  {
    id: 'mixedstring',
    legacy: { data: 'branch' },
    modernType: undefined,
    schema: z.union([z.object({ data: z.string() }), z.string()]),
    value: 'branch',
  },
  {
    id: 'discriminated',
    legacy: { data: { data: 'authored', kind: 'one' } },
    modernType: undefined,
    schema: z.discriminatedUnion('kind', [
      z.object({ data: z.string(), kind: z.literal('one') }),
      z.object({ count: z.number(), kind: z.literal('two') }),
    ]),
    value: { data: 'authored', kind: 'one' },
  },
];

const fixtureApp = (fixture: OutputFixture) =>
  topo('output', {
    value: trail(fixture.id, {
      implementation: () => Result.ok(fixture.value),
      input: z.object({}),
      output: fixture.schema,
      permit: 'public',
    }),
  });

describe('MCP output contract', () => {
  for (const mode of outputProtocolModes) {
    for (const fixture of fixtures) {
      test(`${fixture.id} preserves authored output in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
        const app = fixtureApp(fixture);
        const { client, close, responses } = await connectOutputClient(
          () => createServer(app),
          mode
        );
        try {
          const tools = await client.listTools();
          const result = await client.callTool({
            arguments: {},
            name: `output_${fixture.id}`,
          });
          expect(result.structuredContent).toEqual(
            mode === 'legacy' ? fixture.legacy : fixture.value
          );
          const schema = tools.tools[0]?.outputSchema;
          expect(schema?.['type']).toBe(
            mode === 'legacy' ? 'object' : fixture.modernType
          );
          if (mode !== 'legacy' && fixture.modernType === undefined) {
            expect(schema?.['anyOf']).toHaveLength(2);
          }
          for (const response of responses) {
            expect(response.result['resultType']).toBe(
              mode === 'legacy' ? undefined : 'complete'
            );
          }
          const map = await client.readResource({
            uri: 'trails://surface-map',
          });
          const [content] = map.contents;
          if (content === undefined || !('text' in content)) {
            throw new Error('Expected JSON surface map');
          }
          expect(JSON.parse(content.text)).toMatchObject({
            tools: [{ name: `output_${fixture.id}`, outputSchema: schema }],
          });
        } finally {
          await close();
        }
      });
    }

    test(`aliases share the output contract and deterministic order in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      const app = fixtureApp({
        id: 'text',
        legacy: { data: 'hello' },
        modernType: 'string',
        schema: z.string(),
        value: 'hello',
      });
      const options = {
        overlays: [surfaceOverlay({ mcp: { read_text: 'text' } })],
      };
      const { client, close } = await connectOutputClient(
        () => createServer(app, options),
        mode
      );
      try {
        const first = await client.listTools();
        expect(first.tools.map((tool) => tool.name)).toEqual([
          'output_text',
          'read_text',
        ]);
        const result = await client.callTool({
          arguments: {},
          name: 'read_text',
        });
        expect(result.structuredContent).toEqual(
          mode === 'legacy' ? { data: 'hello' } : 'hello'
        );
        const second = await client.listTools();
        expect(second.tools).toEqual(first.tools);
      } finally {
        await close();
      }
    });

    test(`schema-less and error results retain their shapes in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      const app = topo('result', {
        implicit: trail('implicit', {
          implementation: () => Result.ok([1, 2]),
          input: z.object({}),
          permit: 'public',
        }),
        missing: trail('missing', {
          implementation: () => Result.err(new NotFoundError('Missing')),
          input: z.object({}),
          output: z.string(),
          permit: 'public',
        }),
      });
      const { client, close, responses } = await connectOutputClient(
        () => createServer(app),
        mode
      );
      try {
        const tools = await client.listTools();
        const implicit = await client.callTool({
          arguments: {},
          name: 'result_implicit',
        });
        expect(implicit.structuredContent).toBeUndefined();
        expect(implicit.content).toEqual([{ text: '[1,2]', type: 'text' }]);
        expect(
          tools.tools.find((tool) => tool.name === 'result_implicit')
            ?.outputSchema
        ).toBeUndefined();
        const missing = await client.callTool({
          arguments: {},
          name: 'result_missing',
        });
        expect(missing.isError).toBe(true);
        expect(missing.structuredContent).toBeUndefined();
        expect(missing._meta?.['ontrails/error']).toMatchObject({
          category: 'not_found',
          code: -32_001,
        });
        await expect(
          client.readResource({ uri: 'trails://missing' })
        ).rejects.toMatchObject({
          code: -32_602,
          data: { category: 'not_found' },
        });
        for (const response of responses) {
          expect(response.result['resultType']).toBe(
            mode === 'legacy' ? undefined : 'complete'
          );
        }
      } finally {
        await close();
      }
    });
  }

  test('public derivation remains the legacy facade', async () => {
    for (const fixture of fixtures) {
      const result = deriveMcpTools(fixtureApp(fixture));
      if (result.isErr()) {
        throw result.error;
      }
      const [tool] = result.value;
      if (tool === undefined) {
        throw new Error('Expected derived tool');
      }
      expect(tool.outputSchema?.['type']).toBe('object');
      const output = await tool.handler({}, {});
      expect(output.structuredContent).toEqual(fixture.legacy);
    }
  });

  test('selects the modern view after a custom server was already constructed', async () => {
    const app = fixtureApp({
      id: 'text',
      legacy: { data: 'hello' },
      modernType: 'string',
      schema: z.string(),
      value: 'hello',
    });
    const server = createServer(app);
    expect(server.getNegotiatedProtocolVersion()).not.toBe('2026-07-28');
    const { client, close } = await connectOutputClient(() => server, {
      pin: '2026-07-28',
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools[0]?.outputSchema?.['type']).toBe('string');
      const result = await client.callTool({
        arguments: {},
        name: 'output_text',
      });
      expect(result.structuredContent).toBe('hello');
      expect(server.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    } finally {
      await close();
    }
  });
});
