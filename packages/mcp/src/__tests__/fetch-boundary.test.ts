import { describe, expect, test } from 'bun:test';
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { createFetchHandler } from '../fetch.js';

const app = topo('fetch-boundary', {
  read: trail('read', {
    implementation: () => Result.ok({ ok: true }),
    input: z.object({}),
    intent: 'read',
    output: z.object({ ok: z.boolean() }),
    permit: 'public',
  }),
});

describe('MCP fetch boundary', () => {
  test('rejects an unlisted Origin before request credentials are resolved', async () => {
    let resolutions = 0;
    const handler = createFetchHandler(app, {
      resolvePermit: () => {
        resolutions += 1;
        return Result.ok(null);
      },
    });
    try {
      const response = await handler.fetch(
        new Request('http://localhost/mcp', {
          body: JSON.stringify({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { arguments: {}, name: 'fetch_boundary_read' },
          }),
          headers: {
            'content-type': 'application/json',
            origin: 'https://foreign.example',
          },
          method: 'POST',
        })
      );
      expect(response.status).toBe(403);
      expect(resolutions).toBe(0);
    } finally {
      await handler.close();
    }
  });

  for (const fixture of [
    { headers: {}, status: 405, url: 'http://localhost/mcp' },
    { headers: {}, status: 405, url: 'http://127.0.0.1/mcp' },
    { headers: {}, status: 405, url: 'http://[::1]/mcp' },
    {
      headers: { host: 'localhost:80' },
      status: 405,
      url: 'http://LOCALHOST/mcp',
    },
    {
      headers: { host: 'LOCALHOST:443' },
      status: 405,
      url: 'https://localhost/mcp',
    },
    {
      headers: { host: '[::1]:8765' },
      status: 405,
      url: 'http://[::1]:8765/mcp',
    },
    {
      headers: { host: '[::1]:8766' },
      status: 403,
      url: 'http://[::1]:8765/mcp',
    },
    {
      headers: { host: 'localhost' },
      status: 403,
      url: 'http://localhost:8765/mcp',
    },
    {
      headers: { host: 'localhost' },
      status: 403,
      url: 'http://foreign.example/mcp',
    },
    {
      headers: { host: 'foreign.example' },
      status: 403,
      url: 'http://localhost/mcp',
    },
    { headers: {}, status: 403, url: 'ftp://localhost/mcp' },
  ]) {
    test(`validates authoritative URL and optional Host: ${JSON.stringify(fixture)}`, async () => {
      const handler = createFetchHandler(app);
      try {
        const response = await handler.fetch(
          new Request(fixture.url, { headers: fixture.headers })
        );
        expect(response.status).toBe(fixture.status);
      } finally {
        await handler.close();
      }
    });
  }

  for (const host of [
    '',
    'localhost:',
    'localhost, localhost',
    'user@localhost',
    'localhost/path',
    'localhost?x',
    'localhost#x',
    '%6cocalhost',
  ]) {
    test(`rejects malformed Host authority ${JSON.stringify(host)}`, async () => {
      const handler = createFetchHandler(app);
      try {
        const response = await handler.fetch(
          new Request('http://localhost/mcp', { headers: { host } })
        );
        expect(response.status).toBe(403);
      } finally {
        await handler.close();
      }
    });
  }

  for (const origin of [
    '',
    'null',
    'https://app.example/path',
    'https://app.example/',
    'https://user@app.example',
    'https://app.example?x',
    'https://app.example#x',
    'https://app.example, https://other.example',
    'moz-extension://id',
  ]) {
    test(`rejects invalid present Origin ${JSON.stringify(origin)}`, async () => {
      const handler = createFetchHandler(app, {
        allowedOrigins: ['https://app.example'],
      });
      try {
        const response = await handler.fetch(
          new Request('http://localhost/mcp', { headers: { origin } })
        );
        expect(response.status).toBe(403);
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
      } finally {
        await handler.close();
      }
    });
  }

  for (const fixture of [
    { origin: 'http://app.example', status: 405 },
    { origin: 'HTTP://APP.EXAMPLE:80', status: 405 },
    { origin: 'https://app.example', status: 403 },
    { origin: 'http://app.example:8080', status: 403 },
    { origin: 'http://other.example', status: 403 },
  ]) {
    test(`compares exact origin tuples ${fixture.origin}`, async () => {
      const handler = createFetchHandler(app, {
        allowedOrigins: ['http://app.example:80'],
      });
      try {
        const response = await handler.fetch(
          new Request('http://localhost/mcp', {
            headers: { origin: fixture.origin },
          })
        );
        expect(response.status).toBe(fixture.status);
      } finally {
        await handler.close();
      }
    });
  }

  test('explicit host configuration replaces defaults and empty hosts deny all', async () => {
    for (const allowedHosts of [[], ['app.example']]) {
      const handler = createFetchHandler(app, { allowedHosts });
      try {
        const local = await handler.fetch(new Request('http://localhost/mcp'));
        expect(local.status).toBe(403);
        const configured = await handler.fetch(
          new Request('http://app.example/mcp')
        );
        expect(configured.status).toBe(allowedHosts.length === 0 ? 403 : 405);
      } finally {
        await handler.close();
      }
    }
  });

  test('rejects invalid configuration at construction', () => {
    for (const allowedHost of [
      '',
      'localhost:80',
      '0.0.0.0',
      '[::]',
      '*',
      'app.example/',
      'https://app.example',
      'user@app.example',
    ]) {
      expect(() =>
        createFetchHandler(app, { allowedHosts: [allowedHost] })
      ).toThrow(/Invalid MCP allowed hostname/);
    }
    for (const allowedOrigin of [
      'null',
      'https://app.example/',
      'https://app.example/path',
      'https://user@app.example',
      'https://app.example?x',
      'https://app.example#x',
      'https://app.example,https://other.example',
      'moz-extension://id',
    ]) {
      expect(() =>
        createFetchHandler(app, { allowedOrigins: [allowedOrigin] })
      ).toThrow(/Invalid MCP allowed origin/);
    }
  });
});
