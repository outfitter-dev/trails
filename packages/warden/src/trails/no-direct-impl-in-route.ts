import { Result, trail } from '@ontrails/core';

import { noDirectImplInRoute as rule } from '../rules/no-direct-impl-in-route.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const noDirectImplInRouteTrail = trail(
  'warden.rule.no-direct-impl-in-route',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            "hike('a', { follows: ['b'], implementation: async (input, ctx) => { await ctx.follow('b', {}); return Result.ok({}); } })",
        },
        name: 'Uses ctx.follow',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode:
            "hike('a', { follows: ['b'], implementation: async (input, ctx) => { const r = await otherTrail.implementation({}); return Result.ok({}); } })",
        },
        name: 'Direct implementation call',
      },
    ],
    implementation: (input) =>
      Result.ok({
        diagnostics: [...rule.check(input.sourceCode, input.filePath)],
      }),
    input: ruleInputSchema,
    output: ruleOutputSchema,
  }
);
