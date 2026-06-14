/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope. */
import { testExamples } from '@ontrails/testing';

import { fixtureApp } from './fixtures/app.js';

testExamples(fixtureApp, {
  ctx: { permit: { id: 'library-fixture', scopes: ['widget:write'] } },
});
