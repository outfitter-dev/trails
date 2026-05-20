import { topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';

import { pendingForce } from '../rules/trail-versioning-topo.js';
import { wrapTopoRule } from './wrap-rule.js';

const emptyTopo = topo('pending-force-clean', {});

export const pendingForceTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        graph: deriveTopoGraph(emptyTopo),
        topo: emptyTopo,
      },
      name: 'No pending force audit events passes',
    },
  ],
  rule: pendingForce,
});
