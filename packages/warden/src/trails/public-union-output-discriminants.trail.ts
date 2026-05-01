import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { publicUnionOutputDiscriminants } from '../rules/public-union-output-discriminants.js';
import { wrapTopoRule } from './wrap-rule.js';

const cleanOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), message: z.string() }),
  z.object({ count: z.number(), kind: z.literal('count') }),
]);

const cleanTrail = trail('report.read', {
  blaze: () => Result.ok({ kind: 'message' as const, message: 'ok' }),
  input: z.object({}),
  output: cleanOutput,
});

const cleanTopo = topo('public-union-output-discriminants-clean', {
  cleanTrail,
});

export const publicUnionOutputDiscriminantsTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: cleanTopo,
      },
      name: 'Public output object unions expose a literal discriminator',
    },
  ],
  rule: publicUnionOutputDiscriminants,
});
