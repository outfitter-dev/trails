import { expect, test } from 'bun:test';
import { NotFoundError, Result, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { createFetchHandler } from '../fetch.js';

const missing = trail('missing', {
  implementation: () => Result.err(new NotFoundError('authored missing')),
  input: z.object({}),
  intent: 'read',
  output: z.object({}),
});
const event = webhook('event', {
  parse: z.object({ id: z.string() }),
  path: '/events/:id',
});
const consume = trail('consume', {
  implementation: () => Result.ok({ accepted: true }),
  input: z.object({}),
  on: [event],
  output: z.object({ accepted: z.boolean() }),
});
const app = topo('unmatched', { consume, event, missing });

test('only final method/path misses invoke the callback with the original request', async () => {
  const received: Request[] = [];
  const fallback = new Response('asset', { status: 203 });
  const handle = createFetchHandler(app, {
    onUnmatched: (request) => {
      received.push(request);
      return fallback;
    },
  });
  const authored = await handle(new Request('https://example.test/missing'));
  expect(authored.status).toBe(404);
  expect(await authored.text()).toContain('authored missing');
  const dynamic = await handle(
    new Request('https://example.test/events/123', {
      body: '{}',
      method: 'POST',
    })
  );
  expect(dynamic.status).toBe(202);
  expect(received).toEqual([]);
  for (const request of [
    new Request('https://example.test/unknown?q=1'),
    new Request('https://example.test/missing', { method: 'POST' }),
    new Request('https://example.test/events/123'),
  ]) {
    expect(await handle(request)).toBe(fallback);
    expect(received.at(-1)).toBe(request);
  }
});

test('omitting callback retains standard route-not-found response', async () => {
  const response = await createFetchHandler(app)(
    new Request('https://example.test/unknown')
  );
  expect(response.status).toBe(404);
  expect(await response.text()).toContain('HTTP route not found');
});

test('async callback response and rejection are passed through', async () => {
  const request = new Request('https://example.test/unknown');
  const response = new Response('async');
  expect(
    await createFetchHandler(app, { onUnmatched: async () => response })(
      request
    )
  ).toBe(response);
  const failure = new Error('asset unavailable');
  await expect(
    createFetchHandler(app, { onUnmatched: () => Promise.reject(failure) })(
      request
    )
  ).rejects.toBe(failure);
});
