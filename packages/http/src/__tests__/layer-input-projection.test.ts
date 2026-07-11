/**
 * TRL-474: Project typed layer input onto the HTTP surface.
 *
 * When a layer attached at trail/surface/topo scope declares an `input`
 * schema, the HTTP route definition merges that schema into the published
 * `inputSchema`, partitions the parsed request input into trail input vs.
 * per-layer input, and routes layer values through
 * `ctx.extensions[LAYER_INPUTS_KEY][layer.name]`.
 */

import { describe, expect, test } from 'bun:test';

import { LAYER_INPUTS_KEY, Result, topo, trail, webhook } from '@ontrails/core';
import type { Implementation, Layer } from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes } from '../build.js';
import type { HttpRouteDefinition } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildRoutes = (
  ...args: Parameters<typeof deriveHttpRoutes>
): readonly HttpRouteDefinition[] => {
  const result = deriveHttpRoutes(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const requireRoute = (
  routes: readonly HttpRouteDefinition[]
): HttpRouteDefinition => {
  const [route] = routes;
  expect(route).toBeDefined();
  if (!route) {
    throw new Error('Expected at least one route');
  }
  return route;
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

const makeReadEcho = (overrides: { readonly layers?: readonly Layer[] } = {}) =>
  trail('echo', {
    implementation: (input: { value: string }) =>
      Result.ok({ value: input.value }),
    input: z.object({ value: z.string() }),
    intent: 'read',
    output: z.object({ value: z.string() }),
    ...(overrides.layers === undefined ? {} : { layers: overrides.layers }),
  });

const makeWriteCreate = (
  overrides: { readonly layers?: readonly Layer[] } = {}
) =>
  trail('item.create', {
    implementation: (input: { name: string }) =>
      Result.ok({ id: '123', name: input.name }),
    input: z.object({ name: z.string() }),
    intent: 'write',
    output: z.object({ id: z.string(), name: z.string() }),
    ...(overrides.layers === undefined ? {} : { layers: overrides.layers }),
  });

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
// Schema projection — query (read) and body (write/destroy)
// ---------------------------------------------------------------------------

describe('TRL-474 HTTP layer input projection — schema merge', () => {
  test('a typed trail-scope layer adds a property to the read route input schema', () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    const echo = makeReadEcho({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const route = requireRoute(buildRoutes(app));
    expect(route.method).toBe('GET');
    expect(route.inputSource).toBe('query');
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).toContain('value');
    expect(Object.keys(properties)).toContain('verbose');
    expect(schema.required ?? []).toContain('verbose');
  });

  test('a typed trail-scope layer adds a property to the write route input schema', () => {
    const layer: Layer = {
      input: z.object({ tenantId: z.string() }),
      name: 'tenant',
      wrap: (_t, impl) => impl,
    };
    const create = makeWriteCreate({ layers: [layer] });
    const app = topo('app', { [create.id]: create });

    const route = requireRoute(buildRoutes(app));
    expect(route.method).toBe('POST');
    expect(route.inputSource).toBe('body');
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).toContain('name');
    expect(Object.keys(properties)).toContain('tenantId');
  });

  test('topo-scope layer schema appears on every route', () => {
    const layer: Layer = {
      input: z.object({ auditMode: z.enum(['off', 'full']) }),
      name: 'audit',
      wrap: (_t, impl) => impl,
    };
    const a = trail('alpha', {
      implementation: () => Result.ok(1),
      input: z.object({}),
      intent: 'read',
    });
    const b = trail('beta', {
      implementation: () => Result.ok(2),
      input: z.object({}),
      intent: 'write',
    });
    const app = topo('app', { [a.id]: a, [b.id]: b }, { layers: [layer] });

    const routes = buildRoutes(app);
    expect(routes).toHaveLength(2);
    for (const route of routes) {
      const schema = asJsonObject(route.inputSchema);
      const properties = schema.properties ?? {};
      expect(Object.keys(properties)).toContain('auditMode');
    }
  });

  test('layers without an input schema do not change the published schema', () => {
    const layer: Layer = {
      name: 'noop',
      wrap: (_t, impl) => impl,
    };
    const echo = makeReadEcho({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });
    const baseline = makeReadEcho();
    const baselineApp = topo('app', { [baseline.id]: baseline });

    const withLayer = requireRoute(buildRoutes(app));
    const baselineRoute = requireRoute(buildRoutes(baselineApp));

    const propsWith = Object.keys(
      asJsonObject(withLayer.inputSchema).properties ?? {}
    );
    const propsBaseline = Object.keys(
      asJsonObject(baselineRoute.inputSchema).properties ?? {}
    );
    expect(new Set(propsWith)).toEqual(new Set(propsBaseline));
    expect(withLayer.layerInputProjections ?? []).toHaveLength(0);
  });

  test('merged webhook routes publish layer input fields from every consumer', () => {
    const source = webhook('webhook.payment.received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const auditLayer: Layer = {
      input: z.object({ auditMode: z.enum(['off', 'full']) }),
      name: 'audit',
      wrap: (_t, impl) => impl,
    };
    const tenantLayer: Layer = {
      input: z.object({ tenantId: z.string() }),
      name: 'tenant',
      wrap: (_t, impl) => impl,
    };
    const audit = trail('payment.audit', {
      implementation: (input: { paymentId: string }) =>
        Result.ok({ audited: input.paymentId }),
      input: z.object({ paymentId: z.string() }),
      layers: [auditLayer],
      on: [source],
      output: z.object({ audited: z.string() }),
    });
    const notify = trail('payment.notify', {
      implementation: (input: { paymentId: string }) =>
        Result.ok({ notified: input.paymentId }),
      input: z.object({ paymentId: z.string() }),
      layers: [tenantLayer],
      on: [source],
      output: z.object({ notified: z.string() }),
    });
    const app = topo('billing', { audit, notify });

    const route = requireRoute(buildRoutes(app));
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};

    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['paymentId', 'auditMode', 'tenantId'])
    );
    expect(schema.required ?? []).toEqual(
      expect.arrayContaining(['paymentId', 'auditMode', 'tenantId'])
    );
  });
});

