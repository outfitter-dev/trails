/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope. */
import { testExamples } from '@ontrails/testing';
import { LAYER_INPUTS_KEY } from '@ontrails/core';

import { fixtureApp } from './fixtures/app.js';

testExamples(fixtureApp, {
  ctx: {
    extensions: {
      [LAYER_INPUTS_KEY]: {
        audit: { message: 'default audit', token: 'default token' },
      },
    },
    permit: { id: 'library-fixture', scopes: ['widget:write'] },
  },
});
