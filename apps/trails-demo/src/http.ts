/**
 * HTTP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/http.ts
 */

import { surface } from '@ontrails/hono';

import { graph } from './app.js';

await surface(graph, {
  port: 3000,
});
