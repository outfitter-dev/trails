import { describe, expect, test } from 'bun:test';

import {
  InternalError,
  NotFoundError,
  Result,
  trail,
  topo,
} from '@ontrails/core';
import type { Layer } from '@ontrails/core';
import { z } from 'zod';

import { blaze } from '../blaze.js';

// ---------------------------------------------------------------------------
// Test trails
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a request against a Hono test app. */
const request = (
  app: Awaited<ReturnType<typeof blaze>>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<Response> => {
  const init: RequestInit = { headers: { ...headers }, method };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] =
      'application/json';
    init.body = JSON.stringify(body);
  }
  return app.request(path, init);
};

/** Make a request with a raw string body. */
const requestRaw = (
  app: Awaited<ReturnType<typeof blaze>>,
  method: string,
  path: string,
  rawBody: string,
  headers?: Record<string, string>
): Promise<Response> => {
  const init: RequestInit = {
    body: rawBody,
    headers: { 'Content-Type': 'application/json', ...headers },
    method,
  };
  return app.request(path, init);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('blaze (Hono adapter)', () => {
  describe('validation', () => {
    test('blaze throws on invalid topo', async () => {
      const t = trail('broken', {
        follow: ['nonexistent.trail'],
        input: z.object({}),
        output: z.object({}),
        run: () => Result.ok({}),
      });
      const app = topo('test', { t });
      await expect(blaze(app, { serve: false })).rejects.toThrow(/validation/i);
    });

    test('blaze skips validation when validate: false', async () => {
      const t = trail('broken', {
        follow: ['nonexistent.trail'],
        input: z.object({}),
        output: z.object({}),
        run: () => Result.ok({}),
      });
      const app = topo('test', { t });
      await expect(
        blaze(app, { serve: false, validate: false })
      ).resolves.toBeDefined();
    });
  });

  describe('GET handler', () => {
    test('returns 200 with data on success', async () => {
      const app = topo('testapp', { echoTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/echo?message=hello');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { reply: 'hello' } });
    });

    test('returns 400 on invalid input', async () => {
      const app = topo('testapp', { echoTrail });
      const hono = await blaze(app, { serve: false });

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
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'POST', '/item/create', {
        name: 'Widget',
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { id: '123', name: 'Widget' } });
    });

    test('returns 400 on invalid input', async () => {
      const app = topo('testapp', { createTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'POST', '/item/create', {});
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.category).toBe('validation');
    });

    test('POST with empty input schema succeeds without a body', async () => {
      const emptyWriteTrail = trail('empty.write', {
        input: z.object({}),
        intent: 'write',
        output: z.object({ ok: z.boolean() }),
        run: () => Result.ok({ ok: true }),
      });

      const app = topo('testapp', { emptyWriteTrail });
      const hono = await blaze(app, { serve: false });

      // No body, no Content-Type header — mirrors a client that obeys the
      // OpenAPI spec (no requestBody declared for empty-input POST routes).
      const res = await hono.request('/empty/write', { method: 'POST' });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({ data: { ok: true } });
    });
  });

  describe('DELETE handler', () => {
    test('returns 200 with data on success', async () => {
      const app = topo('testapp', { deleteTrail });
      const hono = await blaze(app, { serve: false });

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
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/item/get?id=missing');
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error.category).toBe('not_found');
      expect(json.error.message).toBe('Item not found');
    });

    test('InternalError maps to 500', async () => {
      const app = topo('testapp', { internalTrail });
      const hono = await blaze(app, { serve: false });

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
      const hono = await blaze(app, { serve: false });

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
      const hono = await blaze(app, { layers: [testLayer], serve: false });

      const res = await request(hono, 'GET', '/echo?message=hi');
      expect(res.status).toBe(200);
      expect(calls).toEqual(['before', 'after']);
    });
  });

  describe('malformed JSON body', () => {
    test('returns 400 for invalid JSON in POST body', async () => {
      const app = topo('testapp', { createTrail });
      const hono = await blaze(app, { serve: false });

      const res = await requestRaw(hono, 'POST', '/item/create', '{invalid');
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.message).toBe('Invalid JSON in request body');
      expect(json.error.code).toBe('ValidationError');
      expect(json.error.category).toBe('validation');
    });

    test('returns 400 for invalid JSON in DELETE body', async () => {
      const app = topo('testapp', { deleteTrail });
      const hono = await blaze(app, { serve: false });

      const res = await requestRaw(hono, 'DELETE', '/item/delete', 'not-json');
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.message).toBe('Invalid JSON in request body');
    });
  });

  describe('query param parsing', () => {
    test('numeric-looking string is preserved as string', async () => {
      const stringIdTrail = trail('lookup', {
        input: z.object({ id: z.string() }),
        intent: 'read',
        run: (input) => Result.ok({ id: input.id }),
      });

      const app = topo('testapp', { stringIdTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/lookup?id=00123');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.id).toBe('00123');
    });

    test('repeated keys become arrays', async () => {
      const tagsTrail = trail('tags', {
        input: z.object({ tags: z.array(z.string()) }),
        intent: 'read',
        run: (input) => Result.ok({ tags: input.tags }),
      });

      const app = topo('testapp', { tagsTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/tags?tags=a&tags=b');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.tags).toEqual(['a', 'b']);
    });

    test('single value is wrapped in array when schema expects z.array()', async () => {
      const tagsTrail = trail('tags.single', {
        input: z.object({ tags: z.array(z.string()) }),
        intent: 'read',
        run: (input) => Result.ok({ tags: input.tags }),
      });

      const app = topo('testapp', { tagsTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/tags/single?tags=foo');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.tags).toEqual(['foo']);
    });

    test('single value stays scalar when schema expects a string', async () => {
      const nameTrail = trail('name.check', {
        input: z.object({ name: z.string() }),
        intent: 'read',
        run: (input) => Result.ok({ name: input.name }),
      });

      const app = topo('testapp', { nameTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/name/check?name=bar');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.name).toBe('bar');
    });

    test('optional array field with single value is wrapped in array', async () => {
      const optArrayTrail = trail('opt.array', {
        input: z.object({ ids: z.array(z.string()).optional() }),
        intent: 'read',
        run: (input) => Result.ok({ ids: input.ids }),
      });

      const app = topo('testapp', { optArrayTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/opt/array?ids=one');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.ids).toEqual(['one']);
    });
  });

  describe('AbortSignal', () => {
    test('passes request AbortSignal to trail context', async () => {
      let capturedSignal: AbortSignal | undefined;

      const signalTrail = trail('signal.check', {
        input: z.object({}),
        intent: 'read',
        output: z.object({ ok: z.boolean() }),
        run: (_input, ctx) => {
          capturedSignal = ctx.signal;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { signalTrail });
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/signal/check');
      expect(res.status).toBe(200);
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    test('signal is aborted when request is cancelled', async () => {
      let capturedSignal: AbortSignal | undefined;

      const signalTrail = trail('signal.aborted', {
        input: z.object({}),
        intent: 'read',
        output: z.object({ ok: z.boolean() }),
        run: (_input, ctx) => {
          capturedSignal = ctx.signal;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { signalTrail });
      const hono = await blaze(app, { serve: false });

      const controller = new AbortController();
      controller.abort();

      // Pass the pre-aborted signal directly in the Request.
      // Hono's fetch propagates Request.signal into c.req.raw.signal.
      const res = await hono.fetch(
        new Request('http://localhost/signal/aborted', {
          method: 'GET',
          signal: controller.signal,
        })
      );
      expect(res.status).toBe(200);
      expect(capturedSignal?.aborted).toBe(true);
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
      const hono = await blaze(app, { serve: false });

      const res = await request(hono, 'GET', '/ctx/check', undefined, {
        'X-Request-ID': 'custom-req-123',
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
          contextUsed = ctx.extensions?.['custom'] === true;
          return Result.ok({ ok: true });
        },
      });

      const app = topo('testapp', { ctxTrail });
      const hono = await blaze(app, {
        createContext: () => ({
          extensions: { custom: true },
          requestId: 'test-id',
          signal: new AbortController().signal,
        }),
        serve: false,
      });

      const res = await request(hono, 'GET', '/ctx/custom');
      expect(res.status).toBe(200);
      expect(contextUsed).toBe(true);
    });
  });
});
