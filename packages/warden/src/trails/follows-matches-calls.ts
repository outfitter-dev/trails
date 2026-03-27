import { Result, trail } from '@ontrails/core';

import { followsMatchesCalls as rule } from '../rules/follows-matches-calls.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const followsMatchesCallsTrail = trail(
  'warden.rule.follows-matches-calls',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            "hike('a', { follows: ['b'], implementation: async (input, ctx) => { await ctx.follow('b', {}); return Result.ok({}); } })",
        },
        name: 'Matching follows and calls',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode:
            "hike('a', { follows: [], implementation: async (input, ctx) => { await ctx.follow('b', {}); return Result.ok({}); } })",
        },
        name: 'Undeclared follow call',
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
