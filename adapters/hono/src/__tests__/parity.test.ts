import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  AuthError,
  ConflictError,
  InternalError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  Result,
  ValidationError,
  clearTraceSink,
  getWebhookHeader,
  registerTraceSink,
  trail,
  topo,
  webhook,
} from '@ontrails/core';
import type { TraceRecord, TraceSink } from '@ontrails/core';
import type { HttpMethod } from '@ontrails/http';
import { createApp as createBunApp } from '@ontrails/http/bun';
import type { CreateAppOptions as BunCreateAppOptions } from '@ontrails/http/bun';
import { z } from 'zod';

import { createApp as createHonoApp } from '../surface.js';
import type { CreateAppOptions as HonoCreateAppOptions } from '../surface.js';

/**
 * Hono and Bun parity lives here rather than in `@ontrails/http` so the shared
 * kernel never grows a dev-only dependency back on the Hono adapter.
 */

type SurfaceName = 'bun' | 'hono';
type SharedCreateAppOptions = BunCreateAppOptions & HonoCreateAppOptions;
type JsonBody = unknown;

interface RequestSpec {
  readonly afterStart?: (() => void) | undefined;
  readonly init?: RequestInit | undefined;
  readonly path: string;
}

interface SurfaceResult {
  readonly body: JsonBody;
  readonly contentType: string | null;
  readonly loggedErrorCount: number;
  readonly response: Response;
  readonly surface: SurfaceName;
}

interface ParityScenario {
  readonly assert?: ((results: readonly SurfaceResult[]) => void) | undefined;
  readonly expectedBody?: JsonBody | undefined;
  readonly expectedBodyMatch?: JsonBody | undefined;
  readonly expectedStatus: number;
  readonly name: string;
  readonly options?: (() => SharedCreateAppOptions) | undefined;
  readonly request: () => RequestSpec;
}

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
  blaze: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const tagsTrail = trail('tags', {
  blaze: (input) => Result.ok({ tags: input.tags }),
  input: z.object({ tags: z.array(z.string()) }),
  intent: 'read',
  output: z.object({ tags: z.array(z.string()) }),
});

const echoBodyTrail = trail('echo.body', {
  blaze: (input) => Result.ok({ length: input.message.length }),
  input: z.object({ message: z.string() }),
  intent: 'write',
  output: z.object({ length: z.number() }),
});

const emptyBodyTrail = trail('empty.body', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'write',
  output: z.object({ ok: z.boolean() }),
});