// ---------------------------------------------------------------------------
// Runtime routing — query and body
// ---------------------------------------------------------------------------

describe('TRL-474 HTTP layer input projection — runtime routing', () => {
  test('parsed query parameters are routed to the layer at runtime (read)', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'trace',
      z.object({ verbose: z.boolean() }),
      bucket
    );
    const echo = makeReadEcho({ layers: [layer] });
    const app = topo('app', { [echo.id]: echo });

    const route = requireRoute(buildRoutes(app));
    const result = await route.execute({ value: 'hi', verbose: true });

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ verbose: true });
  });

  test('parsed body fields are routed to the layer at runtime (write)', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'tenant',
      z.object({ tenantId: z.string() }),
      bucket
    );
    const create = makeWriteCreate({ layers: [layer] });
    const app = topo('app', { [create.id]: create });

    const route = requireRoute(buildRoutes(app));
    const result = await route.execute({
      name: 'thing',
      tenantId: 'acme',
    });

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ tenantId: 'acme' });
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
      implementation: (input: { value: string }) => {
        observedInput = input;
        return Result.ok({ value: input.value });
      },
      input: z.object({ value: z.string() }),
      intent: 'read',
      layers: [layer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [recorded.id]: recorded });

    const route = requireRoute(buildRoutes(app));
    const result = await route.execute({ value: 'hi', verbose: true });

    expect(result.isOk()).toBe(true);
    expect(observedInput).toEqual({ value: 'hi' });
  });

  test('topo-scope layer routes runtime input through ctx.extensions', async () => {
    const bucket: InputBucket = { value: undefined };
    const layer = captureLayerInput(
      'audit',
      z.object({ auditMode: z.enum(['off', 'full']) }),
      bucket
    );
    const echo = makeReadEcho();
    const app = topo('app', { [echo.id]: echo }, { layers: [layer] });

    const route = requireRoute(buildRoutes(app));
    const result = await route.execute({ auditMode: 'full', value: 'hi' });

    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ auditMode: 'full' });
  });
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

describe('TRL-474 HTTP layer input projection — collisions', () => {
  test('a layer field colliding with a trail field is renamed and routed', async () => {
    const bucket: InputBucket = { value: undefined };
    const collidingLayer = captureLayerInput(
      'collide',
      z.object({ value: z.boolean() }),
      bucket
    );
    const echo = trail('echo', {
      implementation: (input: { value: string }) =>
        Result.ok({ value: input.value }),
      input: z.object({ value: z.string() }),
      intent: 'read',
      layers: [collidingLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const route = requireRoute(buildRoutes(app));
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};
    // Trail's `value` parameter remains unchanged.
    expect(Object.keys(properties)).toContain('value');
    // Layer's colliding `value` is renamed under the layer's name (camelCase).
    expect(Object.keys(properties)).toContain('collideValue');

    const result = await route.execute({ collideValue: true, value: 'hi' });
    expect(result.isOk()).toBe(true);
    expect(bucket.value).toEqual({ value: true });
  });

  test('a layer field colliding with a reserved route field is renamed and routed', async () => {
    const bucket: InputBucket = { value: undefined };
    const reservedLayer = captureLayerInput(
      'audit',
      z.object({ all: z.boolean() }),
      bucket
    );
    const echo = makeReadEcho({ layers: [reservedLayer] });
    const app = topo('app', { [echo.id]: echo });

    const route = requireRoute(buildRoutes(app));
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).not.toContain('all');
    expect(Object.keys(properties)).toContain('auditAll');

    const result = await route.execute({ auditAll: true, value: 'hi' });
    expect(result.isOk()).toBe(true);
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
      implementation: (input: {
        authToken: string;
        token: string;
        value: string;
      }) => Result.ok({ value: input.value }),
      input: z.object({
        authToken: z.string(),
        token: z.string(),
        value: z.string(),
      }),
      intent: 'read',
      layers: [authLayer],
      output: z.object({ value: z.string() }),
    });
    const app = topo('app', { [echo.id]: echo });

    const route = requireRoute(buildRoutes(app));
    const schema = asJsonObject(route.inputSchema);
    const properties = schema.properties ?? {};
    expect(Object.keys(properties)).toContain('authToken');
    expect(Object.keys(properties)).toContain('authToken2');

    const result = await route.execute({
      authToken: 'trail-auth',
      authToken2: 'layer-auth',
      token: 'trail-token',
      value: 'hi',
    });
    expect(result.isOk()).toBe(true);
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
        implementation: (input: { value: string }) =>
          Result.ok({ value: input.value }),
        input: z.object({ value: z.string() }),
        intent: 'read',
        layers: [collidingLayer],
        output: z.object({ value: z.string() }),
      });
      const app = topo('app', { [echo.id]: echo });
      const route = requireRoute(buildRoutes(app));
      const schema = asJsonObject(route.inputSchema);
      return new Set(Object.keys(schema.properties ?? {}));
    };
    expect(buildOnce()).toEqual(buildOnce());
  });
});
