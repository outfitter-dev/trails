import { testAllEstablished } from '@ontrails/testing/established';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAllEstablished registers tests at module level by design
testAllEstablished(graph, {
  ctx: {
    permit: { id: 'test-admin', scopes: ['relay:read', 'relay:write'] },
  },
});
