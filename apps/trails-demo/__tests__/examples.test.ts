/**
 * The one-liner: validates the topo, tests every example, checks contracts,
 * and verifies detour targets.
 */

import { testAll } from '@ontrails/testing';

import { app } from '../src/app.js';
import { createStore } from '../src/store.js';

// oxlint-disable-next-line require-hook -- testAll registers tests at module level by design
testAll(app, () => ({
  store: createStore([
    { name: 'Alpha', tags: ['core'], type: 'concept' },
    { name: 'Deletable', tags: ['temp'], type: 'tool' },
  ]),
}));
