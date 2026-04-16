/**
 * HTTP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/http.ts
 */

import { surface } from '@ontrails/hono';

import { app } from './app.js';

await surface(app, {
  port: 3000,
});
