import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { NotFoundError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { createWorkersHandler, workersHostConfigSchema } from '../index.js';

const missing = trail('missing', {
  implementation: () => Result.err(new NotFoundError('authored missing')),
  input: z.object({}),
  intent: 'read',
  output: z.object({}),
});
const app = topo('assets-host', { missing });
const host = workersHostConfigSchema.parse({
  assets: { binding: 'ASSETS' },
  mcp: { path: '/mcp' },
});
const request = (path: string) => new Request(`https://example.test${path}`);
let log = console.error;
beforeEach(() => {
  log = console.error;
  console.error = mock(() => {});
});
afterEach(() => {
  console.error = log;
});

test('only unmatched routes reach native assets with original receiver and request', async () => {
  const received: Request[] = [];
  const response = new Response('asset');
  const binding = {
    fetch(incoming: Request) {
      expect(this).toBe(binding);
      received.push(incoming);
      return Promise.resolve(response);
    },
  };
  const worker = createWorkersHandler(app, {
    basePath: '/api',
    host,
    mcp: () => async () => new Response('MCP', { status: 404 }),
  });
  const env = { ASSETS: binding };
  const authored = await worker.fetch(request('/api/missing'), env);
  expect(authored.status).toBe(404);
  expect(await authored.text()).toContain('authored missing');
  const mcp = await worker.fetch(request('/mcp'), env);
  expect(await mcp.text()).toBe('MCP');
  expect(received).toEqual([]);
  const incoming = request('/unknown?q=kept');
  expect(await worker.fetch(incoming, env)).toBe(response);
  expect(received).toEqual([incoming]);
});

test('asset binding follows env changes and custom names', async () => {
  const worker = createWorkersHandler(app, {
    host: { assets: { binding: 'FILES' } },
  });
  const red = { FILES: { fetch: () => new Response('red') } };
  const blue = { FILES: { fetch: () => new Response('blue') } };
  for (const [env, text] of [
    [red, 'red'],
    [blue, 'blue'],
    [red, 'red'],
  ] as const) {
    const response = await worker.fetch(request('/unknown'), env);
    expect(await response.text()).toBe(text);
  }
});

test('omitted assets retains HTTP 404, missing/malformed bindings fail only on a miss', async () => {
  const unchanged = await createWorkersHandler(app).fetch(request('/unknown'));
  expect(unchanged.status).toBe(404);
  const worker = createWorkersHandler(app, {
    host: { assets: { binding: 'ASSETS' } },
  });
  for (const env of [
    undefined,
    {},
    { ASSETS: null },
    { ASSETS: { fetch: 1 } },
  ]) {
    const matched = await worker.fetch(request('/missing'), env);
    expect(await matched.text()).toContain('authored missing');
    const response = await worker.fetch(request('/unknown'), env);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('ValidationError');
  }
  expect(() =>
    createWorkersHandler(app, { host: { assets: { binding: '' } } })
  ).toThrow();
});

test('MCP and assets failures remain terminal without rerouting', async () => {
  let attempts = 0;
  const worker = createWorkersHandler(app, {
    host,
    mcp: () => async () => {
      throw new Error('MCP failure');
    },
  });
  const env = {
    ASSETS: {
      fetch: () => {
        attempts += 1;
        throw new Error('asset failure');
      },
    },
  };
  const mcp = await worker.fetch(request('/mcp'), env);
  expect(mcp.status).toBe(500);
  expect(attempts).toBe(0);
  const asset = await worker.fetch(request('/unknown'), env);
  expect(asset.status).toBe(500);
  expect(attempts).toBe(1);
});
