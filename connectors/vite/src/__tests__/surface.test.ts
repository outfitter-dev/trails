import { describe, expect, test } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../../../connectors/hono/src/index.ts';
import { Result, trail, topo } from '../../../../packages/core/src/index.ts';
import { z } from 'zod';

import { vite } from '../index.js';
import type { ViteMiddleware } from '../index.js';

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ reply: input.message }),
  input: z.object({ message: z.string() }),
  intent: 'read',
  output: z.object({ reply: z.string() }),
});

const submitTrail = trail('submit', {
  blaze: (input) => Result.ok({ accepted: input.message }),
  input: z.object({ message: z.string() }),
  output: z.object({ accepted: z.string() }),
});

const graph = topo('vite-adapter', { echoTrail, submitTrail });

const handleMiddleware = async (
  middleware: ViteMiddleware,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> => {
  const completion = Promise.withResolvers<undefined>();

  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Connect middleware completes through next(error?)
  middleware(req, res, (error) => {
    if (error !== undefined) {
      completion.reject(error);
      return;
    }

    completion.resolve();
  });

  try {
    await completion.promise;
  } catch (error) {
    res.statusCode = 500;
    res.end(error instanceof Error ? error.message : String(error));
  }
};

const startServer = async (
  middleware: ViteMiddleware
): Promise<{ readonly close: () => Promise<void>; readonly url: string }> => {
  const server = createServer(async (req, res) => {
    try {
      await handleMiddleware(middleware, req, res);
    } catch (error: unknown) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral TCP address for the test server');
  }

  return {
    close: async () => {
      server.close();
      await once(server, 'close');
    },
    url: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
};

describe('Vite runtime adapter', () => {
  test('vite(createApp(graph)) serves read trails through query params', async () => {
    const handle = await startServer(vite(createApp(graph)));

    try {
      const response = await fetch(new URL('/echo?message=hello', handle.url));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { reply: 'hello' } });
    } finally {
      await handle.close();
    }
  });

  test('forwards JSON request bodies to write trails', async () => {
    const handle = await startServer(vite(createApp(graph)));

    try {
      const response = await fetch(new URL('/submit', handle.url), {
        body: JSON.stringify({ message: 'saved' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { accepted: 'saved' },
      });
    } finally {
      await handle.close();
    }
  });
});
