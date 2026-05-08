import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  NotFoundError,
  Result,
  topo,
  trail,
  ValidationError,
  webhook,
} from '@ontrails/core';
import { z } from 'zod';

import { createApp, surface } from '../surface.js';

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
  blaze: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const echoBodyTrail = trail('echo.body', {
  blaze: (input) => Result.ok({ length: input.message.length }),
  input: z.object({ message: z.string() }),
  intent: 'write',
  output: z.object({ length: z.number() }),
});

const notFoundTrail = trail('item.show', {
  blaze: () => Result.err(new NotFoundError('item not found')),
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: z.object({ id: z.string() }),
});

const genericErrorTrail = trail('generic.error', {
  blaze: () => Result.err(new Error('database password=secret')),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

const webhookSpec = webhook('webhook.payment', {
  parse: z.object({ paymentId: z.string() }),
  path: '/webhooks/payment',
});

const paymentWebhookTrail = trail('payment.receive', {
  blaze: (input) => Result.ok({ paymentId: input.paymentId }),
  input: z.object({ paymentId: z.string() }),
  on: [webhookSpec],
  output: z.object({ paymentId: z.string() }),
});

const buildRequest = (
  path: string,
  init: RequestInit & { url?: string } = {}
): Request => {
  const base = init.url ?? 'http://localhost:3000';
  const url = new URL(path, base).toString();
  return new Request(url, init);
};

const callRoute = async (
  handler: ReturnType<typeof createApp>,
  method: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  const url = new URL(path, 'http://localhost:3000');
  const route = handler.routes[url.pathname];
  if (!route) {
    return handler.fetch(buildRequest(path, init));
  }
  const methodHandler = route[method as keyof typeof route];
  if (!methodHandler) {
    return handler.fetch(buildRequest(path, init));
  }
  return methodHandler(buildRequest(path, init));
};

describe('@ontrails/bun adapter', () => {
  describe('createApp', () => {
    test('returns a route record keyed by trail path', () => {
      const graph = topo('test', { echoTrail });
      const handler = createApp(graph);
      expect(handler.routes['/echo']).toBeDefined();
      expect(handler.routes['/echo']?.GET).toBeTypeOf('function');
    });

    test('throws ValidationError when a webhook trail is present', () => {
      const graph = topo('test', { paymentWebhookTrail });
      expect(() => createApp(graph)).toThrow(ValidationError);
    });

    test('rejects an invalid maxJsonBodyBytes option', () => {
      const graph = topo('test', { echoTrail });
      expect(() => createApp(graph, { maxJsonBodyBytes: 0 })).toThrow(
        ValidationError
      );
    });
  });

  describe('routing', () => {
    test('GET with query params returns the trail Result', async () => {
      const graph = topo('test', { echoTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'GET', '/echo?message=hi');

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { reply: string } };
      expect(body.data.reply).toBe('hi');
    });

    test('POST with JSON body returns the trail Result', async () => {
      const graph = topo('test', { echoBodyTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'POST', '/echo/body', {
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { length: number } };
      expect(body.data.length).toBe(5);
    });

    test('unmatched path returns 404 via fetch fallback', async () => {
      const graph = topo('test', { echoTrail });
      const handler = createApp(graph);

      const response = await handler.fetch(buildRequest('/missing'));

      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        error: { category: string; code: string };
      };
      expect(body.error.category).toBe('not_found');
      expect(body.error.code).toBe('RouteNotFound');
    });
  });

  describe('body validation', () => {
    test('JSON body over the cap returns 413', async () => {
      const graph = topo('test', { echoBodyTrail });
      const handler = createApp(graph, { maxJsonBodyBytes: 32 });

      const oversize = JSON.stringify({ message: 'x'.repeat(64) });
      const response = await callRoute(handler, 'POST', '/echo/body', {
        body: oversize,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(413);
      const body = (await response.json()) as {
        error: { category: string; message: string };
      };
      expect(body.error.category).toBe('validation');
      expect(body.error.message).toContain('exceeds');
    });

    test('malformed Content-Length returns 400', async () => {
      const graph = topo('test', { echoBodyTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'POST', '/echo/body', {
        body: JSON.stringify({ message: 'hi' }),
        headers: {
          'Content-Length': 'not-a-number',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('ValidationError');
    });

    test('malformed JSON returns 400', async () => {
      const graph = topo('test', { echoBodyTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'POST', '/echo/body', {
        body: '{not valid json',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain('Invalid JSON');
    });
  });

  describe('error mapping', () => {
    test('NotFoundError result returns 404 with the projected category', async () => {
      const graph = topo('test', { notFoundTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'GET', '/item/show?id=p_0');

      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        error: { category: string; code: string };
      };
      expect(body.error.code).toBe('NotFoundError');
    });

    test('non-Trails error returns redacted 500 without leaking the message', async () => {
      const graph = topo('test', { genericErrorTrail });
      const handler = createApp(graph);

      const response = await callRoute(handler, 'GET', '/generic/error');

      expect(response.status).toBe(500);
      const body = (await response.json()) as {
        error: { category: string; code: string; message: string };
      };
      expect(body.error.category).toBe('internal');
      expect(body.error.code).toBe('InternalError');
      expect(body.error.message).toBe('Internal server error');
      expect(body.error.message).not.toContain('password=secret');

      // Original error is logged to the diagnostic boundary
      expect(loggedErrors.length).toBe(1);
    });
  });

  describe('surface', () => {
    test('starts a server, returns url and close, and serves requests', async () => {
      const graph = topo('test', { echoTrail });
      const result = await surface(graph, { port: 0 });

      try {
        expect(result.url).toContain('http://');
        const response = await fetch(`${result.url}echo?message=ping`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { data: { reply: string } };
        expect(body.data.reply).toBe('ping');
      } finally {
        await result.close();
      }
    });
  });
});
