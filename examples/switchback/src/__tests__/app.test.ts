/* oxlint-disable eslint-plugin-jest/require-hook -- testAll registers describe/test blocks at module scope */
import { testAll } from '@ontrails/testing';

import { app } from '../app.js';
import { createAuditLog } from '../resources/audit.js';
import { createMemoryFlagStore } from '../resources/flags.js';

// Fresh in-memory stores per test so mutation examples stay isolated and
// every example runs against exactly the committed fixture definitions.
testAll(app, () => ({
  resources: {
    audit: createAuditLog(),
    flags: createMemoryFlagStore(),
  },
}));
