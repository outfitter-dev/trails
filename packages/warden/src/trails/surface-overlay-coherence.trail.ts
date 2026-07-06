import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { surfaceOverlayCoherence } from '../rules/surface-overlay-coherence.js';
import { wrapTopoRule } from './wrap-rule.js';

const listTrail = trail('gear.list', {
  blaze: () => Result.ok([]),
  input: z.object({}),
  output: z.array(z.string()),
});

export const surfaceOverlayCoherenceTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('surface-overlay-coherence', { listTrail }),
      },
      name: 'Topo without a serialized surfaces overlay stays quiet',
    },
  ],
  rule: surfaceOverlayCoherence,
});
