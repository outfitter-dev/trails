/**
 * HTTP entry point for stash.
 *
 * Usage:
 *   bun run src/http.ts            # port 4280
 *   STASH_PORT=8080 bun run src/http.ts
 */

import { createStashServer } from './server.js';

const { app } = await createStashServer();

const server = Bun.serve({
  fetch: app.fetch,
  port: Number(process.env['STASH_PORT'] ?? 4280),
});

process.stdout.write(`stash HTTP surface listening on ${server.url.href}\n`);
