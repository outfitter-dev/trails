import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { createApp, surface } from '../surface.js';

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
});
