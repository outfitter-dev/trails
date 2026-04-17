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
});
