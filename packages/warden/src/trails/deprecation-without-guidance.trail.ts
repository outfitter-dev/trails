import { topo } from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';

import { deprecationWithoutGuidance } from '../rules/trail-versioning-topo.js';
import { wrapTopoRule } from './wrap-rule.js';

const emptyTopo = topo('deprecation-without-guidance-clean', {});

export const deprecationWithoutGuidanceTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        graph: deriveTopoGraph(emptyTopo),
        topo: emptyTopo,
      },
      name: 'No deprecated version entries passes',
    },
  ],
  rule: deprecationWithoutGuidance,
});
