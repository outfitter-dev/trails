import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  LAYER_INPUTS_KEY,
  NotFoundError,
  PermissionError,
  Result,
  blobRefSchema,
  createBlobRef,
  getWebhookHeader,
  resource,
  trail,
  topo,
  webhook,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

import {
  deriveHttpRoutes,
  resolveHttpQueryInput,
  resolveHttpQueryInputSchema,
} from '../build.js';
import { createFetchHandler, createRouteHandler } from '../fetch.js';

let originalConsoleError = console.error;
let loggedErrors: unknown[][] = [];

beforeEach(() => {
  originalConsoleError = console.error;
  loggedErrors = [];
  console.error = mock((...args: unknown[]) => {
    loggedErrors.push(args);
  });
});

afterEach(() => {
  console.error = originalConsoleError;
  loggedErrors = [];
});

const echoTrail = trail('echo', {
  implementation: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const tagsTrail = trail('tags', {
  implementation: (input) => Result.ok({ tags: input.tags }),
  input: z.object({ tags: z.array(z.string()) }),
  intent: 'read',
  output: z.object({ tags: z.array(z.string()) }),
});

const typedQuerySchema = z.object({
  count: z.number(),
  enabled: z.boolean(),
  label: z.string(),
});

const typedQueryTrail = trail('typed.query', {
  implementation: (input) => Result.ok(input),
  input: typedQuerySchema,
  intent: 'read',
  output: typedQuerySchema,
});

const typedQueryDefaultsSchema = z.object({
  count: z.number().optional(),
  enabled: z.boolean().default(false),
});

const typedQueryDefaultsTrail = trail('typed.defaults', {
  implementation: (input) => Result.ok(input),
  input: typedQueryDefaultsSchema,
  intent: 'read',
  output: typedQueryDefaultsSchema,
});

const typedQueryArraysSchema = z.object({
  counts: z.array(z.number()),
  enabled: z.array(z.boolean()),
  labels: z.array(z.string()),
});

const typedQueryArraysTrail = trail('typed.arrays', {
  implementation: (input) => Result.ok(input),
  input: typedQueryArraysSchema,
  intent: 'read',
  output: typedQueryArraysSchema,
});

const echoBodyTrail = trail('echo.body', {
  implementation: (input) => Result.ok({ length: input.message.length }),
  input: z.object({ message: z.string() }),
  intent: 'write',
  output: z.object({ length: z.number() }),
});

const genericErrorTrail = trail('generic.error', {
  implementation: () => Result.err(new Error('database password=secret')),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const protectedTrail = trail('permit.scope', {
  implementation: (_input, ctx) =>
    Result.ok({
      permitId: ctx.permit?.id,
      requestId: ctx.requestId,
    }),
  input: z.object({}),
  intent: 'read',
  output: z.object({
    permitId: z.string().optional(),
    requestId: z.string().optional(),
  }),
  permit: { scopes: ['thing:read'] },
});

const webhookSecret = 'secret';
const paymentWebhook = webhook('webhook.payment.received', {
  parse: z.object({ paymentId: z.string() }),
  path: '/webhooks/payment',
  verify: (request) =>
    getWebhookHeader(request, 'x-webhook-secret') === webhookSecret
      ? Result.ok()
      : Result.err(new PermissionError('Invalid webhook secret')),
});

const paymentWebhookTrail = trail('payment.receive', {
  implementation: (input) => Result.ok({ paymentId: input.paymentId }),
  input: z.object({ paymentId: z.string() }),
  on: [paymentWebhook],
  output: z.object({ paymentId: z.string() }),
});

const buildRequest = (path: string, init: RequestInit = {}): Request =>
  new Request(new URL(path, 'http://localhost').toString(), init);

describe('@ontrails/http/fetch', () => {
  test('createFetchHandler dispatches GET routes from query parameters', async () => {
    const handler = createFetchHandler(topo('fetch-api', { echoTrail }));

    const response = await handler(buildRequest('/echo?message=hello'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'hello' } });
  });

  test('createRouteHandler handles one derived route directly', async () => {
    const routes = deriveHttpRoutes(topo('fetch-api', { echoTrail }));
    expect(routes.isOk()).toBe(true);
    if (!routes.isOk()) {
      return;
    }
    const [route] = routes.value;
    expect(route).toBeDefined();
    if (route === undefined) {
      return;
    }
    const handler = createRouteHandler(route);

    const response = await handler(buildRequest('/echo?message=direct'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'direct' } });
  });

  test('preserves repeated query keys as arrays and singleton keys as scalars', async () => {
    const handler = createFetchHandler(topo('fetch-api', { tagsTrail }));

    const repeated = await handler(buildRequest('/tags?tags=red&tags=blue'));
    const singleton = await handler(buildRequest('/tags?tags=solo'));

    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({
      data: { tags: ['red', 'blue'] },
    });
    expect(singleton.status).toBe(400);
    expect(await singleton.json()).toMatchObject({
      error: { category: 'validation' },
    });
  });

  describe('schema-derived query values', () => {
    test('converts declared number and boolean fields while preserving strings', async () => {
      const handler = createFetchHandler(
        topo('fetch-api', { typedQueryTrail })
      );

      const response = await handler(
        buildRequest('/typed/query?count=0&enabled=false&label=0')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { count: 0, enabled: false, label: '0' },
      });
    });

    test('leaves malformed number and boolean values for normal validation', async () => {
      const handler = createFetchHandler(
        topo('fetch-api', { typedQueryTrail })
      );

      const malformedNumber = await handler(
        buildRequest('/typed/query?count=2x&enabled=true&label=ok')
      );
      const malformedBoolean = await handler(
        buildRequest('/typed/query?count=2&enabled=1&label=ok')
      );
      const nonFiniteNumber = await handler(
        buildRequest('/typed/query?count=1e309&enabled=true&label=ok')
      );
      const uppercaseBoolean = await handler(
        buildRequest('/typed/query?count=2&enabled=TRUE&label=ok')
      );

      expect(malformedNumber.status).toBe(400);
      expect(await malformedNumber.json()).toMatchObject({
        error: { category: 'validation' },
      });
      expect(malformedBoolean.status).toBe(400);
      expect(await malformedBoolean.json()).toMatchObject({
        error: { category: 'validation' },
      });
      expect(nonFiniteNumber.status).toBe(400);
      expect(uppercaseBoolean.status).toBe(400);
    });

    test('preserves authored coercion alongside strict query conversion', async () => {
      const schema = z.object({
        count: z.number(),
        enabled: z.coerce.boolean(),
        flags: z.array(z.coerce.boolean()),
      });
      const coercingTrail = trail('typed.coercing', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(topo('fetch-api', { coercingTrail }));

      const response = await handler(
        buildRequest(
          '/typed/coercing?count=2&enabled=false&flags=false&flags=true'
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { count: 2, enabled: true, flags: [true, true] },
      });
      expect(
        schema.parse({ count: 2, enabled: 'false', flags: ['false', 'true'] })
      ).toEqual({ count: 2, enabled: true, flags: [true, true] });
    });

    test('converts primitive literals and homogeneous union branches', async () => {
      const schema = z.object({
        exactCount: z.literal(2),
        exactEnabled: z.literal(false),
        maybeCount: z.number().nullable(),
        maybeEnabled: z.boolean().nullable(),
        mixed: z.union([z.string(), z.number()]),
        numeric: z.union([z.number(), z.literal(3)]),
      });
      const unionTrail = trail('typed.unions', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(topo('fetch-api', { unionTrail }));

      const response = await handler(
        buildRequest(
          '/typed/unions?exactCount=2&exactEnabled=false&maybeCount=0&maybeEnabled=true&mixed=4&numeric=4'
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: {
          exactCount: 2,
          exactEnabled: false,
          maybeCount: 0,
          maybeEnabled: true,
          mixed: '4',
          numeric: 4,
        },
      });
    });

    test('leaves null spellings and malformed homogeneous unions raw', async () => {
      const schema = z.object({
        enabled: z.boolean().nullable(),
        value: z.number().nullable(),
      });
      const nullableTrail = trail('typed.nullable', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(topo('fetch-api', { nullableTrail }));

      const nullSpelling = await handler(
        buildRequest('/typed/nullable?value=null&enabled=true')
      );
      const malformed = await handler(
        buildRequest('/typed/nullable?value=abc&enabled=true')
      );

      expect(nullSpelling.status).toBe(400);
      expect(malformed.status).toBe(400);
    });

    test('converts fields owned by the only structurally possible root union branch', async () => {
      const schema = z.union([
        z.object({ count: z.number() }),
        z.object({ enabled: z.boolean() }),
      ]);
      const rootUnionTrail = trail('typed.root-union', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(topo('fetch-api', { rootUnionTrail }));

      const count = await handler(buildRequest('/typed/root-union?count=2'));
      const enabled = await handler(
        buildRequest('/typed/root-union?enabled=false')
      );
      const ambiguous = await handler(
        buildRequest('/typed/root-union?count=2&enabled=false')
      );

      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ data: { count: 2 } });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toEqual({ data: { enabled: false } });
      expect(ambiguous.status).toBe(400);
    });

    test('preserves coercion declared within a root union branch', async () => {
      const schema = z.union([
        z.object({ count: z.number() }),
        z.object({ enabled: z.coerce.boolean() }),
      ]);
      const coercingUnionTrail = trail('typed.coercing-union', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(
        topo('fetch-api', { coercingUnionTrail })
      );

      const count = await handler(
        buildRequest('/typed/coercing-union?count=2')
      );
      const enabled = await handler(
        buildRequest('/typed/coercing-union?enabled=false')
      );

      expect(count.status).toBe(200);
      expect(await count.json()).toEqual({ data: { count: 2 } });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toEqual({ data: { enabled: true } });
    });

    test('preserves raw fields that a possible root union branch does not own', async () => {
      const schema = z.union([
        z.object({ count: z.number() }),
        z.object({ marker: z.string().optional() }).passthrough(),
      ]);
      const passthroughUnionTrail = trail('typed.passthrough-union', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(
        topo('fetch-api', { passthroughUnionTrail })
      );

      const response = await handler(
        buildRequest('/typed/passthrough-union?count=2')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { count: '2' } });
    });

    test('retains root union inference with version and layer properties', async () => {
      const schema = z.union([
        z.object({ count: z.number() }),
        z.object({ enabled: z.boolean() }),
      ]);
      const typedLayer: Layer = {
        input: z.object({ audited: z.boolean() }),
        name: 'audit',
        wrap: (_trail, implementation) => implementation,
      };
      const versionedUnionTrail = trail('typed.versioned-union', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        layers: [typedLayer],
        output: schema,
        version: 2,
        versions: {
          1: {
            input: schema,
            output: schema,
            transpose: {
              input: ({ input }) => input,
              output: ({ output }) => output,
            },
          },
        },
      });
      const handler = createFetchHandler(
        topo('fetch-api', { versionedUnionTrail })
      );

      const response = await handler(
        buildRequest(
          '/typed/versioned-union?count=2&audited=false&trailVersion=2'
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { count: 2 } });
    });

    test('does not let shared object properties override conflicting union fields', async () => {
      const schema = z.object({ count: z.string() });
      const collisionTrail = trail('typed.union-collision', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const routes = deriveHttpRoutes(topo('fetch-api', { collisionTrail }));
      expect(routes.isOk()).toBe(true);
      if (!routes.isOk()) {
        return;
      }
      const [route] = routes.value;
      expect(route).toBeDefined();
      if (route === undefined) {
        return;
      }
      const handler = createRouteHandler({
        ...route,
        inputSchema: {
          anyOf: [
            {
              properties: { count: { type: 'number' } },
              required: ['count'],
              type: 'object',
            },
          ],
          properties: { count: { type: 'boolean' } },
          type: 'object',
        },
      });

      const response = await handler(
        buildRequest('/typed/union-collision?count=false')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { count: 'false' } });
    });

    test('preserves renamed coercing layer fields through copied route renderings', async () => {
      let capturedLayerInput: unknown;
      const coercingLayer: Layer = {
        input: z.object({ count: z.coerce.boolean() }),
        name: 'audit',
        wrap: (_trail, implementation) => async (input, context) => {
          const layerInputs = context.extensions?.[LAYER_INPUTS_KEY] as
            | Record<string, unknown>
            | undefined;
          capturedLayerInput = layerInputs?.['audit'];
          return await implementation(input, context);
        },
      };
      const schema = z.object({ count: z.number() });
      const coercingLayerTrail = trail('typed.coercing-layer', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        layers: [coercingLayer],
        output: schema,
      });
      const routes = deriveHttpRoutes(
        topo('fetch-api', { coercingLayerTrail })
      );
      expect(routes.isOk()).toBe(true);
      if (!routes.isOk()) {
        return;
      }
      const [route] = routes.value;
      expect(route).toBeDefined();
      if (route === undefined) {
        return;
      }
      const copiedRenderings = route.layerInputRenderings?.map((rendering) => ({
        ...rendering,
      }));
      const copiedRoute = { ...route, layerInputRenderings: copiedRenderings };
      const handler = createRouteHandler(copiedRoute);

      const response = await handler(
        buildRequest('/typed/coercing-layer?count=2&auditCount=false')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { count: 2 } });
      expect(capturedLayerInput).toEqual({ count: true });

      capturedLayerInput = undefined;
      const replacedRouting = copiedRenderings?.map((rendering) => ({
        ...rendering,
        routing: new Map(rendering.routing),
      }));
      const replacedResponse = await createRouteHandler({
        ...route,
        layerInputRenderings: replacedRouting,
      })(buildRequest('/typed/coercing-layer?count=2&auditCount=false'));
      expect(replacedResponse.status).toBe(200);
      expect(capturedLayerInput).toEqual({ count: true });

      const unclassifiedRendering = {
        layerName: 'added',
        properties: { addedFlag: { type: 'boolean' } },
        required: ['addedFlag'],
        routing: new Map([['addedFlag', 'flag']]),
      };
      const resolved = resolveHttpQueryInput(
        {
          ...copiedRoute,
          layerInputRenderings: [
            ...(copiedRenderings ?? []),
            unclassifiedRendering,
          ],
        },
        { addedFlag: 'false', count: '2' },
        {}
      );
      expect(resolved.preserveRawFields.has('addedFlag')).toBe(true);
    });

    test('converts repeated nullable primitive arrays element by element', async () => {
      const schema = z.object({
        enabled: z.array(z.boolean()).nullable(),
        mixed: z.union([z.array(z.string()), z.array(z.number())]),
        values: z.array(z.number()).nullable(),
      });
      const nullableArraysTrail = trail('typed.nullable-arrays', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const handler = createFetchHandler(
        topo('fetch-api', { nullableArraysTrail })
      );

      const response = await handler(
        buildRequest(
          '/typed/nullable-arrays?values=1&values=2&enabled=false&enabled=true&mixed=1&mixed=2'
        )
      );
      const malformed = await handler(
        buildRequest(
          '/typed/nullable-arrays?values=1&values=two&enabled=false&enabled=true&mixed=1&mixed=2'
        )
      );
      const singleton = await handler(
        buildRequest(
          '/typed/nullable-arrays?values=1&enabled=false&enabled=true&mixed=1&mixed=2'
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { enabled: [false, true], mixed: ['1', '2'], values: [1, 2] },
      });
      expect(malformed.status).toBe(400);
      expect(singleton.status).toBe(400);
    });

    test('preserves absent optional fields and schema defaults', async () => {
      const handler = createFetchHandler(
        topo('fetch-api', { typedQueryDefaultsTrail })
      );

      const response = await handler(buildRequest('/typed/defaults'));
      const provided = await handler(
        buildRequest('/typed/defaults?count=0&enabled=true')
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { enabled: false } });
      expect(provided.status).toBe(200);
      expect(await provided.json()).toEqual({
        data: { count: 0, enabled: true },
      });
    });

    test('converts integer metadata and preserves number constraints', async () => {
      const schema = z.object({ count: z.number().int().nonnegative() });
      const integerTrail = trail('typed.integer', {
        implementation: (input) => Result.ok(input),
        input: schema,
        intent: 'read',
        output: schema,
      });
      const routes = deriveHttpRoutes(topo('fetch-api', { integerTrail }));
      expect(routes.isOk()).toBe(true);
      if (!routes.isOk()) {
        return;
      }
      const [route] = routes.value;
      expect(route).toBeDefined();
      if (route === undefined) {
        return;
      }
      const handler = createRouteHandler({
        ...route,
        inputSchema: {
          properties: { count: { type: 'integer' } },
          required: ['count'],
          type: 'object',
        },
      });

      const valid = await handler(buildRequest('/typed/integer?count=0'));
      const fractional = await handler(
        buildRequest('/typed/integer?count=1.5')
      );
      const negative = await handler(buildRequest('/typed/integer?count=-1'));

      expect(valid.status).toBe(200);
      expect(await valid.json()).toEqual({ data: { count: 0 } });
      expect(fractional.status).toBe(400);
      expect(negative.status).toBe(400);
    });

    test('converts repeated primitive arrays element by element', async () => {
      const handler = createFetchHandler(
        topo('fetch-api', { typedQueryArraysTrail })
      );

      const response = await handler(
        buildRequest(
          '/typed/arrays?counts=0&counts=2&enabled=false&enabled=true&labels=0&labels=true'
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: {
          counts: [0, 2],
          enabled: [false, true],
          labels: ['0', 'true'],
        },
      });
    });

    test('keeps the singleton array contract and rejects malformed array elements', async () => {
      const handler = createFetchHandler(
        topo('fetch-api', { typedQueryArraysTrail })
      );

      const singleton = await handler(
        buildRequest('/typed/arrays?counts=1&enabled=true&labels=one')
      );
      const malformed = await handler(
        buildRequest(
          '/typed/arrays?counts=1&counts=two&enabled=true&enabled=false&labels=one&labels=two'
        )
      );

      expect(singleton.status).toBe(400);
      expect(malformed.status).toBe(400);
    });

    test('does not apply the current schema to explicit historical versions', async () => {
      const output = z.object({ count: z.number() });
      const versionedTrail = trail('typed.versioned', {
        implementation: (input: { count: number }) => Result.ok(input),
        input: z.object({ count: z.number() }),
        intent: 'read',
        output,
        version: 2,
        versions: {
          1: {
            input: z.object({ count: z.string() }),
            output,
            transpose: {
              input: ({ input }: { input: { count: string } }) => ({
                count: Number(input.count),
              }),
              output: ({ output: result }) => result,
            },
          },
        },
      });
      const handler = createFetchHandler(topo('fetch-api', { versionedTrail }));

      const current = await handler(buildRequest('/typed/versioned?count=2'));
      const explicitCurrent = await handler(
        buildRequest('/typed/versioned?count=2&trailVersion=2')
      );
      const historical = await handler(
        buildRequest('/typed/versioned?count=2&trailVersion=1')
      );
      const headerPrecedence = await handler(
        buildRequest('/typed/versioned?count=abc&trailVersion=1', {
          headers: { 'X-Trails-Version': '2' },
        })
      );

      expect(current.status).toBe(200);
      expect(explicitCurrent.status).toBe(200);
      expect(historical.status).toBe(200);
      expect(await historical.json()).toEqual({ data: { count: 2 } });
      expect(headerPrecedence.status).toBe(400);
    });

    test('uses a selected historical number schema when it is unambiguous', async () => {
      const output = z.object({ count: z.string() });
      const versionedTrail = trail('typed.historical-number', {
        implementation: (input: { count: string }) => Result.ok(input),
        input: z.object({ count: z.string() }),
        intent: 'read',
        output,
        version: 2,
        versions: {
          1: {
            input: z.object({ count: z.number() }),
            output,
            transpose: {
              input: ({ input }: { input: { count: number } }) => ({
                count: String(input.count),
              }),
              output: ({ output: result }) => result,
            },
          },
        },
      });
      const handler = createFetchHandler(topo('fetch-api', { versionedTrail }));

      const historical = await handler(
        buildRequest('/typed/historical-number?count=0&trailVersion=1')
      );

      expect(historical.status).toBe(200);
      expect(await historical.json()).toEqual({ data: { count: '0' } });
    });

    test('declines historical conversion when current layer names collide', () => {
      const versionedTrail = trail('typed.historical-collision', {
        implementation: (input: { current: number }) => Result.ok(input),
        input: z.object({ current: z.number() }),
        intent: 'read',
        output: z.object({ current: z.number() }),
        version: 2,
        versions: {
          1: {
            implementation: (input: { enabled: string }) => Result.ok(input),
            input: z.object({ enabled: z.string() }),
            output: z.object({ enabled: z.string() }),
          },
        },
      });
      const routes = deriveHttpRoutes(topo('fetch-api', { versionedTrail }));
      expect(routes.isOk()).toBe(true);
      if (!routes.isOk()) {
        return;
      }
      const [route] = routes.value;
      expect(route).toBeDefined();
      if (route === undefined) {
        return;
      }

      const selectedSchema = resolveHttpQueryInputSchema(
        {
          ...route,
          layerInputRenderings: [
            {
              layerName: 'policy',
              properties: { enabled: { type: 'boolean' } },
              required: ['enabled'],
              routing: new Map([['enabled', 'enabled']]),
            },
          ],
        },
        { enabled: 'false', trailVersion: '1' }
      );

      expect(selectedSchema).toBeUndefined();
    });
  });

  test('does not coerce typed JSON body fields', async () => {
    const schema = z.object({ count: z.number(), enabled: z.boolean() });
    const typedBodyTrail = trail('typed.body', {
      implementation: (input) => Result.ok(input),
      input: schema,
      intent: 'write',
      output: schema,
    });
    const handler = createFetchHandler(topo('fetch-api', { typedBodyTrail }));

    const typed = await handler(
      buildRequest('/typed/body', {
        body: JSON.stringify({ count: 0, enabled: false }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    const strings = await handler(
      buildRequest('/typed/body', {
        body: JSON.stringify({ count: '0', enabled: 'false' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(typed.status).toBe(200);
    expect(await typed.json()).toEqual({
      data: { count: 0, enabled: false },
    });
    expect(strings.status).toBe(400);
  });

  test('reads JSON bodies and rejects invalid body metadata', async () => {
    const handler = createFetchHandler(topo('fetch-api', { echoBodyTrail }));

    const ok = await handler(
      buildRequest('/echo/body', {
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );
    const invalidLength = await handler(
      buildRequest('/echo/body', {
        headers: { 'Content-Length': 'abc' },
        method: 'POST',
      })
    );
    const invalidJson = await handler(
      buildRequest('/echo/body', {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { length: 5 } });
    expect(invalidLength.status).toBe(400);
    expect(await invalidLength.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid Content-Length header',
      },
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid JSON in request body',
      },
    });
  });

  test('applies the configured JSON body cap', async () => {
    const handler = createFetchHandler(topo('fetch-api', { echoBodyTrail }), {
      maxJsonBodyBytes: 20,
    });

    const response = await handler(
      buildRequest('/echo/body', {
        body: JSON.stringify({ message: 'too large' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'JSON request body exceeds 20 bytes',
      },
    });
  });

  test('maps aborted body reads to cancelled responses', async () => {
    const handler = createFetchHandler(topo('fetch-api', { echoBodyTrail }));
    const controller = new AbortController();
    const request = buildRequest('/echo/body', {
      body: JSON.stringify({ message: 'cancel me' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    controller.abort();

    const response = await handler(request);

    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({
      error: {
        category: 'cancelled',
        code: 'CancelledError',
        message: 'Request aborted',
      },
    });
  });

  test('maps mid-read body aborts to cancelled responses', async () => {
    const handler = createFetchHandler(topo('fetch-api', { echoBodyTrail }));
    const controller = new AbortController();
    const requestInit: RequestInit & { duplex: 'half' } = {
      body: new ReadableStream<Uint8Array>({
        pull: (streamController) => {
          controller.abort();
          streamController.error(new Error('socket closed'));
        },
      }),
      duplex: 'half',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    };

    const response = await handler(buildRequest('/echo/body', requestInit));

    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({
      error: {
        category: 'cancelled',
        code: 'CancelledError',
        message: 'Request aborted',
      },
    });
    expect(loggedErrors).toHaveLength(0);
  });

  test('redacts generic 500 responses and keeps sanitized diagnostics', async () => {
    const handler = createFetchHandler(
      topo('fetch-api', { genericErrorTrail })
    );

    const response = await handler(
      buildRequest('/generic/error', {
        headers: { 'X-Request-ID': 'req-123 forged/line' },
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    });
    expect(loggedErrors).toHaveLength(1);
    expect(loggedErrors[0]?.[0]).toBe(
      '[ontrails:http/fetch] Internal error (req-123_forged_line)'
    );
    expect(JSON.stringify(loggedErrors[0]?.[1])).not.toContain('secret');
  });

  test('forwards headers, bearer permits, request id, and abort signal', async () => {
    let observedHeader: string | null | undefined;
    let observedSignalAborted: boolean | undefined;
    const abortingTrail = trail('abort.check', {
      implementation: (_input, ctx) => {
        observedSignalAborted = ctx.abortSignal.aborted;
        return Result.ok({ aborted: ctx.abortSignal.aborted });
      },
      input: z.object({}),
      intent: 'read',
      output: z.object({ aborted: z.boolean() }),
    });
    const graph = topo('fetch-api', { abortingTrail, protectedTrail });
    const handler = createFetchHandler(graph, {
      resolvePermit: ({ headers }) => {
        observedHeader =
          headers instanceof Headers ? headers.get('x-tenant-id') : undefined;
        return Result.ok({ id: 'user-1', scopes: ['thing:read'] });
      },
    });
    const controller = new AbortController();
    controller.abort();

    const permitResponse = await handler(
      buildRequest('/permit/scope', {
        headers: {
          Authorization: 'Bearer strong',
          'X-Request-ID': 'req-1',
          'X-Tenant-ID': 'tenant-1',
        },
      })
    );
    const abortResponse = await handler(
      buildRequest('/abort/check', { signal: controller.signal })
    );

    expect(permitResponse.status).toBe(200);
    expect(await permitResponse.json()).toEqual({
      data: { permitId: 'user-1', requestId: 'req-1' },
    });
    expect(observedHeader).toBe('tenant-1');
    expect(abortResponse.status).toBe(200);
    expect(await abortResponse.json()).toEqual({
      data: { aborted: true },
    });
    expect(observedSignalAborted).toBe(true);
  });

  test('handles webhook verify, parse, and invalid recording behavior', async () => {
    let invalidWebhookCount = 0;
    const routes = deriveHttpRoutes(topo('fetch-api', { paymentWebhookTrail }));
    expect(routes.isOk()).toBe(true);
    if (!routes.isOk()) {
      return;
    }
    const route = routes.value.find(
      (candidate) => candidate.inputSource === 'webhook'
    );
    expect(route).toBeDefined();
    if (route === undefined) {
      return;
    }
    const handler = createRouteHandler({
      ...route,
      recordWebhookInvalid: async () => {
        invalidWebhookCount += 1;
      },
    });

    const verified = await handler(
      buildRequest('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      })
    );
    const denied = await handler(
      buildRequest('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': 'wrong',
        },
        method: 'POST',
      })
    );
    const invalidPayload = await handler(
      buildRequest('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 123 }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      })
    );

    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({
      data: { paymentId: 'pay_1' },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { category: 'permission' },
    });
    expect(invalidPayload.status).toBe(400);
    expect(await invalidPayload.json()).toMatchObject({
      error: { category: 'validation' },
    });
    expect(invalidWebhookCount).toBe(2);
  });

  test('treats missing webhook parsers as internal invariant failures', async () => {
    const invalidWebhookCategories: string[] = [];
    const routes = deriveHttpRoutes(topo('fetch-api', { paymentWebhookTrail }));
    expect(routes.isOk()).toBe(true);
    if (!routes.isOk()) {
      return;
    }
    const route = routes.value.find(
      (candidate) => candidate.inputSource === 'webhook'
    );
    expect(route).toBeDefined();
    if (route === undefined) {
      return;
    }
    const { parseWebhookInput: _parseWebhookInput, ...routeWithoutParser } =
      route;
    const handler = createRouteHandler({
      ...routeWithoutParser,
      recordWebhookInvalid: async (category) => {
        invalidWebhookCategories.push(category ?? 'validation');
      },
    });

    const response = await handler(
      buildRequest('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    });
    expect(invalidWebhookCategories).toEqual(['internal']);
    expect(loggedErrors).toHaveLength(1);
  });
});

describe('BlobRef byte serving (TRL-1192)', () => {
  const fileBytes = new TextEncoder().encode('raw file bytes');

  const fileRawTrail = trail('file.raw', {
    implementation: (input) =>
      input.name === 'missing.txt'
        ? Result.err(new NotFoundError('No such file'))
        : Result.ok(
            createBlobRef({
              data: fileBytes,
              mimeType: 'text/plain; charset=utf-8',
              name: input.name,
              size: fileBytes.byteLength,
            })
          ),
    input: z.object({ name: z.string() }),
    intent: 'read',
    output: blobRefSchema,
  });

  test('streams Uint8Array blob bytes with mimeType and Content-Length', async () => {
    const handler = createFetchHandler(topo('blob-api', { fileRawTrail }));

    const response = await handler(buildRequest('/file/raw?name=notes.txt'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('Content-Length')).toBe(
      String(fileBytes.byteLength)
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fileBytes);
  });

  test('streams ReadableStream blob data', async () => {
    const streamTrail = trail('file.stream', {
      implementation: () =>
        Result.ok(
          createBlobRef({
            data: new Response(fileBytes).body ?? new ReadableStream(),
            mimeType: 'application/octet-stream',
            name: 'stream.bin',
            size: fileBytes.byteLength,
          })
        ),
      input: z.object({}),
      intent: 'read',
      output: blobRefSchema,
    });
    const handler = createFetchHandler(topo('blob-api', { streamTrail }));

    const response = await handler(buildRequest('/file/stream'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/octet-stream'
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fileBytes);
  });

  test('error results from blob trails stay JSON error envelopes', async () => {
    const handler = createFetchHandler(topo('blob-api', { fileRawTrail }));

    const response = await handler(buildRequest('/file/raw?name=missing.txt'));

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: {
        category: 'not_found',
        code: 'NotFoundError',
        message: 'No such file',
      },
    });
  });

  test('non-blob trails keep the JSON data envelope', async () => {
    const handler = createFetchHandler(topo('blob-api', { echoTrail }));

    const response = await handler(buildRequest('/echo?message=json'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'json' } });
  });
});

describe('webhook ingress v2 (TRL-1194)', () => {
  const ingressWebhook = webhook('relay.ingress', {
    headers: ['content-type', 'x-junction-signature'],
    parse: z.object({
      endpoint: z.string(),
      headers: z.record(z.string(), z.string()),
      rawBody: z.string(),
    }),
    path: '/hooks/:endpoint',
    rawBody: true,
  });

  const receiveTrail = trail('ingress.receive', {
    implementation: (input) =>
      Result.ok({
        endpoint: input.endpoint,
        headerNames: Object.keys(input.headers).toSorted(),
        rawBody: input.rawBody,
      }),
    input: z.object({
      endpoint: z.string(),
      headers: z.record(z.string(), z.string()),
      rawBody: z.string(),
    }),
    on: [ingressWebhook],
    output: z.object({
      endpoint: z.string(),
      headerNames: z.array(z.string()),
      rawBody: z.string(),
    }),
  });

  test('delivers path params, raw body, and allowlisted headers to the trail', async () => {
    const handler = createFetchHandler(topo('ingress-api', { receiveTrail }));

    const response = await handler(
      buildRequest('/hooks/github', {
        body: '{"payload":true}',
        headers: {
          'Content-Type': 'application/json',
          'X-Junction-Signature': 'sig-1',
          'X-Secret-Internal': 'never-delivered',
        },
        method: 'POST',
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: {
        endpoint: 'github',
        headerNames: ['content-type', 'x-junction-signature'],
        rawBody: '{"payload":true}',
      },
    });
  });

  test('rawBody webhooks accept non-JSON bodies — the trail owns interpretation', async () => {
    const handler = createFetchHandler(topo('ingress-api', { receiveTrail }));

    const response = await handler(
      buildRequest('/hooks/stripe', {
        body: 'not json at all',
        headers: { 'Content-Type': 'text/plain' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: {
        endpoint: 'stripe',
        headerNames: ['content-type'],
        rawBody: 'not json at all',
      },
    });
  });

  test('unmatched dynamic paths fall through to not-found', async () => {
    const handler = createFetchHandler(topo('ingress-api', { receiveTrail }));

    const response = await handler(
      buildRequest('/hooks/github/extra', { method: 'POST' })
    );

    expect(response.status).toBe(404);
  });

  test('classic static webhooks keep their exact-match behavior and 200 status', async () => {
    const handler = createFetchHandler(
      topo('ingress-api', { paymentWebhookTrail })
    );

    const response = await handler(
      buildRequest('/webhooks/payment', {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { paymentId: 'pay_1' },
    });
  });

  test('verify reaches declared resources through its context', async () => {
    const secrets = resource('ingress.secrets', {
      create: () => Result.ok({ github: 'store-held-secret' }),
    });
    const verifiedWebhook = webhook('relay.verified', {
      parse: z.object({ endpoint: z.string(), rawBody: z.string() }),
      path: '/verified/:endpoint',
      rawBody: true,
      resources: [secrets],
      verify: (request, ctx) => {
        if (ctx === undefined) {
          return Result.err(new PermissionError('No verify context'));
        }
        const expected = (secrets.from(ctx) as Record<string, string>)[
          'github'
        ];
        return getWebhookHeader(request, 'x-signature') === expected
          ? Result.ok()
          : Result.err(new PermissionError('Invalid signature'));
      },
    });
    const verifiedTrail = trail('verified.receive', {
      implementation: (input) => Result.ok({ endpoint: input.endpoint }),
      input: z.object({ endpoint: z.string(), rawBody: z.string() }),
      on: [verifiedWebhook],
      output: z.object({ endpoint: z.string() }),
    });
    const handler = createFetchHandler(topo('ingress-api', { verifiedTrail }));

    const accepted = await handler(
      buildRequest('/verified/github', {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': 'store-held-secret',
        },
        method: 'POST',
      })
    );
    expect(accepted.status).toBe(202);

    const rejected = await handler(
      buildRequest('/verified/github', {
        body: '{}',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': 'wrong',
        },
        method: 'POST',
      })
    );
    expect(rejected.status).toBe(403);
  });
});
