import { describe, expect, test } from 'bun:test';

import {
  Result,
  SURFACE_KEY,
  createBlobRef,
  service,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

import { buildMcpTools } from '../build.js';
import type { McpExtra, McpToolDefinition } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  description: 'Echo a message back',
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
  run: (input) => Result.ok({ reply: input.message }),
});

const deleteTrail = trail('item.delete', {
  description: 'Delete an item',
  input: z.object({ id: z.string() }),
  intent: 'destroy',
  run: (_input) => Result.ok({ deleted: true }),
});

const failTrail = trail('fail', {
  description: 'Always fails',
  input: z.object({ reason: z.string() }),
  run: (input) => Result.err(new Error(input.reason)),
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
  input: z.object({ name: z.string() }),
  run: (input) => Result.ok({ greeting: `hello ${input.name}` }),
});

const dbService = service('db.main', {
  create: () =>
    Result.ok({
      source: 'factory',
    }),
});

const noExtra: McpExtra = {};

const requireTool = (tools: McpToolDefinition[], name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error(`Expected tool: ${name}`);
  }
  return tool;
};

const requireOnlyTool = (tools: McpToolDefinition[]) => {
  expect(tools).toHaveLength(1);
  const [tool] = tools;
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error('Expected one MCP tool');
  }
  return tool;
};

/**
 * Unwrap buildMcpTools result for success-path tests.
 * Throws if the result is an error so test failures surface clearly.
 */
