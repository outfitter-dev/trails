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
import {
  connectOutputClient,
  outputProtocolModes,
} from './fixtures/output-client.js';

const values = [
  { id: 'text', legacy: { data: 'one' }, schema: z.string(), value: 'one' },
  { id: 'false', legacy: { data: false }, schema: z.boolean(), value: false },
  { id: 'zero', legacy: { data: 0 }, schema: z.number(), value: 0 },
  { id: 'empty', legacy: { data: '' }, schema: z.string(), value: '' },
  { id: 'null', legacy: { data: null }, schema: z.null(), value: null },
  {
    id: 'array',
    legacy: { data: [1, 2] },
    schema: z.array(z.number()),
    value: [1, 2],
  },
  {
    id: 'data',
    legacy: { data: 'authored' },
    schema: z.object({ data: z.string() }),
    value: { data: 'authored' },
  },
  {
    id: 'mixedobject',
    legacy: { data: { data: 'authored' } },
    schema: z.union([z.object({ data: z.string() }), z.string()]),
    value: { data: 'authored' },
  },
  {
    id: 'mixedstring',
    legacy: { data: 'branch' },
    schema: z.union([z.object({ data: z.string() }), z.string()]),
    value: 'branch',
  },
];

describe('MCP trailhead output contract', () => {
  for (const mode of outputProtocolModes) {
    test(`preserves selected member values and identity in ${typeof mode === 'object' ? 'modern' : 'legacy'} era`, async () => {
      let invocations = 0;
      const members = Object.fromEntries(
        values.map((fixture) => [
          fixture.id,
          trail(`shape.${fixture.id}`, {
            implementation: () => {
              invocations += 1;
              return Result.ok(fixture.value);
            },
            input: z.object({}),
            output: fixture.schema,
            permit: 'public',
          }),
        ])
      );
      const app = topo('group', {
        ...members,
        implicit: trail('shape.implicit', {
          implementation: () => {
            invocations += 1;
            return Result.ok({ data: 'implicit' });
          },
          input: z.object({}),
          permit: 'public',
        }),
        missing: trail('shape.missing', {
          implementation: () => {
            invocations += 1;
            return Result.err(new NotFoundError('Missing'));
          },
          input: z.object({}),
          output: z.string(),
          permit: 'public',
        }),
      });
      const options = {
        overlays: [surfaceOverlay({ mcp: { direct_text: 'shape.text' } })],
        trailheads: {
          shape: { description: 'Shape tools', trails: 'shape.*' },
        },
      };
      const { client, close } = await connectOutputClient(
        () => createServer(app, options),
        mode
      );
      try {
        expect(invocations).toBe(0);
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name)).toEqual([
          'group_shape',
          'direct_text',
        ]);
        const group = listed.tools.find((tool) => tool.name === 'group_shape');
        expect(group?.outputSchema).toMatchObject({
          properties: {
            output: {
              anyOf: expect.arrayContaining([
                mode === 'legacy'
                  ? {
                      properties: { data: { type: 'string' } },
                      required: ['data'],
                      type: 'object',
                    }
                  : { type: 'string' },
              ]),
            },
          },
          type: 'object',
        });
        for (const fixture of values) {
          const result = await client.callTool({
            arguments: { input: {}, trail: `shape.${fixture.id}` },
            name: 'group_shape',
          });
          expect(result.structuredContent).toEqual({
            output: mode === 'legacy' ? fixture.legacy : fixture.value,
            trail: `shape.${fixture.id}`,
          });
        }
        const alias = await client.callTool({
          arguments: {},
          name: 'direct_text',
        });
        expect(alias.structuredContent).toEqual(
          mode === 'legacy' ? { data: 'one' } : 'one'
        );
        const implicit = await client.callTool({
          arguments: { input: {}, trail: 'shape.implicit' },
          name: 'group_shape',
        });
        expect(implicit.structuredContent).toEqual({
          output: { data: 'implicit' },
          trail: 'shape.implicit',
        });
        const missing = await client.callTool({
          arguments: { input: {}, trail: 'shape.missing' },
          name: 'group_shape',
        });
        expect(missing.isError).toBe(true);
        expect(missing.structuredContent).toBeUndefined();
        expect(missing._meta?.['ontrails/error']).toMatchObject({
          code: -32_001,
        });
        expect(invocations).toBe(12);
        const map = await client.readResource({ uri: 'trails://surface-map' });
        const [content] = map.contents;
        if (content === undefined || !('text' in content)) {
          throw new Error('Expected JSON surface map');
        }
        expect(JSON.parse(content.text)).toMatchObject({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: 'group_shape',
              outputSchema: group?.outputSchema,
            }),
          ]),
        });
        const again = await client.listTools();
        expect(again.tools).toEqual(listed.tools);
      } finally {
        await close();
      }
    });
  }
});
