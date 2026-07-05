/**
 * Example-driven parity across shipped surfaces: every trail example must
 * produce the same result no matter which surface invokes the trail.
 */

/* oxlint-disable eslint-plugin-jest/require-hook -- testSurfaceParity registers tests at module scope */
import { testSurfaceParity } from '@ontrails/testing/surface-parity';

import { app } from '../app.js';
import { createAuditLog } from '../resources/audit.js';
import { createMemoryFlagStore } from '../resources/flags.js';

testSurfaceParity(app, {
  createResources: () => ({
    audit: createAuditLog(),
    flags: createMemoryFlagStore(),
  }),
});
