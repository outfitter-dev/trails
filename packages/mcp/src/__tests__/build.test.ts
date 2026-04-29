import { describe, expect, test } from 'bun:test';

import {
  Result,
  TRAILHEAD_KEY,
  createBlobRef,
  resource,
  signal,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer, TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { MCP_TOOL_EXAMPLES_META_KEY, deriveMcpTools } from '../build.js';
import type { McpExtra, McpToolDefinition } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ reply: input.message }),
  description: 'Echo a message back',
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const deleteTrail = trail('item.delete', {
  blaze: (_input) => Result.ok({ deleted: true }),
  description: 'Delete an item',
  input: z.object({ id: z.string() }),
  intent: 'destroy',
});

const failTrail = trail('fail', {
  blaze: (input) => Result.err(new Error(input.reason)),
  description: 'Always fails',
  input: z.object({ reason: z.string() }),
});

const exampleTrail = trail('with.examples', {
  blaze: (input) => Result.ok({ greeting: `hello ${input.name}` }),
  description: 'A trail with examples',
  examples: [
    {
      expected: { greeting: 'hello world' },
      input: { name: 'world' },
      name: 'basic',
    },
  ],
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
});

const internalTrail = trail('internal.secret', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  visibility: 'internal',
});

const dbResource = resource('db.main', {
  create: () =>
    Result.ok({
      source: 'factory',
    }),
});

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const requireFire = (fire: TrailContext['fire']) => {
  if (!fire) {
    throw new Error('Expected ctx.fire to be bound');
  }
  return fire;
};

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
 * Unwrap deriveMcpTools result for success-path tests.
 * Throws if the result is an error so test failures show up clearly.
 */
