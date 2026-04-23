import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { permitGovernance } from '../rules/permit-governance.js';
import { wrapTopoRule } from './wrap-rule.js';

const destroyWithoutPermit = trail('entity.delete', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  output: z.object({ ok: z.boolean() }),
});

const scopedDestroy = trail('entity.delete', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['entity:delete'] },
});

export const permitGovernanceTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "entity.delete" has intent \'destroy\' but no permit declaration',
            rule: 'permit.destroyWithoutPermit',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('trl-377-missing-permit', { destroyWithoutPermit }),
      },
      name: 'Destroy trails without permits emit an error',
    },
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-377-scoped-destroy', { scopedDestroy }),
      },
      name: 'Scoped destroy permits keep permit governance clean',
    },
  ],
  rule: permitGovernance,
});
