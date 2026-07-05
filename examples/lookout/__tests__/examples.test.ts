/**
 * The one-liner contract suite: validates the topo, runs every trail example
 * against the mocked resources, checks output contracts, and verifies detour
 * targets — all offline.
 */

import { testAll } from '@ontrails/testing';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAll registers tests at module level by design
testAll(graph, {
  ctx: { permit: { id: 'test-permit', scopes: ['lookout:admin'] } },
});
