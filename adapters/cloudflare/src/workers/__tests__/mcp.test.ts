import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Result, run, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { cloudflareKv, createMemoryKv } from '../../kv/index.js';
import { workersHostConfigSchema as rootHostSchema } from '@ontrails/cloudflare';
import {
  createWorkersHandler,
  workersHostConfigSchema,
} from '@ontrails/cloudflare/workers';
import type { WorkersMcpContext } from '@ontrails/cloudflare/workers';

const flags = cloudflareKv('flags', { binding: 'FLAGS' });
const show = trail('flag.show', {
  implementation: async (input, ctx) =>
    Result.ok({ value: await flags.from(ctx).get(input.key) }),
  input: z.object({ key: z.string() }),
  intent: 'read',
  output: z.object({ value: z.string().nullable() }),
  resources: [flags],
});
const app = topo('mcp-host', { flags, show });
const host = workersHostConfigSchema.parse({ mcp: { path: '/mcp' } });
const request = (path: string) => new Request(`https://example.test${path}`);
const readJson = async (response: Promise<Response>): Promise<unknown> => {
  const resolved = await response;
  return resolved.json();
};
let log = console.error;
beforeEach(() => {
  log = console.error;
  console.error = mock(() => {});
});
afterEach(() => {
  console.error = log;
});

test('exact MCP path reaches the double with shared env resources/context/config', async () => {
  const client = createMemoryKv();
  await client.put('color', 'blue');
  const initialContext = {
    abortSignal: new AbortController().signal,
    requestId: 'test-request',
  };
  const createContext = () => initialContext;
  const configValues = { example: { mode: 'test' } };
  let received: WorkersMcpContext | undefined;
  let originalRequest: Request | undefined;
  const worker = createWorkersHandler(app, {
    basePath: '/api',
    configValues,
    createContext,
    host,
    mcp: (context) => {
      received = context;
      return async (incoming) => {
        originalRequest = incoming;
        const result = await run(
          app,
          'flag.show',
          { key: 'color' },
          { resources: context.resources }
        );
        return Response.json(result.isOk() ? result.value : { failed: true });
      };
    },
  });
  const incoming = request('/mcp?query=preserved');
  const response = await worker.fetch(incoming, { FLAGS: client });
  expect(await response.json()).toEqual({ value: 'blue' });
  expect(originalRequest).toBe(incoming);
  expect(received?.resources['flags']).toBe(client);
  expect(received?.createContext).toBe(createContext);
  expect(received?.configValues).toBe(configValues);
  const http = await worker.fetch(request('/api/flag/show?key=color'), {
    FLAGS: client,
  });
  expect(await http.json()).toMatchObject({ data: { value: 'blue' } });
});

test('env identity controls MCP materialization and override precedence', async () => {
  let built = 0;
  const red = createMemoryKv();
  const blue = createMemoryKv();
  await red.put('color', 'red');
  await blue.put('color', 'blue');
  const worker = createWorkersHandler(app, {
    host,
    mcp: ({ resources }) => {
      built += 1;
      return async () => {
        const result = await run(
          app,
          'flag.show',
          { key: 'color' },
          { resources }
        );
        return Response.json(result.isOk() ? result.value : null);
      };
    },
    resources: (env) => ({ flags: env['EXPLICIT'] }),
  });
  const first = { EXPLICIT: red };
  const second = { EXPLICIT: blue };
  expect(await readJson(worker.fetch(request('/mcp'), first))).toEqual({
    value: 'red',
  });
  expect(await readJson(worker.fetch(request('/mcp'), first))).toEqual({
    value: 'red',
  });
  expect(built).toBe(1);
  expect(await readJson(worker.fetch(request('/mcp'), second))).toEqual({
    value: 'blue',
  });
  expect(await readJson(worker.fetch(request('/mcp'), first))).toEqual({
    value: 'red',
  });
  expect(built).toBe(3);
});

test('MCP path is exact across methods and does not absorb siblings/subpaths', async () => {
  let called = 0;
  let built = 0;
  const worker = createWorkersHandler(topo('empty', {}), {
    host,
    mcp: () => {
      built += 1;
      return async () => {
        called += 1;
        return new Response('MCP');
      };
    },
  });
  const response = await worker.fetch(
    new Request('https://example.test/mcp', { method: 'POST' })
  );
  expect(await response.text()).toBe('MCP');
  const get = await worker.fetch(request('/mcp'));
  expect(await get.text()).toBe('MCP');
  const trailingSlash = await worker.fetch(request('/mcp/'));
  const sibling = await worker.fetch(request('/mcp-other'));
  expect(trailingSlash.status).toBe(404);
  expect(sibling.status).toBe(404);
  expect(called).toBe(2);
  expect(built).toBe(1);
});

test('MCP response errors never fall through to HTTP', async () => {
  const empty = topo('empty', {});
  const worker = createWorkersHandler(empty, {
    host,
    mcp: () => async () => new Response('MCP missing', { status: 404 }),
  });
  const response = await worker.fetch(request('/mcp'));
  expect(response.status).toBe(404);
  expect(await response.text()).toBe('MCP missing');
  const failing = createWorkersHandler(empty, {
    host,
    mcp: () => async () => {
      throw new Error('private failure');
    },
  });
  const failed = await failing.fetch(request('/mcp'));
  expect(failed.status).toBe(500);
});

