import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
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
import { z } from 'zod';

import { deriveHttpRoutes } from '../build.js';
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
