import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { duplicatePublicContract } from '../rules/duplicate-public-contract.js';
import { wrapTopoRule } from './wrap-rule.js';

const sharedInput = z.object({ target: z.string() });
const sharedOutput = z.object({ ok: z.boolean() });

const canonicalTrail = trail('survey.diff', {
  blaze: () => Result.ok({ ok: true }),
  input: sharedInput,
  output: sharedOutput,
});

const duplicateTrail = trail('diff', {
  blaze: () => Result.ok({ ok: true }),
  input: sharedInput,
  output: sharedOutput,
});

export const duplicatePublicContractTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Likely duplicate public trail contracts "diff", "survey.diff" share the same input, output, intent, permits, resources, composes, signals, and detours. Keep one contract with aliases/input mappings, compose a distinct wrapper, or document why these public contracts are separate.',
            rule: 'duplicate-public-contract',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: topo('duplicate-public-contract', {
          canonicalTrail,
          duplicateTrail,
        }),
      },
      name: 'Duplicate public surface contracts are coached',
    },
  ],
  rule: duplicatePublicContract,
});
