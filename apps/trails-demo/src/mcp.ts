/**
 * MCP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { blaze } from '@ontrails/mcp';

import { app } from './app.js';

await blaze(app, {
  serverInfo: { name: 'demo', version: '0.1.0' },
});
