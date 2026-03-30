/**
 * HTTP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/http.ts
 */

import { blaze } from '@ontrails/http/hono';

import { app } from './app.js';

await blaze(app, {
  port: 3000,
});
