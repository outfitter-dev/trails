import { ConflictError, Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { validDetourContract } from '../rules/valid-detour-contract.js';
import { wrapTopoRule } from './wrap-rule.js';

const validTrail = trail('entity.save', {
  blaze: () => Result.ok({ ok: true }),
  detours: [
    {
      on: ConflictError,
      recover: async () => {
        const result = await Promise.resolve(Result.ok({ ok: true }));
        return result;
      },
    },
  ],
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

const invalidContractTrail = {
  ...validTrail,
  detours: [
    {
      on: 'ConflictError',
      recover: 'not a function',
    },
  ],
} as unknown as typeof validTrail;

export const validDetourContractTrail = wrapTopoRule({
  examples: [
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-380-valid-detour-contract', { validTrail }),
      },
      name: 'Detours with an error constructor and recover function stay clean',
    },
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "entity.save" detour[0] must declare an error constructor in on:. Received ConflictError.',
            rule: 'valid-detour-contract',
            severity: 'error',
          },
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "entity.save" detour[0] must declare a callable recover function.',
            rule: 'valid-detour-contract',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('trl-380-invalid-detour-contract', {
          invalidContractTrail,
        } as Record<string, unknown>),
      },
      name: 'Malformed detour contracts emit diagnostics',
    },
  ],
  rule: validDetourContract,
});
