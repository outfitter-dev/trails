/**
 * MCP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { trailhead } from '@ontrails/mcp';

import { app } from './app.js';

await trailhead(app, {
  serverInfo: { name: 'demo', version: '0.1.0' },
});
