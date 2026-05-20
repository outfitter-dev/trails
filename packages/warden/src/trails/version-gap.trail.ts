import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { versionGap } from '../rules/trail-versioning-topo.js';
import { wrapTopoRule } from './wrap-rule.js';

const versionedTrail = trail('version.gap.clean', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  version: 2,
  versions: {
    1: {
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      transpose: {
        input: ({ input }) => input,
        output: ({ output }) => output,
      },
    },
  },
});

export const versionGapTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('version-gap-clean', { versionedTrail }),
      },
      name: 'Contiguous versions pass',
    },
  ],
  rule: versionGap,
});
