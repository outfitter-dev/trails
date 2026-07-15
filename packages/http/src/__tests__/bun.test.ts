import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  PermissionError,
  Result,
  clearTraceSink,
  getWebhookHeader,
  registerTraceSink,
  trail,
  topo,
  webhook,
} from '@ontrails/core';
import type { TraceRecord, TraceSink } from '@ontrails/core';
import { z } from 'zod';

import { createApp, surface } from '../bun.js';

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
  clearTraceSink();
});

const echoTrail = trail('echo', {
  implementation: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const echoBodyTrail = trail('echo.body', {
  implementation: (input) => Result.ok({ length: input.message.length }),
  input: z.object({ message: z.string() }),
  intent: 'write',
  output: z.object({ length: z.number() }),
});

const tagsTrail = trail('tags', {
  implementation: (input) => Result.ok({ tags: input.tags }),
  input: z.object({ tags: z.array(z.string()) }),
  intent: 'read',
  output: z.object({ tags: z.array(z.string()) }),
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

const createCapturingSink = (records: TraceRecord[]): TraceSink => ({
  write(record) {
    records.push(record);
  },
});

describe('@ontrails/http/bun', () => {
  test('materializes Bun native routes for derived HTTP trails', async () => {
    const app = createApp(topo('bun-api', { echoTrail }));
    const handler = app.routes['/echo']?.GET;

    expect(handler).toBeDefined();
    if (handler === undefined) {
      return;
    }

    const response = await handler(buildRequest('/echo?message=hello'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'hello' } });
  });

  test('uses the shared fetch kernel as fallback for unmatched requests', async () => {
    const app = createApp(topo('bun-api', { echoTrail }));

    const response = await app.fetch(buildRequest('/missing'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        category: 'not_found',
        code: 'NotFoundError',
        message: 'HTTP route not found: /missing',
      },
    });
  });

  test('returns method not allowed when fallback sees a registered path', async () => {
    const app = createApp(topo('bun-api', { echoTrail }));

    const response = await app.fetch(buildRequest('/echo', { method: 'POST' }));

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(await response.json()).toEqual({
      error: {
        category: 'validation',
        code: 'MethodNotAllowed',
        message: 'HTTP method not allowed: POST /echo',
      },
    });
  });

  test('serves GET trails through bodyless HEAD handlers', async () => {
    const app = createApp(topo('bun-api', { echoTrail }));
    const handler = app.routes['/echo']?.HEAD;

    expect(handler).toBeDefined();
    if (handler === undefined) {
      return;
    }

    const response = await handler(
      buildRequest('/echo?message=hello', {
        method: 'HEAD',
      })
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  test('keeps fallback HEAD responses bodyless', async () => {
    const app = createApp(topo('bun-api', { echoBodyTrail }));

    const missing = await app.fetch(
      buildRequest('/missing', { method: 'HEAD' })
    );
    const methodMismatch = await app.fetch(
      buildRequest('/echo/body', { method: 'HEAD' })
    );

    expect(missing.status).toBe(404);
    expect(missing.body).toBeNull();
    expect(await missing.text()).toBe('');
    expect(methodMismatch.status).toBe(405);
    expect(methodMismatch.headers.get('Allow')).toBe('POST');
    expect(methodMismatch.body).toBeNull();
    expect(await methodMismatch.text()).toBe('');
  });

  test('preserves query, body, and validation behavior through native routes', async () => {
    const app = createApp(topo('bun-api', { echoBodyTrail, tagsTrail }), {
      maxJsonBodyBytes: 20,
    });
    const tagsHandler = app.routes['/tags']?.GET;
    const bodyHandler = app.routes['/echo/body']?.POST;

    expect(tagsHandler).toBeDefined();
    expect(bodyHandler).toBeDefined();
    if (tagsHandler === undefined || bodyHandler === undefined) {
      return;
    }

    const repeated = await tagsHandler(
      buildRequest('/tags?tags=red&tags=blue')
    );
    const singleton = await tagsHandler(buildRequest('/tags?tags=solo'));
    const oversized = await bodyHandler(
      buildRequest('/echo/body', {
        body: JSON.stringify({ message: 'too large' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({
      data: { tags: ['red', 'blue'] },
    });
    expect(singleton.status).toBe(400);
    expect(await singleton.json()).toMatchObject({
      error: { category: 'validation' },
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'JSON request body exceeds 20 bytes',
      },
    });
  });

  test('forwards permit headers, request id, and abort signals through native routes', async () => {
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
    const app = createApp(topo('bun-api', { abortingTrail, protectedTrail }), {
      resolvePermit: ({ headers }) => {
        observedHeader =
          headers instanceof Headers ? headers.get('x-tenant-id') : undefined;
        return Result.ok({ id: 'user-1', scopes: ['thing:read'] });
      },
    });
    const permitHandler = app.routes['/permit/scope']?.GET;
    const abortHandler = app.routes['/abort/check']?.GET;
    const controller = new AbortController();
    controller.abort();

    expect(permitHandler).toBeDefined();
    expect(abortHandler).toBeDefined();
    if (permitHandler === undefined || abortHandler === undefined) {
      return;
    }

    const permitResponse = await permitHandler(
      buildRequest('/permit/scope', {
        headers: {
          Authorization: 'Bearer strong',
          'X-Request-ID': 'req-1',
          'X-Tenant-ID': 'tenant-1',
        },
      })
    );
    const abortResponse = await abortHandler(
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

  test('handles webhook verify, parse, and invalid recording behavior through native routes', async () => {
    const records: TraceRecord[] = [];
    const app = createApp(topo('bun-api', { paymentWebhookTrail }));
    const handler = app.routes['/webhooks/payment']?.POST;

    expect(handler).toBeDefined();
    if (handler === undefined) {
      return;
    }

    registerTraceSink(createCapturingSink(records));

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
    expect(
      records.filter(
        (record) =>
          record.kind === 'activation' &&
          record.name === 'activation.webhook.invalid'
      )
    ).toHaveLength(2);
  });

  test('maps Bun onError failures through the shared error rendering', async () => {
    const app = createApp(topo('bun-api', { genericErrorTrail }));

    const response = await app.onError(new Error('database password=secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    });
    expect(loggedErrors).toHaveLength(1);
    expect(JSON.stringify(loggedErrors[0])).not.toContain('secret');
  });

  test('surface starts Bun.serve with native routes and a close handle', async () => {
    const handle = await surface(topo('bun-api', { echoTrail }), { port: 0 });

    try {
      const response = await fetch(new URL('/echo?message=served', handle.url));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { reply: 'served' },
      });
    } finally {
      await handle.close();
    }
  });
});
