/**
 * TRL-474: Project typed layer input onto the MCP surface.
 *
 * When a layer attached at trail/surface/topo scope declares an `input`
 * schema, the MCP tool definition merges that schema into the published
 * `inputSchema`, parses values from the incoming `args`, and passes them
 * into the layer's runtime input via
 * `ctx.extensions[LAYER_INPUTS_KEY][layer.name]`.
 */

import { describe, expect, test } from 'bun:test';

import { LAYER_INPUTS_KEY, Result, topo, trail } from '@ontrails/core';
import type { Implementation, Layer } from '@ontrails/core';
import { z } from 'zod';

import { deriveMcpTools } from '../build.js';
import type { McpExtra, McpToolDefinition } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildTools = (
  ...args: Parameters<typeof deriveMcpTools>
): readonly McpToolDefinition[] => {
  const result = deriveMcpTools(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const requireTool = (
  tools: readonly McpToolDefinition[]
): McpToolDefinition => {
  const [tool] = tools;
  expect(tool).toBeDefined();
  if (!tool) {
    throw new Error('Expected at least one tool');
  }
  return tool;
};

interface InputBucket {
  value: unknown;
}

const captureLayerInput = (
  layerName: string,
  schema: z.ZodType<unknown>,
  bucket: InputBucket
): Layer => ({
  input: schema,
  name: layerName,
  wrap<I, O>(_t, impl: Implementation<I, O>): Implementation<I, O> {
    return async (input, ctx) => {
      const all = ctx.extensions?.[LAYER_INPUTS_KEY] as
        | Record<string, unknown>
        | undefined;
      bucket.value = all?.[layerName];
      return await impl(input, ctx);
    };
  },
});

const makeEchoTrail = (
  overrides: { readonly layers?: readonly Layer[] } = {}
) =>
  trail('echo', {
    blaze: (input: { value: string }) => Result.ok({ value: input.value }),
    input: z.object({ value: z.string() }),
    output: z.object({ value: z.string() }),
    ...(overrides.layers === undefined ? {} : { layers: overrides.layers }),
  });

const emptyExtra: McpExtra = {};

interface JsonObjectSchema {
  readonly type?: unknown;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
}

const asJsonObject = (value: unknown): JsonObjectSchema => {
  expect(typeof value === 'object' && value !== null).toBe(true);
  return value as JsonObjectSchema;
};

// ---------------------------------------------------------------------------
// Schema projection
// ---------------------------------------------------------------------------

describe('TRL-474 MCP layer input projection — schema merge', () => {
  test('a typed trail-scope layer adds a property to the tool input schema', () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const tool = requireTool(buildTools(app));
    const schema = asJsonObject(tool.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).toContain('value');
    expect(Object.keys(properties)).toContain('verbose');
    expect(schema.required ?? []).toContain('verbose');
  });

  test('surface-scope layer schema appears on every tool', () => {
    const layer: Layer = {
      input: z.object({ tenantId: z.string() }),
      name: 'tenant',
      wrap: (_t, impl) => impl,
    };
    const a = trail('alpha', {
      blaze: () => Result.ok(1),
      input: z.object({}),
    });
    const b = trail('beta', {
      blaze: () => Result.ok(2),
      input: z.object({}),
    });
    const app = topo('app', { [a.id]: a, [b.id]: b });

    const tools = buildTools(app, { layers: [layer] });
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      const schema = asJsonObject(tool.inputSchema);
      const properties = schema.properties ?? {};
      expect(Object.keys(properties)).toContain('tenantId');
    }
  });

  test('topo-scope layer schema appears on every tool', () => {
    const layer: Layer = {
      input: z.object({ auditMode: z.enum(['off', 'full']) }),
      name: 'audit',
      wrap: (_t, impl) => impl,
    };
    const a = trail('alpha', {
      blaze: () => Result.ok(1),
      input: z.object({}),
    });
    const b = trail('beta', {
      blaze: () => Result.ok(2),
      input: z.object({}),
    });
    const app = topo('app', { [a.id]: a, [b.id]: b }, { layers: [layer] });

    const tools = buildTools(app);
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      const schema = asJsonObject(tool.inputSchema);
      const properties = schema.properties ?? {};
      expect(Object.keys(properties)).toContain('auditMode');
    }
  });

  test('layers without an input schema do not change the published schema', () => {
    const layer: Layer = {
      name: 'noop',
      wrap: (_t, impl) => impl,
    };
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });
    const echoBaseline = makeEchoTrail();
    const baselineApp = topo('app', { [echoBaseline.id]: echoBaseline });

    const withLayer = requireTool(buildTools(app));
    const baseline = requireTool(buildTools(baselineApp));

    const propsWith = Object.keys(
      asJsonObject(withLayer.inputSchema).properties ?? {}
    );
    const propsBaseline = Object.keys(
      asJsonObject(baseline.inputSchema).properties ?? {}
    );
    expect(new Set(propsWith)).toEqual(new Set(propsBaseline));
  });
});

// ---------------------------------------------------------------------------
// Runtime mapping
// ---------------------------------------------------------------------------