test('invalid or inconsistent host setup is rejected', () => {
  const empty = topo('empty', {});
  for (const path of [
    'mcp',
    '//other/mcp',
    '/mcp?x=1',
    '/mcp#part',
    '/a/../mcp',
    '/mcp*',
    '/mcp\\nested',
  ]) {
    expect(() =>
      createWorkersHandler(empty, {
        host: { mcp: { path } },
        mcp: () => async () => new Response(),
      })
    ).toThrow();
  }
  expect(() => createWorkersHandler(empty, { host })).toThrow();
  expect(() =>
    createWorkersHandler(empty, { host, mcp: null as never })
  ).toThrow();
  expect(() =>
    createWorkersHandler(empty, { mcp: () => async () => new Response() })
  ).toThrow();
  expect(Object.isFrozen(host)).toBe(true);
  expect(Object.isFrozen(host.mcp)).toBe(true);
  expect(rootHostSchema).toBe(workersHostConfigSchema);
});

test('MCP endpoint cannot shadow an HTTP route', () => {
  expect(() =>
    createWorkersHandler(app, {
      host: { mcp: { path: '/flag/show' } },
      mcp: () => async () => new Response(),
    })
  ).toThrow('collides');
  expect(() =>
    createWorkersHandler(app, {
      basePath: '/api',
      host: { mcp: { path: '/api/flag/show' } },
      mcp: () => async () => new Response(),
    })
  ).toThrow('collides');
});

test('MCP endpoint cannot shadow a parameterized webhook route', () => {
  const source = webhook('dynamic.received', {
    method: 'POST',
    parse: z.object({ tenant: z.string() }),
    path: '/hooks/:tenant',
  });
  const receive = trail('dynamic.receive', {
    implementation: async () => Result.ok({}),
    input: z.object({ tenant: z.string() }),
    on: [source],
    output: z.object({}),
  });
  expect(() =>
    createWorkersHandler(topo('dynamic-collision', { receive }), {
      host: { mcp: { path: '/hooks/team' } },
      mcp: () => async () => new Response(),
    })
  ).toThrow('collides');
});

test('MCP env bridge includes resources of internal compositions', async () => {
  const hidden = trail('hidden.show', {
    implementation: async (input, ctx) =>
      Result.ok({ value: await flags.from(ctx).get(input.key) }),
    input: z.object({ key: z.string() }),
    output: z.object({ value: z.string().nullable() }),
    resources: [flags],
    visibility: 'internal',
  });
  const outer = trail('outer.show', {
    composes: [hidden],
    implementation: (input, ctx) => ctx.compose(hidden, input),
    input: z.object({ key: z.string() }),
    output: z.object({ value: z.string().nullable() }),
  });
  const graph = topo('mcp-composes', { flags, hidden, outer });
  const client = createMemoryKv();
  await client.put('color', 'composed');
  const worker = createWorkersHandler(graph, {
    host,
    mcp:
      ({ resources }) =>
      async () => {
        const result = await run(
          graph,
          'outer.show',
          { key: 'color' },
          { resources }
        );
        return Response.json(result.isOk() ? result.value : null);
      },
  });
  expect(
    await readJson(worker.fetch(request('/mcp'), { FLAGS: client }))
  ).toEqual({ value: 'composed' });
});

test('MCP selection filters reach both the env bridge and factory', async () => {
  let received: WorkersMcpContext | undefined;
  const worker = createWorkersHandler(app, {
    exclude: ['flag.**'],
    host,
    mcp: (context) => {
      received = context;
      return async () => new Response('filtered');
    },
  });
  const response = await worker.fetch(request('/mcp'), {});
  expect(response.status).toBe(200);
  expect(received?.resources).toEqual({});
  expect(received?.exclude).toEqual(['flag.**']);
});

test('Worker host entry bundles for a Web standards runtime', async () => {
  const bundle = await Bun.build({
    entrypoints: [new URL('../index.ts', import.meta.url).pathname],
    format: 'esm',
    target: 'browser',
  });
  expect(bundle.success).toBe(true);
  const output = await bundle.outputs[0]?.text();
  expect(output).toBeDefined();
  expect(output).not.toContain('bun:test');
});

test('MCP env selection excludes webhook-only resources', async () => {
  const missing = cloudflareKv('webhook-only', { binding: 'WEBHOOK_ONLY' });
  const source = webhook('received', {
    method: 'POST',
    parse: z.object({}),
    path: '/hook',
  });
  const receive = trail('hook.receive', {
    implementation: async () => Result.ok({}),
    input: z.object({}),
    on: [source],
    output: z.object({}),
    resources: [missing],
  });
  const graph = topo('mcp-selection', { flags, missing, receive, show });
  let resources: WorkersMcpContext['resources'] | undefined;
  const worker = createWorkersHandler(graph, {
    host,
    mcp: (context) => {
      ({ resources } = context);
      return async () => new Response('ok');
    },
  });
  const client = createMemoryKv();
  const response = await worker.fetch(request('/mcp'), { FLAGS: client });
  expect(response.status).toBe(200);
  expect(resources?.['flags']).toBe(client);
  expect(resources).not.toHaveProperty('webhook-only');
});
