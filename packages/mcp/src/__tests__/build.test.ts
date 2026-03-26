import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

import { buildMcpTools } from '../build.js';
import type { McpExtra } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  description: 'Echo a message back',
  implementation: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  output: z.object({ reply: z.string() }),
  readOnly: true,
});

const deleteTrail = trail('item.delete', {
  description: 'Delete an item',
  destructive: true,
  implementation: (_input) => Result.ok({ deleted: true }),
  input: z.object({ id: z.string() }),
});

const failTrail = trail('fail', {
  description: 'Always fails',
  implementation: (input) => Result.err(new Error(input.reason)),
  input: z.object({ reason: z.string() }),
});

const exampleTrail = trail('with.examples', {
  description: 'A trail with examples',
  examples: [
    {
      expected: { greeting: 'hello world' },
      input: { name: 'world' },
      name: 'basic',
    },
  ],
  implementation: (input) => Result.ok({ greeting: `hello ${input.name}` }),
  input: z.object({ name: z.string() }),
});

const noExtra: McpExtra = {};

const requireTool = (tools: ReturnType<typeof buildMcpTools>, name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Expected tool: ${name}`);
  }
  return tool;
};

const requireOnlyTool = (tools: ReturnType<typeof buildMcpTools>) => {
  expect(tools).toHaveLength(1);
  const [tool] = tools;
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error('Expected one MCP tool');
  }
  return tool;
};

const parseJsonContent = (
  content: { readonly text?: string | undefined } | undefined
): unknown => {
  expect(content?.text).toBeDefined();
  return JSON.parse(content?.text ?? 'null');
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMcpTools', () => {
  describe('discovery', () => {
    test('builds tools from a single-trail app', () => {
      const app = topo('myapp', { echoTrail });
      const tools = buildMcpTools(app);

      expect(tools).toHaveLength(1);
      expect(requireOnlyTool(tools).name).toBe('myapp_echo');
    });

    test('builds tools from a multi-trail app', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildMcpTools(app);

      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain('myapp_echo');
      expect(names).toContain('myapp_item_delete');
      expect(names).toContain('myapp_fail');
    });

    test('tool names follow derivation rules', () => {
      const app = topo('myapp', { deleteTrail });
      const tools = buildMcpTools(app);

      expect(requireOnlyTool(tools).name).toBe('myapp_item_delete');
    });

    test('input schema is valid JSON Schema', () => {
      const app = topo('myapp', { echoTrail });
      const schema = requireOnlyTool(buildMcpTools(app)).inputSchema;

      expect(schema['type']).toBe('object');
      expect(schema['properties']).toBeDefined();
      const props = schema['properties'] as Record<string, unknown>;
      expect(props['message']).toEqual({ type: 'string' });
    });

    test('annotations are correctly derived', () => {
      const app = topo('myapp', { deleteTrail, echoTrail });
      const tools = buildMcpTools(app);

      expect(requireTool(tools, 'myapp_echo').annotations?.readOnlyHint).toBe(
        true
      );
      expect(requireTool(tools, 'myapp_echo').annotations?.title).toBe(
        'Echo a message back'
      );
      expect(
        requireTool(tools, 'myapp_item_delete').annotations?.destructiveHint
      ).toBe(true);
    });
  });

  describe('handler execution', () => {
    test('handler validates input and returns isError on invalid', async () => {
      const app = topo('myapp', { echoTrail });
      const tool = requireOnlyTool(buildMcpTools(app));

      const result = await tool.handler({ notMessage: 123 }, noExtra);
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.type).toBe('text');
      expect(result?.content[0]?.text).toBeDefined();
    });

    test('handler calls implementation and returns result as text content', async () => {
      const app = topo('myapp', { echoTrail });
      const tool = requireOnlyTool(buildMcpTools(app));

      const result = await tool.handler({ message: 'hello' }, noExtra);
      expect(result?.isError).toBeUndefined();
      expect(result?.content[0]?.type).toBe('text');
      expect(parseJsonContent(result?.content[0])).toEqual({
        reply: 'hello',
      });
    });

    test('handler maps errors to isError content', async () => {
      const app = topo('myapp', { failTrail });
      const tool = requireOnlyTool(buildMcpTools(app));

      const result = await tool.handler({ reason: 'broken' }, noExtra);
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toBe('broken');
    });

    test('handler catches thrown exceptions', async () => {
      const throwTrail = trail('throw', {
        implementation: () => {
          throw new Error('unexpected crash');
        },
        input: z.object({}),
      });

      const tool = requireOnlyTool(
        buildMcpTools(topo('myapp', { throwTrail }))
      );
      const result = await tool.handler({}, noExtra);

      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toBe('unexpected crash');
    });
  });

  describe('filters', () => {
    test('include filter limits which trails become tools', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildMcpTools(app, {
        includeTrails: ['echo'],
      });

      expect(tools).toHaveLength(1);
      expect(requireOnlyTool(tools).name).toBe('myapp_echo');
    });

    test('exclude filter removes specific trails', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildMcpTools(app, {
        excludeTrails: ['fail'],
      });

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('myapp_fail');
    });

    test('include takes precedence over exclude', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildMcpTools(app, {
        excludeTrails: ['fail'],
        includeTrails: ['echo', 'fail'],
      });

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name);
      expect(names).toContain('myapp_echo');
      expect(names).toContain('myapp_fail');
    });
  });

  describe('composition', () => {
    test('layers compose and execute around the implementation', async () => {
      const calls: string[] = [];

      const testLayer: Layer = {
        name: 'test-layer',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            calls.push('before');
            const result = await impl(input, ctx);
            calls.push('after');
            return result;
          };
        },
      };

      const app = topo('myapp', { echoTrail });
      const tool = requireOnlyTool(buildMcpTools(app, { layers: [testLayer] }));

      await tool.handler({ message: 'hi' }, noExtra);
      expect(calls).toEqual(['before', 'after']);
    });

    test('AbortSignal propagates from MCP extra to TrailContext', async () => {
      let capturedSignal: AbortSignal | undefined;

      const signalTrail = trail('signal.check', {
        implementation: (_input, ctx) => {
          capturedSignal = ctx.signal;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const controller = new AbortController();
      const tool = requireOnlyTool(
        buildMcpTools(topo('myapp', { signalTrail }))
      );

      await tool.handler({}, { signal: controller.signal });
      expect(capturedSignal).toBe(controller.signal);
    });

    test('description includes first example input when present', () => {
      const app = topo('myapp', { exampleTrail });
      const tool = requireOnlyTool(buildMcpTools(app));

      expect(tool.description).toContain('A trail with examples');
      expect(tool.description).toContain('"name":"world"');
    });

    test('custom createContext is used when provided', async () => {
      let contextUsed = false;

      const ctxTrail = trail('ctx.check', {
        implementation: (_input, ctx) => {
          const ctxRecord = ctx as Record<string, unknown>;
          contextUsed = ctxRecord['custom'] === true;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const app = topo('myapp', { ctxTrail });
      const tool = requireOnlyTool(
        buildMcpTools(app, {
          createContext: () => ({
            custom: true,
            requestId: 'test-id',
            signal: new AbortController().signal,
          }),
        })
      );

      await tool.handler({}, noExtra);
      expect(contextUsed).toBe(true);
    });
  });

  describe('blob outputs', () => {
    test('BlobRef output converts to image content', async () => {
      const blobTrail = trail('blob.image', {
        implementation: () =>
          Result.ok({
            data: new Uint8Array([1, 2, 3]),
            kind: 'blob' as const,
            mimeType: 'image/png',
            name: 'test.png',
          }),
        input: z.object({}),
      });

      const tool = requireOnlyTool(buildMcpTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('image');
      expect(result?.content[0]?.mimeType).toBe('image/png');
      expect(result?.content[0]?.data).toBeDefined();
    });

    test('BlobRef output converts to resource content for non-images', async () => {
      const blobTrail = trail('blob.file', {
        implementation: () =>
          Result.ok({
            data: new Uint8Array([1, 2, 3]),
            kind: 'blob' as const,
            mimeType: 'application/pdf',
            name: 'doc.pdf',
          }),
        input: z.object({}),
      });

      const tool = requireOnlyTool(buildMcpTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('resource');
      expect(result?.content[0]?.uri).toBe('blob://doc.pdf');
      expect(result?.content[0]?.mimeType).toBe('application/pdf');
    });
  });

  describe('end-to-end', () => {
    test('full pipeline from trail to MCP response', async () => {
      const greetTrail = trail('greet', {
        description: 'Greet someone',
        idempotent: true,
        implementation: (input) =>
          Result.ok({ greeting: `Hello, ${input.name}!` }),
        input: z.object({ name: z.string() }),
        output: z.object({ greeting: z.string() }),
        readOnly: true,
      });

      const tool = requireOnlyTool(
        buildMcpTools(topo('testapp', { greetTrail }))
      );

      expect(tool).toMatchObject({
        annotations: {
          idempotentHint: true,
          readOnlyHint: true,
        },
        description: 'Greet someone',
        name: 'testapp_greet',
      });
      expect(tool.inputSchema['type']).toBe('object');

      const successResult = await tool.handler({ name: 'World' }, noExtra);
      expect(successResult?.isError).toBeUndefined();
      expect(parseJsonContent(successResult?.content[0])).toEqual({
        greeting: 'Hello, World!',
      });

      const errorResult = await tool.handler({}, noExtra);
      expect(errorResult?.isError).toBe(true);
    });
  });
});
