#!/usr/bin/env bun

/**
 * CLI entry point for trails-demo.
 *
 * Usage:
 *   bun run bin/demo.ts entity show --name Alpha
 *   bun run bin/demo.ts entity add --name Beta --type tool --tags automation
 *   bun run bin/demo.ts search --query Alpha
 */

import { blaze } from '@ontrails/cli/commander';
import { createTrailContext } from '@ontrails/core';

import { app } from '../src/app.js';
import { createStore } from '../src/store.js';

const store = createStore([
  { name: 'Alpha', tags: ['core'], type: 'concept' },
  { name: 'Beta', tags: ['automation'], type: 'tool' },
  { name: 'Gamma', tags: ['workflow'], type: 'pattern' },
]);

// oxlint-disable-next-line require-hook -- CLI entry point, not a test file
blaze(app, {
  createContext: () =>
    createTrailContext({
      extensions: { store },
    }),
});