const buildTools = (
  ...args: Parameters<typeof deriveMcpTools>
): McpToolDefinition[] => {
  const result = deriveMcpTools(...args);
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

describe('deriveMcpTools', () => {
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

    test('output schema is projected when declared', () => {
      const app = topo('myapp', { echoTrail });
      const schema = requireOnlyTool(buildTools(app)).outputSchema;

      expect(schema?.['type']).toBe('object');
      const props = schema?.['properties'] as Record<string, unknown>;
      expect(props['reply']).toEqual({ type: 'string' });
    });

    test('non-object output schemas are wrapped for MCP structured content', () => {
      const listTrail = trail('items.list', {
        blaze: () => Result.ok(['one', 'two']),
        input: z.object({}),
        output: z.array(z.string()),
      });

      const schema = requireOnlyTool(
        buildTools(topo('myapp', { listTrail }))
      ).outputSchema;

      expect(schema).toEqual({
        properties: {
          data: { items: { type: 'string' }, type: 'array' },
        },
        required: ['data'],
        type: 'object',
      });
    });

    test('scalar union output schemas are wrapped for MCP structured content', () => {
      const scalarUnionTrail = trail('scalar.union', {
        blaze: () => Result.ok('one'),
        input: z.object({}),
        output: z.union([z.string(), z.number()]),
      });

      const schema = requireOnlyTool(
        buildTools(topo('myapp', { scalarUnionTrail }))
      ).outputSchema;

      expect(schema).toEqual({
        properties: {
          data: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['data'],
        type: 'object',
      });
    });

    test('mixed-shape unions wrap structured content even when value is an object', async () => {
      // `z.union([z.object(...), z.string()])` projects to a wrapped
      // outputSchema (`{ data: ... }`) because the schema is not
      // homogeneously object-shaped. The runtime structuredContent must
      // therefore also wrap, even when the value happens to be the object
      // branch — otherwise outputSchema and structuredContent diverge.
      const mixedTrail = trail('mixed.union', {
        blaze: () => Result.ok({ a: 'hello' }),
        input: z.object({}),
        output: z.union([z.object({ a: z.string() }), z.string()]),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { mixedTrail })));
      const schema = tool.outputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(schema['required']).toEqual(['data']);

      const result = await tool.handler({}, noExtra);
      expect(result?.structuredContent).toEqual({ data: { a: 'hello' } });
    });

    test('z.any() output wraps object structured content under data envelope', async () => {
      const anyTrail = trail('anything', {
        blaze: () => Result.ok({ shape: 'object' }),
        input: z.object({}),
        output: z.any(),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { anyTrail })));
      const schema = tool.outputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(schema['required']).toEqual(['data']);

      const result = await tool.handler({}, noExtra);
      expect(result?.structuredContent).toEqual({ data: { shape: 'object' } });
    });

    test('object union output schemas wrap under data envelope (MCP spec)', async () => {
      // MCP's Tool schema requires `outputSchema` to have literal
      // `type: "object"` at the root (see @modelcontextprotocol/sdk's
      // `outputSchema: z.object({ type: z.literal('object'), ... })`).
      // Discriminated unions emit as `{ anyOf: [...] }`, so they go
      // through the `wrapAsData` path: schema becomes
      // `{ type: 'object', properties: { data: { anyOf: [...] } }, required: ['data'] }`,
      // and structuredContent matches under `data`.
      const unionTrail = trail('surveyish', {
        blaze: () => Result.ok({ entries: [], mode: 'list' as const }),
        input: z.object({}),
        output: z.discriminatedUnion('mode', [
          z.object({ entries: z.array(z.unknown()), mode: z.literal('list') }),
          z.object({ detail: z.string(), mode: z.literal('detail') }),
        ]),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { unionTrail })));
      const schema = tool.outputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(schema['required']).toEqual(['data']);
      const props = schema['properties'] as Record<string, unknown>;
      expect((props['data'] as Record<string, unknown>)['anyOf']).toEqual([
        {
          properties: {
            entries: { items: {}, type: 'array' },
            mode: { const: 'list' },
          },
          required: ['entries', 'mode'],
          type: 'object',
        },
        {
          properties: {
            detail: { type: 'string' },
            mode: { const: 'detail' },
          },
          required: ['detail', 'mode'],
          type: 'object',
        },
      ]);

      const result = await tool.handler({}, noExtra);
      expect(result?.structuredContent).toEqual({
        data: { entries: [], mode: 'list' },
      });
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
      expect(result?.structuredContent).toEqual({ reply: 'hello' });
    });

    test('handler wraps non-object outputs as structured content data', async () => {
      const listTrail = trail('items.list', {
        blaze: () => Result.ok(['one', 'two']),
        input: z.object({}),
        output: z.array(z.string()),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { listTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.structuredContent).toEqual({ data: ['one', 'two'] });
    });

    test('passes topo to executeTrail so MCP-invoked producers can fan out', async () => {
      const captured: string[] = [];
      const consumer = trail('notify.email', {
        blaze: (input: { orderId: string }) => {
          captured.push(input.orderId);
          return Result.ok({ delivered: true });
        },
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const producer = trail('order.create', {
        blaze: async (input: { orderId: string }, ctx) => {
          const fired = await requireFire(ctx.fire)('order.placed', {
            orderId: input.orderId,
          });
          return fired.match({
            err: (error) => Result.err(error),
            ok: () => Result.ok({ ok: true }),
          });
        },
        fires: ['order.placed'],
        input: z.object({ orderId: z.string() }),
      });
      const tool = requireTool(
        buildTools(topo('signal-mcp', { consumer, orderPlaced, producer })),
        'signal_mcp_order_create'
      );

      const result = await tool.handler({ orderId: 'o-mcp' }, noExtra);

      expect(result.isError).toBeUndefined();
      expect(captured).toEqual(['o-mcp']);
    });

    test('consumer trails with on: are not exposed as MCP tools', () => {
      const consumer = trail('notify.email', {
        blaze: () => Result.ok({ delivered: true }),
        input: z.object({ orderId: z.string() }),
        on: ['order.placed'],
      });
      const producer = trail('order.create', {
        blaze: () => Result.ok({ ok: true }),
        fires: ['order.placed'],
        input: z.object({ orderId: z.string() }),
      });
      const tools = buildTools(
        topo('signal-mcp', { consumer, orderPlaced, producer })
      );
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('signal_mcp_order_create');
      expect(toolNames).not.toContain('signal_mcp_notify_email');
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
        blaze: () => {
          throw new Error('unexpected crash');
        },
        input: z.object({}),
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
        include: ['echo'],
      });

      expect(tools).toHaveLength(1);
      expect(requireOnlyTool(tools).name).toBe('myapp_echo');
    });

    test('exclude filter removes specific trails', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        exclude: ['fail'],
      });

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('myapp_fail');
    });

    test('exclude patterns apply before include narrowing', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        exclude: ['fail'],
        include: ['echo', 'fail'],
      });

      expect(tools).toHaveLength(1);
      const names = tools.map((t) => t.name);
      expect(names).toContain('myapp_echo');
      expect(names).not.toContain('myapp_fail');
    });

    test('exact include can expose an internal trail', () => {
      const app = topo('myapp', { echoTrail, internalTrail });
      const tools = buildTools(app, {
        include: ['internal.secret'],
      });

      expect(tools.map((tool) => tool.trailId)).toEqual(['internal.secret']);
    });

    test('wildcard include does not expose internal trails', () => {
      const app = topo('myapp', { echoTrail, internalTrail });
      const tools = buildTools(app, {
        include: ['**'],
      });

      expect(tools.map((tool) => tool.trailId)).toEqual(['echo']);
    });

    test('include narrows to a single trail and exclude drops another', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        exclude: ['fail'],
        include: ['echo'],
      });

      expect(tools.map((tool) => tool.trailId)).toEqual(['echo']);
    });

    test('intent filters narrow the tool list', () => {
      const app = topo('myapp', { deleteTrail, echoTrail, failTrail });
      const tools = buildTools(app, {
        intent: ['read'],
      });

      expect(tools.map((tool) => tool.trailId)).toEqual(['echo']);
    });

    test('intent filters compose with include patterns using AND logic', () => {
      const app = topo('myapp', { deleteTrail, echoTrail });
      const tools = buildTools(app, {
        include: ['item.*', 'echo'],
        intent: ['destroy'],
      });

      expect(tools.map((tool) => tool.trailId)).toEqual(['item.delete']);
    });
  });

  describe('composition', () => {
    test('layers compose and execute around the implementation', async () => {
      const calls: string[] = [];

      const testGate: Layer = {
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
      const tool = requireOnlyTool(buildTools(app, { layers: [testGate] }));

      await tool.handler({ message: 'hi' }, noExtra);
      expect(calls).toEqual(['before', 'after']);
    });

    test('AbortSignal propagates from MCP extra to TrailContext', async () => {
      let capturedSignal: AbortSignal | undefined;

      const signalTrail = trail('signal.check', {
        blaze: (_input, ctx) => {
          capturedSignal = ctx.abortSignal;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
      });

      const controller = new AbortController();
      const tool = requireOnlyTool(buildTools(topo('myapp', { signalTrail })));

      await tool.handler({}, { abortSignal: controller.signal });
      expect(capturedSignal).toBe(controller.signal);
    });

    test('examples are projected as structured MCP metadata', () => {
      const app = topo('myapp', { exampleTrail });
      const tool = requireOnlyTool(buildTools(app));

      expect(tool.description).toBe('A trail with examples');
      expect(tool._meta?.[MCP_TOOL_EXAMPLES_META_KEY]).toEqual([
        {
          expected: { greeting: 'hello world' },
          input: { name: 'world' },
          kind: 'success',
          name: 'basic',
          provenance: { source: 'trail.examples' },
        },
      ]);
    });

    test('custom createContext is used when provided', async () => {
      let contextUsed = false;
      let trailheadMarkerUsed = false;

      const ctxTrail = trail('ctx.check', {
        blaze: (_input, ctx) => {
          contextUsed = ctx.extensions?.['custom'] === true;
          trailheadMarkerUsed = ctx.extensions?.[TRAILHEAD_KEY] === 'mcp';
          return Result.ok({ ok: true });
        },
        input: z.object({}),
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
      expect(trailheadMarkerUsed).toBe(true);
    });

    test('resource overrides are forwarded to executeTrail', async () => {
      const resourceTrail = trail('resource.check', {
        blaze: (_input, ctx) =>
          Result.ok({ source: dbResource.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [dbResource],
      });

      const tool = requireOnlyTool(
        buildTools(topo('myapp', { dbResource, resourceTrail }), {
          resources: { 'db.main': { source: 'override' } },
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
        blaze: () =>
          Result.ok(
            createBlobRef({
              data: new Uint8Array([1, 2, 3]),
              mimeType: 'image/png',
              name: 'test.png',
              size: 3,
            })
          ),
        input: z.object({}),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('image');
      expect(result?.content[0]?.mimeType).toBe('image/png');
      expect(result?.content[0]?.data).toBeDefined();
    });

    test('BlobRef output converts to resource content for non-images', async () => {
      const blobTrail = trail('blob.file', {
        blaze: () =>
          Result.ok(
            createBlobRef({
              data: new Uint8Array([1, 2, 3]),
              mimeType: 'application/pdf',
              name: 'doc.pdf',
              size: 3,
            })
          ),
        input: z.object({}),
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
        blaze: () =>
          Result.ok(
            createBlobRef({
              data: stream,
              mimeType: 'image/gif',
              name: 'anim.gif',
              size: 3,
            })
          ),
        input: z.object({}),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      const result = await tool.handler({}, noExtra);

      expect(result?.content[0]?.type).toBe('image');
      expect(result?.content[0]?.mimeType).toBe('image/gif');
      expect(result?.content[0]?.data).toBeDefined();
    });

    test('BlobRef output with outputSchema keeps structuredContent present', async () => {
      const blobTrail = trail('blob.structured', {
        blaze: () =>
          Result.ok({
            attachment: createBlobRef({
              data: new Uint8Array([1, 2, 3]),
              mimeType: 'application/pdf',
              name: 'doc.pdf',
              size: 3,
            }),
            label: 'report',
          }),
        input: z.object({}),
        output: z.object({
          attachment: z.custom(),
          label: z.string(),
        }),
      });

      const tool = requireOnlyTool(buildTools(topo('myapp', { blobTrail })));
      expect(tool.outputSchema?.['type']).toBe('object');

      const result = await tool.handler({}, noExtra);

      expect(result?.content).toEqual([
        {
          text: JSON.stringify({ label: 'report' }),
          type: 'text',
        },
        {
          mimeType: 'application/pdf',
          type: 'resource',
          uri: 'blob://doc.pdf',
        },
      ]);
      expect(result?.structuredContent).toEqual({
        attachment: {
          mimeType: 'application/pdf',
          name: 'doc.pdf',
          size: 3,
          uri: 'blob://doc.pdf',
        },
        label: 'report',
      });
    });
  });

  describe('tool-name collision detection', () => {
    test('returns Err on trails that produce the same derived tool name', () => {
      const dotTrail = trail('foo.bar', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });
      const underscoreTrail = trail('foo_bar', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });

      const app = topo('myapp', { dotTrail, underscoreTrail });
      const result = deriveMcpTools(app);
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/tool-name collision/i);
    });

    test('returns Err on trails where hyphen and underscore collide', () => {
      const hyphenTrail = trail('foo-bar', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });
      const underscoreTrail = trail('foo_bar', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });

      const app = topo('myapp', { hyphenTrail, underscoreTrail });
      const result = deriveMcpTools(app);
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/tool-name collision/i);
    });

    test('returns Ok when trail names are distinct after normalization', () => {
      const fooTrail = trail('foo', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });
      const barTrail = trail('bar', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({}),
      });

      const app = topo('myapp', { barTrail, fooTrail });
      const result = deriveMcpTools(app);
      expect(result.isOk()).toBe(true);
    });
  });

  describe('end-to-end', () => {
    test('full pipeline from trail to MCP response', async () => {
      const greetTrail = trail('greet', {
        blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
        description: 'Greet someone',
        idempotent: true,
        input: z.object({ name: z.string() }),
        intent: 'read',
        output: z.object({ greeting: z.string() }),
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
      expect(successResult?.structuredContent).toEqual({
        greeting: 'Hello, World!',
      });

      const errorResult = await tool.handler({}, noExtra);
      expect(errorResult?.isError).toBe(true);
    });
  });

  describe('established graph enforcement', () => {
    test('returns Err when draft contamination remains', () => {
      const draftTrail = trail('entity.export', {
        blaze: () => Result.ok({ ok: true }),
        crosses: ['_draft.entity.prepare'],
        input: z.object({}),
      });

      const result = deriveMcpTools(topo('myapp', { draftTrail }));

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toMatch(/draft/i);
    });
  });
});