const genericErrorTrail = trail('generic.error', {
  blaze: () => Result.err(new Error('database password=secret')),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const protectedTrail = trail('permit.scope', {
  blaze: (_input, ctx) =>
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

const abortTrail = trail('abort.delay', {
  blaze: async (_input, ctx) => {
    await Bun.sleep(5);
    return Result.ok({ aborted: ctx.abortSignal.aborted });
  },
  input: z.object({}),
  intent: 'read',
  output: z.object({ aborted: z.boolean() }),
});

const errorTrail = (id: string, error: Error) =>
  trail(id, {
    blaze: () => Result.err(error),
    input: z.object({}),
    intent: 'read',
    output: z.object({ ok: z.boolean() }),
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
  blaze: (input) => Result.ok({ paymentId: input.paymentId }),
  input: z.object({ paymentId: z.string() }),
  on: [paymentWebhook],
  output: z.object({ paymentId: z.string() }),
});

const parityGraph = topo('http-parity', {
  abortTrail,
  authErrorTrail: errorTrail(
    'errors.auth',
    new AuthError('Unauthorized request')
  ),
  conflictErrorTrail: errorTrail(
    'errors.conflict',
    new ConflictError('Already changed')
  ),
  echoBodyTrail,
  echoTrail,
  emptyBodyTrail,
  genericErrorTrail,
  internalErrorTrail: errorTrail(
    'errors.internal',
    new InternalError('database password=secret')
  ),
  notFoundErrorTrail: errorTrail(
    'errors.not_found',
    new NotFoundError('Missing thing')
  ),
  paymentWebhookTrail,
  permissionErrorTrail: errorTrail(
    'errors.permission',
    new PermissionError('Forbidden request')
  ),
  protectedTrail,
  rateLimitErrorTrail: errorTrail(
    'errors.rate_limit',
    new RateLimitError('Too many requests')
  ),
  tagsTrail,
  validationErrorTrail: errorTrail(
    'errors.validation',
    new ValidationError('Bad input')
  ),
});

const buildUrl = (path: string): string =>
  new URL(path, 'http://localhost').toString();

const readBody = async (response: Response): Promise<JsonBody> => {
  const contentType = response.headers.get('Content-Type');
  return contentType?.includes('application/json') === true
    ? await response.json()
    : await response.text();
};

const createCapturingSink = (records: TraceRecord[]): TraceSink => ({
  write(record) {
    records.push(record);
  },
});

let webhookRecords: TraceRecord[] = [];

const invokeHono = async (
  request: RequestSpec,
  options: SharedCreateAppOptions
): Promise<Response> => {
  const app = createHonoApp(parityGraph, options);
  const response = app.request(request.path, request.init);
  request.afterStart?.();
  return await response;
};

const invokeBun = async (
  request: RequestSpec,
  options: SharedCreateAppOptions
): Promise<Response> => {
  const app = createBunApp(parityGraph, options);
  const method = request.init?.method ?? 'GET';
  const url = new URL(request.path, 'http://localhost');
  const handler =
    app.routes[url.pathname]?.[method.toUpperCase() as HttpMethod];
  const response =
    handler === undefined
      ? app.fetch(new Request(buildUrl(request.path), request.init))
      : handler(new Request(buildUrl(request.path), request.init));
  request.afterStart?.();
  return await response;
};

const invokeSurface = async (
  surface: SurfaceName,
  scenario: ParityScenario
): Promise<SurfaceResult> => {
  const options = scenario.options?.() ?? {};
  const request = scenario.request();
  const loggedErrorStart = loggedErrors.length;
  const response =
    surface === 'hono'
      ? await invokeHono(request, options)
      : await invokeBun(request, options);
  return {
    body: await readBody(response),
    contentType: response.headers.get('Content-Type'),
    loggedErrorCount: loggedErrors.length - loggedErrorStart,
    response,
    surface,
  };
};

const expectJsonResponse = (result: SurfaceResult): void => {
  expect(result.contentType).toContain('application/json');
};

const parityScenarios: readonly ParityScenario[] = [
  {
    expectedBody: { data: { reply: 'hello' } },
    expectedStatus: 200,
    name: 'GET query happy path',
    request: () => ({ path: '/echo?message=hello' }),
  },
  {
    expectedBody: { data: { tags: ['red', 'blue'] } },
    expectedStatus: 200,
    name: 'repeated query keys stay arrays',
    request: () => ({ path: '/tags?tags=red&tags=blue' }),
  },
  {
    expectedBodyMatch: { error: { category: 'validation' } },
    expectedStatus: 400,
    name: 'singleton query keys stay scalars',
    request: () => ({ path: '/tags?tags=solo' }),
  },
  {
    expectedBody: { data: { length: 5 } },
    expectedStatus: 200,
    name: 'POST JSON body happy path',
    request: () => ({
      init: {
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      path: '/echo/body',
    }),
  },
  {
    expectedBody: { data: { ok: true } },
    expectedStatus: 200,
    name: 'empty body without metadata is treated as empty object input',
    request: () => ({
      init: { method: 'POST' },
      path: '/empty/body',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'JSON request body exceeds 20 bytes',
      },
    },
    expectedStatus: 413,
    name: 'JSON body cap returns 413',
    options: () => ({ maxJsonBodyBytes: 20 }),
    request: () => ({
      init: {
        body: JSON.stringify({ message: 'too large' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      path: '/echo/body',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid Content-Length header',
      },
    },
    expectedStatus: 400,
    name: 'malformed Content-Length returns ValidationError',
    request: () => ({
      init: {
        headers: { 'Content-Length': 'abc' },
        method: 'POST',
      },
      path: '/echo/body',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid JSON in request body',
      },
    },
    expectedStatus: 400,
    name: 'malformed JSON returns ValidationError',
    request: () => ({
      init: {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
      path: '/echo/body',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Bad input',
      },
    },
    expectedStatus: 400,
    name: 'known TrailsError projection: validation',
    request: () => ({ path: '/errors/validation' }),
  },
  {
    expectedBody: {
      error: {
        category: 'not_found',
        code: 'NotFoundError',
        message: 'Missing thing',
      },
    },
    expectedStatus: 404,
    name: 'known TrailsError projection: not_found',
    request: () => ({ path: '/errors/not_found' }),
  },
  {
    expectedBody: {
      error: {
        category: 'conflict',
        code: 'ConflictError',
        message: 'Already changed',
      },
    },
    expectedStatus: 409,
    name: 'known TrailsError projection: conflict',
    request: () => ({ path: '/errors/conflict' }),
  },
  {
    expectedBody: {
      error: {
        category: 'auth',
        code: 'AuthError',
        message: 'Unauthorized request',
      },
    },
    expectedStatus: 401,
    name: 'known TrailsError projection: unauthorized',
    request: () => ({ path: '/errors/auth' }),
  },
  {
    expectedBody: {
      error: {
        category: 'permission',
        code: 'PermissionError',
        message: 'Forbidden request',
      },
    },
    expectedStatus: 403,
    name: 'known TrailsError projection: forbidden',
    request: () => ({ path: '/errors/permission' }),
  },
  {
    expectedBody: {
      error: {
        category: 'rate_limit',
        code: 'RateLimitError',
        message: 'Too many requests',
      },
    },
    expectedStatus: 429,
    name: 'known TrailsError projection: rate_limited',
    request: () => ({ path: '/errors/rate_limit' }),
  },
  {
    assert: (results) => {
      for (const result of results) {
        expect(JSON.stringify(result.body)).not.toContain('secret');
      }
    },
    expectedBody: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    },
    expectedStatus: 500,
    name: 'known TrailsError projection: internal is redacted',
    request: () => ({ path: '/errors/internal' }),
  },
  {
    assert: (results) => {
      for (const result of results) {
        expect(JSON.stringify(result.body)).not.toContain('secret');
        expect(result.loggedErrorCount).toBe(1);
      }
      expect(JSON.stringify(loggedErrors)).not.toContain('secret');
    },
    expectedBody: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    },
    expectedStatus: 500,
    name: 'generic Error 500 response and diagnostics are redacted',
    request: () => ({ path: '/generic/error' }),
  },
  {
    assert: (results) => {
      for (const result of results) {
        expect(result.body).toEqual({
          data: { permitId: 'user-1', requestId: 'req-1' },
        });
      }
    },
    expectedStatus: 200,
    name: 'resolvePermit forwards bearer token, headers, and request id',
    options: () => ({
      resolvePermit: ({ bearerToken, headers, requestId }) => {
        expect(bearerToken).toBe('strong');
        expect(headers).toBeInstanceOf(Headers);
        expect(
          headers instanceof Headers ? headers.get('x-tenant-id') : null
        ).toBe('tenant-1');
        expect(requestId).toBe('req-1');
        return Result.ok({ id: 'user-1', scopes: ['thing:read'] });
      },
    }),
    request: () => ({
      init: {
        headers: {
          Authorization: 'Bearer strong',
          'X-Request-ID': 'req-1',
          'X-Tenant-ID': 'tenant-1',
        },
      },
      path: '/permit/scope',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'auth',
        code: 'AuthError',
        message: 'Malformed Authorization header; expected Bearer token',
      },
    },
    expectedStatus: 401,
    name: 'malformed Bearer-equivalent protected request returns AuthError',
    request: () => ({
      init: { headers: { Authorization: 'Basic nope' } },
      path: '/permit/scope',
    }),
  },
  {
    expectedBody: {
      error: {
        category: 'permission',
        code: 'PermitError',
        message: 'Missing scopes: thing:read',
      },
    },
    expectedStatus: 403,
    name: 'resolved permit with insufficient scopes returns PermitError',
    options: () => ({
      resolvePermit: () => Result.ok({ id: 'user-1', scopes: [] }),
    }),
    request: () => ({
      init: { headers: { Authorization: 'Bearer weak' } },
      path: '/permit/scope',
    }),
  },
  {
    expectedBody: { data: { aborted: true } },
    expectedStatus: 200,
    name: 'AbortSignal changes propagate into delayed trail execution',
    request: () => {
      const controller = new AbortController();
      return {
        afterStart: () => controller.abort(),
        init: { signal: controller.signal },
        path: '/abort/delay',
      };
    },
  },
  {
    expectedBody: { data: { paymentId: 'pay_1' } },
    expectedStatus: 200,
    name: 'webhook verify and parse success',
    request: () => ({
      init: {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      },
      path: '/webhooks/payment',
    }),
  },
  {
    assert: () => {
      expect(
        webhookRecords.filter(
          (record) =>
            record.kind === 'activation' &&
            record.name === 'activation.webhook.invalid' &&
            record.errorCategory === 'permission'
        )
      ).toHaveLength(2);
    },
    expectedBody: {
      error: {
        category: 'permission',
        code: 'PermissionError',
        message: 'Invalid webhook secret',
      },
    },
    expectedStatus: 403,
    name: 'webhook verification failure records invalid activation',
    request: () => ({
      init: {
        body: JSON.stringify({ paymentId: 'pay_1' }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': 'wrong',
        },
        method: 'POST',
      },
      path: '/webhooks/payment',
    }),
  },
  {
    assert: () => {
      expect(
        webhookRecords.filter(
          (record) =>
            record.kind === 'activation' &&
            record.name === 'activation.webhook.invalid' &&
            record.errorCategory === 'validation'
        )
      ).toHaveLength(2);
    },
    expectedBodyMatch: {
      error: {
        category: 'validation',
        code: 'ValidationError',
      },
    },
    expectedStatus: 400,
    name: 'webhook parse failure records invalid activation',
    request: () => ({
      init: {
        body: JSON.stringify({ paymentId: 123 }),
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': webhookSecret,
        },
        method: 'POST',
      },
      path: '/webhooks/payment',
    }),
  },
];

const runParityScenario = async (scenario: ParityScenario): Promise<void> => {
  webhookRecords = [];
  registerTraceSink(createCapturingSink(webhookRecords));

  const results = [
    await invokeSurface('hono', scenario),
    await invokeSurface('bun', scenario),
  ] as const;

  expect(results[0].response.status).toBe(scenario.expectedStatus);
  expect(results[1].response.status).toBe(scenario.expectedStatus);
  expect(results[0].body).toEqual(results[1].body);
  for (const result of results) {
    expectJsonResponse(result);
    if (scenario.expectedBody !== undefined) {
      expect(result.body).toEqual(scenario.expectedBody);
    }
    if (scenario.expectedBodyMatch !== undefined) {
      expect(result.body).toMatchObject(scenario.expectedBodyMatch);
    }
  }
  scenario.assert?.(results);
};

describe('HTTP surface parity (Hono and Bun)', () => {
  test.each(parityScenarios)('$name', runParityScenario);
});
