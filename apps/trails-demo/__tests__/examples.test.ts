/**
 * The one-liner for shipped surfaces: validates the established topo, tests
 * every example, checks contracts, verifies detours, and ensures CLI/MCP
 * derived facts still build.
 */

import { testAllEstablished } from '@ontrails/testing/established';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAllEstablished registers tests at module level by design
testAllEstablished(graph, {
  ctx: { permit: { id: 'test-permit', scopes: ['entity:write'] } },
});
