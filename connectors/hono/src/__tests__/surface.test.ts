import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
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

const genericErrorTrail = trail('generic.error', {
  blaze: () => Result.err(new Error('database password=secret')),
  input: z.object({}),
  intent: 'read',
  output: z.object({ ok: z.boolean() }),
});

describe('surface API (Hono connector)', () => {
  test('createApp materializes the Hono surface without serving', async () => {
    const graph = topo('surface-api', { echoTrail });
    const app = createApp(graph);

    const response = await app.request('/echo?message=hello', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { reply: 'hello' } });
  });

  test('surface starts a Bun server and returns a close handle', async () => {
    const graph = topo('surface-api', { echoTrail });
    const handle = await surface(graph, { port: 0 });

    try {
      const response = await fetch(new URL('/echo?message=hello', handle.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { reply: 'hello' } });
    } finally {
      await handle.close();
    }
  });

  test('repeated query keys arrive as arrays for GET routes', async () => {
    const graph = topo('surface-api', { tagsTrail });
    const app = createApp(graph);

    const response = await app.request('/tags?tags=red&tags=blue', {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { tags: ['red', 'blue'] },
    });
  });

  test('single query values stay scalar even when the schema expects an array', async () => {
    const graph = topo('surface-api', { tagsTrail });
    const app = createApp(graph);

    const response = await app.request('/tags?tags=solo', {
      method: 'GET',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        category: 'validation',
      },
    });
  });

  test('default JSON body cap rejects request bodies over 1 MiB', async () => {
    const graph = topo('surface-api', { echoBodyTrail });
    const app = createApp(graph);
    const body = JSON.stringify({ message: 'x'.repeat(1024 * 1024) });

    const response = await app.request('/echo/body', {
      body,
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'JSON request body exceeds 1048576 bytes',
      },
    });
  });

  test('malformed Content-Length is rejected as invalid body metadata', async () => {
    const graph = topo('surface-api', { echoBodyTrail });
    const app = createApp(graph);

    const response = await app.request('/echo/body', {
      headers: { 'Content-Length': 'abc' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'Invalid Content-Length header',
      },
    });
  });

  test('maxJsonBodyBytes overrides the default JSON body cap', async () => {
    const graph = topo('surface-api', { echoBodyTrail });
    const app = createApp(graph, { maxJsonBodyBytes: 2 * 1024 * 1024 });
    const message = 'x'.repeat(1024 * 1024);

    const response = await app.request('/echo/body', {
      body: JSON.stringify({ message }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { length: message.length },
    });
  });

  test('uses Hono cached bodies when upstream middleware already read JSON', async () => {
    const graph = topo('surface-api', { echoBodyTrail });
    const app = createApp(graph);
    app.use('/echo/body', async (c, next) => {
      expect(await c.req.json()).toEqual({ message: 'cached body' });
      await next();
    });

    const response = await app.request('/echo/body', {
      body: JSON.stringify({ message: 'cached body' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { length: 'cached body'.length },
    });
  });

  test('applies the JSON body cap to cached request text', async () => {
    const graph = topo('surface-api', { echoBodyTrail });
    const app = createApp(graph, { maxJsonBodyBytes: 20 });
    const body = JSON.stringify({ message: 'cached body' });

    app.use('/echo/body', async (c, next) => {
      expect(await c.req.text()).toBe(body);
      await next();
    });

    const response = await app.request('/echo/body', {
      body,
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        category: 'validation',
        code: 'ValidationError',
        message: 'JSON request body exceeds 20 bytes',
      },
    });
  });

  test('generic non-TrailsError results redact public 500 responses and keep diagnostics', async () => {
    const graph = topo('surface-api', { genericErrorTrail });
    const app = createApp(graph);

    const response = await app.request('/generic/error', {
      headers: { 'X-Request-ID': 'req-123' },
      method: 'GET',
    });

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
      '[ontrails:hono] Internal error (req-123)'
    );
    const loggedError = loggedErrors[0]?.[1];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe('database password=secret');
  });

  test('sanitizes request ids before logging diagnostics', async () => {
    const graph = topo('surface-api', { genericErrorTrail });
    const app = createApp(graph);

    const response = await app.request('/generic/error', {
      headers: { 'X-Request-ID': 'req-123 forged/line' },
      method: 'GET',
    });

    expect(response.status).toBe(500);
    expect(loggedErrors).toHaveLength(1);
    const label = loggedErrors[0]?.[0];
    expect(label).toBe('[ontrails:hono] Internal error (req-123_forged_line)');
    expect(String(label)).not.toContain('req-123 forged');
    expect(String(label)).not.toContain('forged/line');
  });

  test('caps request ids before logging diagnostics', async () => {
    const graph = topo('surface-api', { genericErrorTrail });
    const app = createApp(graph);
    const requestId = 'x'.repeat(160);

    const response = await app.request('/generic/error', {
      headers: { 'X-Request-ID': requestId },
      method: 'GET',
    });

    expect(response.status).toBe(500);
    expect(loggedErrors).toHaveLength(1);
    expect(loggedErrors[0]?.[0]).toBe(
      `[ontrails:hono] Internal error (${'x'.repeat(128)})`
    );
  });

  test('global Hono errors use the same redacted 500 response', async () => {
    const graph = topo('surface-api', { echoTrail });
    const app = createApp(graph);
    app.get('/boom', () => {
      throw new Error('token=secret');
    });

    const response = await app.request('/boom', {
      method: 'GET',
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        category: 'internal',
        code: 'InternalError',
        message: 'Internal server error',
      },
    });
    expect(loggedErrors).toHaveLength(1);
    expect(loggedErrors[0]?.[0]).toBe('[ontrails:hono] Internal error');
    const loggedError = loggedErrors[0]?.[1];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe('token=secret');
  });
});