describe('TRL-474 MCP layer input projection — runtime mapping', () => {
  test('parsed layer parameters reach the layer at runtime', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    const echo = makeEchoTrail({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const tool = requireTool(buildTools(app));
    const result = await tool.handler(
      { value: 'hi', verbose: true },
      emptyExtra
    );

    expect(result.isError ?? false).toBe(false);
    expect(bucket.value).toEqual({ verbose: true });
  });

  test('layer input does not pollute the trail input', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    let observedInput: unknown;
    const recorded = trail('rec', {
      blaze: (input: { value: string }) => {
        observedInput = input;
        return Result.ok({ value: input.value });
      },
      input: z.object({ value: z.string() }),
      layers: [layer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [recorded.id]: recorded });

    const tool = requireTool(buildTools(app));
    const result = await tool.handler(
      { value: 'hi', verbose: true },
      emptyExtra
    );

    expect(result.isError ?? false).toBe(false);
    expect(observedInput).toEqual({ value: 'hi' });
  });

  test('topo-scope layer receives runtime input through ctx.extensions', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'audit',
      z.object({ auditMode: z.enum(['off', 'full']) }),
      bucket
    );
    const echo = makeEchoTrail();
    const app = topo('app', { [echo.id]: echo }, { layers: [layer] });

    const tool = requireTool(buildTools(app));
    const result = await tool.handler(
      { auditMode: 'full', value: 'hi' },
      emptyExtra
    );

    expect(result.isError ?? false).toBe(false);
    expect(bucket.value).toEqual({ auditMode: 'full' });
  });
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

describe('TRL-474 MCP layer input projection — collisions', () => {
  test('a layer field colliding with a trail field is renamed and delivered', async () => {
    const bucket: InputBucket = { value: undefined };
    const collidingLayer = captureLayerInput(
      'collide',
      z.object({ value: z.boolean() }),
      bucket
    );
    const echo = trail('echo', {
      blaze: (input: { value: string }) => Result.ok({ value: input.value }),
      input: z.object({ value: z.string() }),
      layers: [collidingLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const tool = requireTool(buildTools(app));
    const schema = asJsonObject(tool.inputSchema);
    const properties = schema.properties ?? {};
    // Trail's `value` parameter remains.
    expect(Object.keys(properties)).toContain('value');
    // Layer's `value` is renamed under the layer's name (camelCase).
    expect(Object.keys(properties)).toContain('collideValue');

    const result = await tool.handler(
      { collideValue: true, value: 'hi' },
      emptyExtra
    );
    expect(result.isError ?? false).toBe(false);
    expect(bucket.value).toEqual({ value: true });
  });

  test('a layer field colliding with a reserved tool field is renamed and delivered', async () => {
    const bucket: InputBucket = { value: undefined };
    const reservedLayer = captureLayerInput(
      'audit',
      z.object({ all: z.boolean() }),
      bucket
    );
    const echo = makeEchoTrail({ layers: [reservedLayer] });
    const app = topo('app', { [echo.id]: echo });

    const tool = requireTool(buildTools(app));
    const schema = asJsonObject(tool.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).not.toContain('all');
    expect(Object.keys(properties)).toContain('auditAll');

    const result = await tool.handler(
      { auditAll: true, value: 'hi' },
      emptyExtra
    );
    expect(result.isError ?? false).toBe(false);
    expect(bucket.value).toEqual({ all: true });
  });

  test('a renamed layer field gets a deterministic suffix when the fallback also collides', async () => {
    const bucket: InputBucket = { value: undefined };
    const authLayer = captureLayerInput(
      'auth',
      z.object({ token: z.string() }),
      bucket
    );
    const echo = trail('echo', {
      blaze: (input: { authToken: string; token: string; value: string }) =>
        Result.ok({ value: input.value }),
      input: z.object({
        authToken: z.string(),
        token: z.string(),
        value: z.string(),
      }),
      layers: [authLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const tool = requireTool(buildTools(app));
    const schema = asJsonObject(tool.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).toContain('authToken');
    expect(Object.keys(properties)).toContain('authToken2');

    const result = await tool.handler(
      {
        authToken: 'trail-auth',
        authToken2: 'layer-auth',
        token: 'trail-token',
        value: 'hi',
      },
      emptyExtra
    );
    expect(result.isError ?? false).toBe(false);
    expect(bucket.value).toEqual({ token: 'layer-auth' });
  });

  test('the rename rule is deterministic across builds', () => {
    const buildOnce = () => {
      const collidingLayer: Layer = {
        input: z.object({ value: z.boolean() }),
        name: 'collide',
        wrap: (_t, impl) => impl,
      };
      const echo = trail('echo', {
        blaze: (input: { value: string }) => Result.ok({ value: input.value }),
        input: z.object({ value: z.string() }),
        layers: [collidingLayer],
        output: z.object({ value: z.string() }),
      });
      const app = topo('app', { [echo.id]: echo });
      const tool = requireTool(buildTools(app));
      const schema = asJsonObject(tool.inputSchema);
      return new Set(Object.keys(schema.properties ?? {}));
    };
    expect(buildOnce()).toEqual(buildOnce());
  });
});
