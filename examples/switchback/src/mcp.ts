/**
 * MCP entry point for switchback.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { surface } from '@ontrails/mcp';

import { app } from './app.js';

await surface(app);
