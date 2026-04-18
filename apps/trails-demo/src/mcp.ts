/**
 * MCP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { surface } from '@ontrails/mcp';

import { graph } from './app.js';

await surface(graph);
