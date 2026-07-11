import { describe, expect, test } from 'bun:test';

import {
  PermissionError,
  Result,
  getWebhookHeader,
  trail,
  topo,
  webhook,
} from '@ontrails/core';
import type { Topo } from '@ontrails/core';
import { z } from 'zod';

import type {
  DeriveHttpRoutesOptions,
  HttpHeaderSource,
  ResolveHttpPermit,
} from './build.js';
import type { CreateRouteHandlerOptions } from './fetch.js';

export interface HttpAdapterConformanceApp {
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

export interface HttpAdapterConformanceOptions
  extends DeriveHttpRoutesOptions, CreateRouteHandlerOptions {
  readonly resolvePermit?: ResolveHttpPermit | undefined;
}

export interface HttpAdapterConformanceAdapter {
  readonly createApp: (
    graph: Topo,
    options?: HttpAdapterConformanceOptions
  ) => HttpAdapterConformanceApp | Promise<HttpAdapterConformanceApp>;
  readonly name: string;
}

export interface HttpAdapterConformanceCase {
  readonly check: (adapter: HttpAdapterConformanceAdapter) => Promise<void>;
  readonly name: string;
}

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

const genericRedactionError = (): Error =>
  new Error('database password=secret');

const genericErrorTrail = trail('generic.error', {
  implementation: () => Result.err(genericRedactionError()),
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

const abortingTrail = trail('abort.check', {
  implementation: (_input, ctx) =>
    Result.ok({ aborted: ctx.abortSignal.aborted }),
  input: z.object({}),
  intent: 'read',
  output: z.object({ aborted: z.boolean() }),
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

const readHeader = (
  headers: HttpHeaderSource | undefined,
  name: string
): string | undefined => {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle || value === undefined) {
      continue;
    }
    return typeof value === 'string' ? value : value[0];
  }
  return undefined;
};

const expectJson = async (
  response: Response
): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

const materialize = async (
  adapter: HttpAdapterConformanceAdapter,
  graph: Topo,
  options?: HttpAdapterConformanceOptions
): Promise<HttpAdapterConformanceApp> =>
  await adapter.createApp(graph, options);

const expectOkResponse = async (
  response: Response,
  data: Record<string, unknown>
): Promise<void> => {
  expect(response.status).toBe(200);
  expect(await expectJson(response)).toEqual({ data });
};

const request = async (
  adapter: HttpAdapterConformanceAdapter,
  graph: Topo,
  path: string,
  init?: RequestInit,
  options?: HttpAdapterConformanceOptions
): Promise<Response> => {
  const app = await materialize(adapter, graph, options);
  return await app.fetch(buildRequest(path, init));
};

const readRouteCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  const response = await request(
    adapter,
    topo('http-conformance-read', { echoTrail }),
    '/echo?message=hello'
  );

  await expectOkResponse(response, { reply: 'hello' });
};

const writeRouteCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  const response = await request(
    adapter,
    topo('http-conformance-write', { echoBodyTrail }),
    '/echo/body',
    {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }
  );

  await expectOkResponse(response, { length: 5 });
};

const repeatedQueryCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  const graph = topo('http-conformance-query', { tagsTrail });
  const repeated = await request(adapter, graph, '/tags?tags=red&tags=blue');
  const singleton = await request(adapter, graph, '/tags?tags=solo');

  await expectOkResponse(repeated, { tags: ['red', 'blue'] });
  expect(singleton.status).toBe(400);
  expect(await expectJson(singleton)).toMatchObject({
    error: { category: 'validation' },
  });
};

const publicErrorCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  const response = await request(
    adapter,
    topo('http-conformance-errors', { genericErrorTrail }),
    '/generic/error',
    { headers: { 'X-Request-ID': 'req-123 forged/line' } }
  );
  const body = await expectJson(response);

  expect(response.status).toBe(500);
  expect(body).toEqual({
    error: {
      category: 'internal',
      code: 'InternalError',
      message: 'Internal server error',
    },
  });
  expect(JSON.stringify(body)).not.toContain('secret');
};

const requestContextCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  let observedTenant: string | null | undefined;
  const resolvePermit: ResolveHttpPermit = ({ headers }) => {
    observedTenant = readHeader(headers, 'x-tenant-id');
    return Result.ok({ id: 'user-1', scopes: ['thing:read'] });
  };
  const graph = topo('http-conformance-context', {
    abortingTrail,
    protectedTrail,
  });
  const app = await materialize(adapter, graph, { resolvePermit });
  const controller = new AbortController();
  controller.abort();

  const permitResponse = await app.fetch(
    buildRequest('/permit/scope', {
      headers: {
        Authorization: 'Bearer strong',
        'X-Request-ID': 'req-1',
        'X-Tenant-ID': 'tenant-1',
      },
    })
  );
  const abortResponse = await app.fetch(
    buildRequest('/abort/check', { signal: controller.signal })
  );

  await expectOkResponse(permitResponse, {
    permitId: 'user-1',
    requestId: 'req-1',
  });
  expect(observedTenant).toBe('tenant-1');
  await expectOkResponse(abortResponse, { aborted: true });
};

const webhookCase = async (
  adapter: HttpAdapterConformanceAdapter
): Promise<void> => {
  const graph = topo('http-conformance-webhooks', { paymentWebhookTrail });
  const verified = await request(adapter, graph, '/webhooks/payment', {
    body: JSON.stringify({ paymentId: 'pay_1' }),
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': webhookSecret,
    },
    method: 'POST',
  });
  const denied = await request(adapter, graph, '/webhooks/payment', {
    body: JSON.stringify({ paymentId: 'pay_1' }),
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': 'wrong',
    },
    method: 'POST',
  });
  const invalidPayload = await request(adapter, graph, '/webhooks/payment', {
    body: JSON.stringify({ paymentId: 123 }),
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Secret': webhookSecret,
    },
    method: 'POST',
  });

  await expectOkResponse(verified, { paymentId: 'pay_1' });
  expect(denied.status).toBe(403);
  expect(await expectJson(denied)).toMatchObject({
    error: { category: 'permission' },
  });
  expect(invalidPayload.status).toBe(400);
  expect(await expectJson(invalidPayload)).toMatchObject({
    error: { category: 'validation' },
  });
};

export const createHttpAdapterConformanceCases =
  (): readonly HttpAdapterConformanceCase[] => [
    { check: readRouteCase, name: 'serves read trails from query parameters' },
    { check: writeRouteCase, name: 'serves write trails from JSON bodies' },
    {
      check: repeatedQueryCase,
      name: 'preserves repeated query keys before validation',
    },
    {
      check: publicErrorCase,
      name: 'projects generic errors as redacted public 500 responses',
    },
    {
      check: requestContextCase,
      name: 'threads request context and abort signals',
    },
    { check: webhookCase, name: 'handles webhook verification and parsing' },
  ];

export const runConformance = (
  adapter: HttpAdapterConformanceAdapter,
  cases: readonly HttpAdapterConformanceCase[] = createHttpAdapterConformanceCases()
): void => {
  describe(`${adapter.name} HTTP adapter conformance`, () => {
    for (const conformanceCase of cases) {
      test(conformanceCase.name, async () => {
        await conformanceCase.check(adapter);
      });
    }
  });
};
