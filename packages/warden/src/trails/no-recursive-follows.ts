import { Result, trail } from '@ontrails/core';

import { noRecursiveFollows as rule } from '../rules/no-recursive-follows.js';

import { ruleInputSchema, ruleOutputSchema } from './schemas.js';

export const noRecursiveFollowsTrail = trail(
  'warden.rule.no-recursive-follows',
  {
    description: rule.description,
    examples: [
      {
        input: {
          filePath: 'clean.ts',
          sourceCode:
            "hike('a', { follows: ['b'], implementation: async (input, ctx) => Result.ok({}) })",
        },
        name: 'No self-reference',
      },
      {
        input: {
          filePath: 'bad.ts',
          sourceCode:
            "hike('a', { follows: ['a'], implementation: async (input, ctx) => Result.ok({}) })",
        },
        name: 'Self-referential follow',
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
