/**
 * HTTP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/http.ts
 */

import { trailhead } from '@ontrails/hono';

import { app } from './app.js';

await trailhead(app, {
  port: 3000,
});
