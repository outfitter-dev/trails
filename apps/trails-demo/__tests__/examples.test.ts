/**
 * The one-liner: tests every trail example in the app with progressive assertion.
 */

import { testExamples } from '@ontrails/testing';

import { app } from '../src/app.js';
import { createStore } from '../src/store.js';

// oxlint-disable-next-line require-hook -- testExamples registers tests at module level by design
testExamples(app, () => ({
  store: createStore([
    { name: 'Alpha', tags: ['core'], type: 'concept' },
    { name: 'Deletable', tags: ['temp'], type: 'tool' },
  ]),
}));
