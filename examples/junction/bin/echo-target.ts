#!/usr/bin/env bun

/**
 * A tiny local delivery target for the quickstart: logs every POST body
 * junction relays to it and answers 200.
 */

const port = Number(process.env['ECHO_PORT'] ?? 9999);
Bun.serve({
  fetch: async (request) => {
    const body = await request.text();
    process.stdout.write(`received ${request.method} ${body}\n`);
    return new Response('ok');
  },
  port,
});
process.stdout.write(`echo target listening on http://localhost:${port}\n`);