const buildTools = (
  ...args: Parameters<typeof buildMcpTools>
): McpToolDefinition[] => {
  const result = buildMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
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
      const tools = buildTools(app);

      expect(tools).toHaveLength(1);
      expect(requireOnlyTool(tools).name).toBe('myapp_echo');
    });

    test('builds tools from a multi-trail app', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app);

      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain('myapp_echo');
      expect(names).toContain('myapp_item_delete');
      expect(names).toContain('myapp_fail');
    });

    test('tool names follow derivation rules', () => {
      const app = topo('myapp', { deleteTrail });
      const tools = buildTools(app);

      expect(requireOnlyTool(tools).name).toBe('myapp_item_delete');
    });

    test('input schema is valid JSON Schema', () => {
      const app = topo('myapp', { echoTrail });
      const schema = requireOnlyTool(buildTools(app)).inputSchema;

      expect(schema['type']).toBe('object');
      expect(schema['properties']).toBeDefined();
      const props = schema['properties'] as Record<string, unknown>;
      expect(props['message']).toEqual({ type: 'string' });
    });

    test('annotations are correctly derived', () => {
      const app = topo('myapp', { deleteTrail, echoTrail });
      const tools = buildTools(app);

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

    test('trailId identifies the source trail', () => {
      const app = topo('myapp', { deleteTrail, echoTrail });
      const tools = buildTools(app);

      expect(requireTool(tools, 'myapp_echo').trailId).toBe('echo');
      expect(requireTool(tools, 'myapp_item_delete').trailId).toBe(
        'item.delete'
      );
    });
  });

  describe('handler execution', () => {
    test('handler validates input and returns isError on invalid', async () => {
      const app = topo('myapp', { echoTrail });
      const tool = requireOnlyTool(buildTools(app));

      const result = await tool.handler({ notMessage: 123 }, noExtra);
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.type).toBe('text');
      expect(result?.content[0]?.text).toBeDefined();
    });

    test('handler calls implementation and returns result as text content', async () => {
      const app = topo('myapp', { echoTrail });
      const tool = requireOnlyTool(buildTools(app));

      const result = await tool.handler({ message: 'hello' }, noExtra);
      expect(result?.isError).toBeUndefined();
      expect(result?.content[0]?.type).toBe('text');
      expect(parseJsonContent(result?.content[0])).toEqual({
        reply: 'hello',
      });
    });

    test('handler maps errors to isError content', async () => {
      const app = topo('myapp', { failTrail });
      const tool = requireOnlyTool(buildTools(app));

      const result = await tool.handler({ reason: 'broken' }, noExtra);
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toBe('broken');
    });

    test('handler catches thrown exceptions', async () => {
      const throwTrail = trail('throw', {
        input: z.object({}),
        run: () => {
          throw new Error('unexpected crash');
        },
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { throwTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toBe('unexpected crash');
    });
  });

  describe('filters', () => {
    test('include filter limits which trails become tools', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        includeTrails: ['echo'],
      });

      expect(tools).toHaveLength(1);
      expect(requireOnlyTool(tools).name).toBe('myapp_echo');
    });

    test('exclude filter removes specific trails', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        excludeTrails: ['fail'],
      });

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('myapp_fail');
    });

    test('include takes precedence over exclude', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
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
      const tool = requireOnlyTool(buildTools(app, { layers: [testLayer] }));

      await tool.handler({ message: 'hi' }, noExtra);
      expect(calls).toEqual(['before', 'after']);
    });

    test('AbortSignal propagates from MCP extra to TrailContext', async () => {
      let capturedSignal: AbortSignal | undefined;

      const signalTrail = trail('signal.check', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedSignal = ctx.abortSignal;
          return Result.ok({ ok: true });
        },
      });

      const controller = new AbortController();
      const tool = requireOnlyTool(buildTools(topo('myapp', { signalTrail })));

      await tool.handler({}, { abortSignal: controller.signal });
      expect(capturedSignal).toBe(controller.signal);
    });

    test('description includes first example input when present', () => {
      const app = topo('myapp', { exampleTrail });
      const tool = requireOnlyTool(buildTools(app));

      expect(tool.description).toContain('A trail with examples');
      expect(tool.description).toContain('"name":"world"');
    });

    test('custom createContext is used when provided', async () => {
      let contextUsed = false;
      let surfaceUsed = false;

      const ctxTrail = trail('ctx.check', {
        input: z.object({}),
        run: (_input, ctx) => {
          contextUsed = ctx.extensions?.['custom'] === true;
          surfaceUsed = ctx.extensions?.[SURFACE_KEY] === 'mcp';
          return Result.ok({ ok: true });
        },
      });

      const app = topo('myapp', { ctxTrail });
      const tool = requireOnlyTool(
        buildTools(app, {
          createContext: () => ({
            abortSignal: new AbortController().signal,
            extensions: { custom: true },
            requestId: 'test-id',
          }),
        })
      );

      await tool.handler({}, noExtra);
      expect(contextUsed).toBe(true);
      expect(surfaceUsed).toBe(true);
    });

    test('service overrides are forwarded to executeTrail', async () => {
      const serviceTrail = trail('service.check', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) =>
          Result.ok({ source: dbService.from(ctx).source as string }),
        services: [dbService],
      });

      const tool = requireOnlyTool(
        buildTools(topo('myapp', { serviceTrail }), {
          services: { 'db.main': { source: 'override' } },
        })
      );

      const result = await tool.handler({}, noExtra);
      expect(result?.isError).toBeUndefined();
      expect(parseJsonContent(result?.content[0])).toEqual({
        source: 'override',
      });
    });
  });

  describe('blob outputs', () => {
    test('BlobRef output converts to image content', async () => {
      const blobTrail = trail('blob.image', {
        input: z.object({}),
        run: () =>
          Result.ok(
            createBlobRef({
              data: new Uint8Array([1, 2, 3]),
              mimeType: 'image/png',
              name: 'test.png',
              size: 3,
            })
          ),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('image');
      expect(result?.content[0]?.mimeType).toBe('image/png');
      expect(result?.content[0]?.data).toBeDefined();
    });

    test('BlobRef output converts to resource content for non-images', async () => {
      const blobTrail = trail('blob.file', {
        input: z.object({}),
        run: () =>
          Result.ok(
            createBlobRef({
              data: new Uint8Array([1, 2, 3]),
              mimeType: 'application/pdf',
              name: 'doc.pdf',
              size: 3,
            })
          ),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('resource');
      expect(result?.content[0]?.uri).toBe('blob://doc.pdf');
      expect(result?.content[0]?.mimeType).toBe('application/pdf');
    });

    test('BlobRef with ReadableStream data is collected and serialized', async () => {
      const bytes = new Uint8Array([10, 20, 30]);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const blobTrail = trail('blob.stream', {
        input: z.object({}),
        run: () =>
          Result.ok(
            createBlobRef({
              data: stream,
              mimeType: 'image/gif',
              name: 'anim.gif',
              size: 3,
            })
          ),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('image');
      expect(result?.content[0]?.mimeType).toBe('image/gif');
      expect(result?.content[0]?.data).toBeDefined();
    });
  });

  describe('tool-name collision detection', () => {
    test('returns Err on trails that produce the same derived tool name', () => {
      const dotTrail = trail('foo.bar', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });
      const underscoreTrail = trail('foo_bar', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });

      const app = topo('myapp', { dotTrail, underscoreTrail });
      const result = buildMcpTools(app);
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/tool-name collision/i);
    });

    test('returns Err on trails where hyphen and underscore collide', () => {
      const hyphenTrail = trail('foo-bar', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });
      const underscoreTrail = trail('foo_bar', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });

      const app = topo('myapp', { hyphenTrail, underscoreTrail });
      const result = buildMcpTools(app);
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/tool-name collision/i);
    });

    test('returns Ok when trail names are distinct after normalization', () => {
      const fooTrail = trail('foo', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });
      const barTrail = trail('bar', {
        input: z.object({}),
        run: () => Result.ok({ ok: true }),
      });

      const app = topo('myapp', { barTrail, fooTrail });
      const result = buildMcpTools(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('end-to-end', () => {
    test('full pipeline from trail to MCP response', async () => {
      const greetTrail = trail('greet', {
        description: 'Greet someone',
        idempotent: true,
        input: z.object({ name: z.string() }),
        intent: 'read',
        output: z.object({ greeting: z.string() }),
        run: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
      });

      const tool = requireOnlyTool(buildTools(topo('testapp', { greetTrail })));

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
