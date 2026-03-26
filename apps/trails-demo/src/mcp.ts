/**
 * MCP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { createTrailContext } from '@ontrails/core';
import { blaze } from '@ontrails/mcp';

import { app } from './app.js';
import { createStore } from './store.js';

const store = createStore([
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Beta', tags: ['automation'], type: 'tool' },
  { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
]);

await blaze(app, {
  createContext: () =>
    createTrailContext({
      store,
    }),
  serverInfo: { name: 'demo', version: '0.1.0' },
});
