import { describe, expect, test } from 'bun:test';

import {
  InternalError,
  NotFoundError,
  Result,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { HttpMethod, HttpRouteDefinition } from '../build.js';
import { buildHttpRoutes } from '../build.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route registration keyed by HTTP method. */
const routeRegistrars: Record<
  HttpMethod,
  (hono: Hono, route: HttpRouteDefinition) => void
> = {
  DELETE: (hono, route) => {
    hono.delete(route.path, route.handler);
  },
  GET: (hono, route) => {
    hono.get(route.path, route.handler);
  },
  POST: (hono, route) => {
    hono.post(route.path, route.handler);
  },
};

const echoTrail = trail('echo', {
  description: 'Echo a message back',
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
  run: (input) => Result.ok({ reply: input.message }),
});

const createTrail = trail('item.create', {
  description: 'Create an item',
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string(), name: z.string() }),
  run: (input) => Result.ok({ id: '123', name: input.name }),
});

const deleteTrail = trail('item.delete', {
  description: 'Delete an item',
  input: z.object({ id: z.string() }),
  intent: 'destroy',
  run: (_input) => Result.ok({ deleted: true }),
});

const notFoundTrail = trail('item.get', {
  description: 'Get an item that does not exist',
  input: z.object({ id: z.string() }),
  intent: 'read',
  run: (_input) => Result.err(new NotFoundError('Item not found')),
});

const internalTrail = trail('crash', {
  description: 'Always fails with internal error',
  input: z.object({}),
  run: () => Result.err(new InternalError('Something broke')),
});

const internalMetaTrail = trail('secret', {
  description: 'Internal trail that should be skipped',
  input: z.object({}),
  metadata: { internal: true },
  run: () => Result.ok({ ok: true }),
});

/** Build a Hono app from routes for testing. */
const buildTestApp = (...args: Parameters<typeof buildHttpRoutes>): Hono => {
  const hono = new Hono();
  const routes = buildHttpRoutes(...args);

  for (const route of routes) {
    routeRegistrars[route.method](hono, route);
  }

  return hono;
};

/** Make a request against a Hono test app. */
const request = (
  app: Hono,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return app.request(path, init);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildHttpRoutes', () => {
  describe('method derivation', () => {
    test('intent: read maps to GET', () => {
      const app = topo('testapp', { echoTrail });
      const routes = buildHttpRoutes(app);

      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('GET');
    });

    test('intent: destroy maps to DELETE', () => {
      const app = topo('testapp', { deleteTrail });
      const routes = buildHttpRoutes(app);

      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('DELETE');
    });

    test('default intent (write) maps to POST', () => {
      const app = topo('testapp', { createTrail });
      const routes = buildHttpRoutes(app);

      expect(routes).toHaveLength(1);
      expect(routes[0]?.method).toBe('POST');
    });
  });

  describe('path derivation', () => {
    test('dotted ID becomes slashed path', () => {
      const app = topo('testapp', { createTrail });
      const routes = buildHttpRoutes(app);

      expect(routes[0]?.path).toBe('/item/create');
    });

    test('simple ID becomes /id', () => {
      const app = topo('testapp', { echoTrail });
      const routes = buildHttpRoutes(app);

      expect(routes[0]?.path).toBe('/echo');
    });

    test('basePath is prepended', () => {
      const app = topo('testapp', { echoTrail });
      const routes = buildHttpRoutes(app, { basePath: '/api/v1' });

      expect(routes[0]?.path).toBe('/api/v1/echo');
    });
  });

  describe('filtering', () => {
    test('internal trails are skipped', () => {
      const app = topo('testapp', { echoTrail, internalMetaTrail });
      const routes = buildHttpRoutes(app);

      expect(routes).toHaveLength(1);
      expect(routes[0]?.trailId).toBe('echo');
    });
  });

  describe('GET handler', () => {
    test('returns 200 with data on success', async () => {
      const app = topo('testapp', { echoTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'GET', '/echo?message=hello');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { reply: 'hello' } });
    });

    test('returns 400 on invalid input', async () => {
      const app = topo('testapp', { echoTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'GET', '/echo');
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.category).toBe('validation');
    });
  });

  describe('POST handler', () => {
    test('returns 200 with data on success', async () => {
      const app = topo('testapp', { createTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'POST', '/item/create', {
        name: 'Widget',
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { id: '123', name: 'Widget' } });
    });

    test('returns 400 on invalid input', async () => {
      const app = topo('testapp', { createTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'POST', '/item/create', {});
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.category).toBe('validation');
    });
  });

  describe('DELETE handler', () => {
    test('returns 200 with data on success', async () => {
      const app = topo('testapp', { deleteTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'DELETE', '/item/delete', {
        id: 'abc',
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { deleted: true } });
    });
  });

  describe('error mapping', () => {
    test('NotFoundError maps to 404', async () => {
      const app = topo('testapp', { notFoundTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'GET', '/item/get?id=missing');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error.category).toBe('not_found');
      expect(json.error.message).toBe('Item not found');
    });

    test('InternalError maps to 500', async () => {
      const app = topo('testapp', { internalTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'POST', '/crash', {});
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error.category).toBe('internal');
    });

    test('thrown exceptions map to 500', async () => {
      const throwTrail = trail('throw', {
        input: z.object({}),
        run: () => {
          throw new Error('unexpected crash');
        },
      });

      const app = topo('testapp', { throwTrail });
      const hono = buildTestApp(app);

      const res = await request(hono, 'POST', '/throw', {});
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error.message).toBe('unexpected crash');
    });
  });

  describe('layers', () => {
    test('layers compose around trail execution', async () => {
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

      const app = topo('testapp', { echoTrail });
      const hono = buildTestApp(app, { layers: [testLayer] });

      const res = await request(hono, 'GET', '/echo?message=hi');
      expect(res.status).toBe(200);
      expect(calls).toEqual(['before', 'after']);
    });
  });

  describe('context', () => {
    test('X-Request-ID header is used for requestId', async () => {
      let capturedRequestId: string | undefined;

      const ctxTrail = trail('ctx.check', {
        input: z.object({}),
        intent: 'read',
        run: (_input, ctx) => {
          capturedRequestId = ctx.requestId;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { ctxTrail });
      const hono = buildTestApp(app);

      const res = await hono.request('/ctx/check', {
        headers: { 'X-Request-ID': 'custom-req-123' },
        method: 'GET',
      });

      expect(res.status).toBe(200);
      expect(capturedRequestId).toBe('custom-req-123');
    });

    test('custom createContext is used when provided', async () => {
      let contextUsed = false;

      const ctxTrail = trail('ctx.custom', {
        input: z.object({}),
        intent: 'read',
        run: (_input, ctx) => {
          const ctxRecord = ctx as Record<string, unknown>;
          contextUsed = ctxRecord['custom'] === true;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { ctxTrail });
      const hono = buildTestApp(app, {
        createContext: () => ({
          custom: true,
          requestId: 'test-id',
          signal: new AbortController().signal,
        }),
      });

      const res = await request(hono, 'GET', '/ctx/custom');
      expect(res.status).toBe(200);
      expect(contextUsed).toBe(true);
    });
  });
});
