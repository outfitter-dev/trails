/**
 * The one-liner contract suite: topo validation, every example, output
 * contracts, detours, and CLI/MCP rendering builds — with the mocked db.
 */

import { testAllEstablished } from '@ontrails/testing/established';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAllEstablished registers tests at module level by design
testAllEstablished(graph, {
  ctx: {
    permit: {
      id: 'usr_alice',
      scopes: [
        'snippet:write',
        'snippet:interact',
        'token:manage',
        'search:admin',
      ],
    },
  },
});
