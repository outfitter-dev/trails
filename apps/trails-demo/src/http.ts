/**
 * HTTP entry point for trails-demo.
 *
 * Usage:
 *   bun run src/http.ts
 */

import { createTrailContext } from '@ontrails/core';
import { blaze } from '@ontrails/http/hono';

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
      extensions: { store },
    }),
  port: 3000,
});
